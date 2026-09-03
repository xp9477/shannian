import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";

export const MAX_PUBLIC_REDIRECTS = 5;
export const MAX_HTML_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type PublicResourceKind = "html" | "image";

export type PublicFetchErrorCode =
  | "INVALID_URL"
  | "UNSUPPORTED_PROTOCOL"
  | "BLOCKED_HOST"
  | "DNS_LOOKUP_FAILED"
  | "INVALID_DNS_RESPONSE"
  | "FETCH_TIMEOUT"
  | "TOO_MANY_REDIRECTS"
  | "INVALID_REDIRECT"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "BODY_TOO_LARGE"
  | "INVALID_IMAGE";

export class PublicFetchError extends Error {
  constructor(
    public readonly code: PublicFetchErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "PublicFetchError";
  }
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type PublicDnsLookup = (
  hostname: string
) => Promise<readonly ResolvedAddress[]>;

export type PublicFetchImplementation = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export interface PublicFetchOptions {
  headers?: HeadersInit;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Primarily for deterministic tests. Production is hard-capped at five redirects. */
  maxRedirects?: number;
  /** Overrides ALLOW_PRIVATE_FETCH for a single call. */
  allowPrivate?: boolean;
  lookup?: PublicDnsLookup;
  fetchImpl?: PublicFetchImplementation;
}

export interface PublicFetchResult {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  body: Buffer;
  contentType: string | null;
  finalUrl: URL;
  redirectCount: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

interface Ipv4Range {
  network: number;
  prefix: number;
}

const BLOCKED_IPV4_RANGES: readonly Ipv4Range[] = [
  // Current network, RFC 1918, shared address space, loopback, and link-local.
  { network: 0x00000000, prefix: 8 },
  { network: 0x0a000000, prefix: 8 },
  { network: 0x64400000, prefix: 10 },
  { network: 0x7f000000, prefix: 8 },
  { network: 0xa9fe0000, prefix: 16 },
  { network: 0xac100000, prefix: 12 },
  { network: 0xc0a80000, prefix: 16 },
  // IETF protocol assignments, documentation, deprecated relay, and benchmarks.
  { network: 0xc0000000, prefix: 24 },
  { network: 0xc0000200, prefix: 24 },
  { network: 0xc0586300, prefix: 24 },
  { network: 0xc6120000, prefix: 15 },
  { network: 0xc6336400, prefix: 24 },
  { network: 0xcb007100, prefix: 24 },
  // Multicast, future/reserved space, and limited broadcast.
  { network: 0xe0000000, prefix: 4 },
  { network: 0xf0000000, prefix: 4 },
];

/** Exact opt-in required; values such as "1" or "yes" stay fail-closed. */
export function isPrivateFetchAllowed(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function normalizedHostname(hostname: string): string {
  let normalized = hostname.trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  return normalized.replace(/\.$/, "");
}

/** Hostnames that must never reach DNS in the default configuration. */
export function isBlockedLocalHostname(hostname: string): boolean {
  const host = normalizedHostname(hostname);
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "local" ||
    host.endsWith(".local") ||
    host === "localdomain" ||
    host.endsWith(".localdomain") ||
    host === "internal" ||
    host.endsWith(".internal") ||
    host === "home.arpa" ||
    host.endsWith(".home.arpa")
  );
}

function parseIpv4(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value * 256 + octet) >>> 0;
  }
  return value;
}

function isIpv4InRange(address: number, range: Ipv4Range): boolean {
  if (range.prefix === 0) return true;
  const mask = (0xffffffff << (32 - range.prefix)) >>> 0;
  return (address & mask) >>> 0 === (range.network & mask) >>> 0;
}

function parseIpv6(address: string): bigint | null {
  let input = normalizedHostname(address);
  const zoneIndex = input.indexOf("%");
  if (zoneIndex !== -1) input = input.slice(0, zoneIndex);

  // Turn an IPv4 tail into its two IPv6 hextets before expanding ::.
  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    if (lastColon === -1) return null;
    const ipv4 = parseIpv4(input.slice(lastColon + 1));
    if (ipv4 === null) return null;
    input = `${input.slice(0, lastColon)}:${(ipv4 >>> 16).toString(16)}:${(
      ipv4 & 0xffff
    ).toString(16)}`;
  }

  if ((input.match(/::/g) || []).length > 1) return null;
  const hasCompression = input.includes("::");
  const [leftRaw, rightRaw = ""] = input.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  if (left.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  if (right.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;

  const omitted = 8 - left.length - right.length;
  if (hasCompression ? omitted < 1 : omitted !== 0) return null;
  const parts = [...left, ...Array(omitted).fill("0"), ...right];
  if (parts.length !== 8) return null;

  let value = 0n;
  for (const part of parts) {
    value = (value << 16n) | BigInt(Number.parseInt(part, 16));
  }
  return value;
}

function ipv6CidrContains(
  address: bigint,
  network: bigint,
  prefix: number
): boolean {
  if (prefix === 0) return true;
  const shift = BigInt(128 - prefix);
  return address >> shift === network >> shift;
}

function ipv6Network(address: string): bigint {
  const parsed = parseIpv6(address);
  if (parsed === null) throw new Error(`Invalid internal IPv6 CIDR: ${address}`);
  return parsed;
}

const GLOBAL_UNICAST_V6 = ipv6Network("2000::");
const BLOCKED_GLOBAL_IPV6_RANGES = [
  // IETF special-purpose space, including Teredo, benchmarking and ORCHID.
  { network: ipv6Network("2001::"), prefix: 23 },
  // Documentation ranges.
  { network: ipv6Network("2001:db8::"), prefix: 32 },
  { network: ipv6Network("3fff::"), prefix: 20 },
  // 6to4 can encode otherwise-blocked IPv4 destinations.
  { network: ipv6Network("2002::"), prefix: 16 },
] as const;

/**
 * True for non-global IPv4/IPv6 space. The conservative IPv6 policy only
 * permits currently allocated global-unicast space and removes special ranges.
 */
export function isPrivateOrReservedIp(address: string): boolean {
  const normalized = normalizedHostname(address);
  const family = isIP(normalized);
  if (family === 4) {
    const parsed = parseIpv4(normalized);
    return (
      parsed === null ||
      BLOCKED_IPV4_RANGES.some((range) => isIpv4InRange(parsed, range))
    );
  }
  if (family === 6) {
    const parsed = parseIpv6(normalized);
    if (parsed === null) return true;
    if (!ipv6CidrContains(parsed, GLOBAL_UNICAST_V6, 3)) return true;
    return BLOCKED_GLOBAL_IPV6_RANGES.some((range) =>
      ipv6CidrContains(parsed, range.network, range.prefix)
    );
  }
  // A DNS resolver must only return literal IP addresses.
  return true;
}

/** Pure validation used after DNS resolution; every answer must be public. */
export function validateResolvedAddresses(
  hostname: string,
  addresses: readonly ResolvedAddress[],
  allowPrivate: boolean
): void {
  if (addresses.length === 0) {
    throw new PublicFetchError(
      "INVALID_DNS_RESPONSE",
      `DNS returned no addresses for ${hostname}`
    );
  }

  for (const result of addresses) {
    const actualFamily = isIP(normalizedHostname(result.address));
    if (actualFamily === 0 || (result.family !== 4 && result.family !== 6)) {
      throw new PublicFetchError(
        "INVALID_DNS_RESPONSE",
        `DNS returned an invalid address for ${hostname}`
      );
    }
    if (actualFamily !== result.family) {
      throw new PublicFetchError(
        "INVALID_DNS_RESPONSE",
        `DNS returned a mismatched address family for ${hostname}`
      );
    }
    if (!allowPrivate && isPrivateOrReservedIp(result.address)) {
      throw new PublicFetchError(
        "BLOCKED_HOST",
        `Refusing non-public address for ${hostname}`
      );
    }
  }
}

/** Parse and normalize a user URL before any network operation. */
export function parsePublicHttpUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = new URL(input.toString());
  } catch (cause) {
    throw new PublicFetchError("INVALID_URL", "Invalid URL", { cause });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PublicFetchError(
      "UNSUPPORTED_PROTOCOL",
      `Unsupported URL protocol: ${url.protocol || "(none)"}`
    );
  }
  if (!url.hostname) {
    throw new PublicFetchError("INVALID_URL", "URL must include a hostname");
  }
  // Credentials are never needed for public previews and are easy to leak on
  // redirects or in diagnostics.
  if (url.username || url.password) {
    throw new PublicFetchError(
      "INVALID_URL",
      "Credentials are not allowed in public fetch URLs"
    );
  }
  return url;
}

async function defaultPublicLookup(
  hostname: string
): Promise<readonly ResolvedAddress[]> {
  const normalized = normalizedHostname(hostname);
  const literalFamily = isIP(normalized);
  if (literalFamily !== 0) {
    return [{ address: normalized, family: literalFamily }];
  }
  return dnsLookup(normalized, { all: true, verbatim: true });
}

async function validatePublicTarget(
  url: URL,
  lookup: PublicDnsLookup,
  allowPrivate: boolean,
  signal: AbortSignal
): Promise<readonly ResolvedAddress[]> {
  if (!allowPrivate && isBlockedLocalHostname(url.hostname)) {
    throw new PublicFetchError(
      "BLOCKED_HOST",
      `Refusing local hostname: ${url.hostname}`
    );
  }

  let addresses: readonly ResolvedAddress[];
  try {
    addresses = await raceWithAbort(
      lookup(normalizedHostname(url.hostname)),
      signal
    );
  } catch (cause) {
    if (cause instanceof PublicFetchError) throw cause;
    throw new PublicFetchError(
      "DNS_LOOKUP_FAILED",
      `DNS lookup failed for ${url.hostname}`,
      { cause }
    );
  }
  validateResolvedAddresses(url.hostname, addresses, allowPrivate);
  return addresses;
}

/**
 * DNS APIs do not consistently accept AbortSignal. Race them against the
 * request deadline so a stalled resolver cannot permanently occupy a worker.
 * The resolver may finish in the background, but its promise remains handled.
 */
function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
}

/**
 * Pin the TCP connection to an address that was already checked above. A
 * separate `lookup()` followed by an ordinary fetch is not sufficient: an
 * attacker-controlled resolver could return a public address for validation
 * and a private address for the actual connection (DNS rebinding).
 *
 * Public-preview traffic deliberately does not inherit the general HTTP proxy.
 * A CONNECT proxy resolves the destination outside this process, where we
 * cannot prove that the resolved address is public. Operators that require a
 * proxy should enforce the same egress policy at that proxy or firewall.
 */
function createPinnedAgent(addresses: readonly ResolvedAddress[]): Agent {
  let cursor = 0;
  const lookup: LookupFunction = (_hostname, options, callback) => {
    const requestedFamily = options.family === 4 || options.family === 6
      ? options.family
      : 0;
    const eligible = requestedFamily
      ? addresses.filter((entry) => entry.family === requestedFamily)
      : [...addresses];
    if (eligible.length === 0) {
      const error = new Error("No validated address for requested family") as NodeJS.ErrnoException;
      error.code = "ENOTFOUND";
      callback(error, "", 0);
      return;
    }
    if (options.all) {
      callback(
        null,
        eligible.map((entry) => ({
          address: entry.address,
          family: entry.family as 4 | 6,
        }))
      );
      return;
    }
    const selected = eligible[cursor % eligible.length]!;
    cursor += 1;
    callback(null, selected.address, selected.family);
  };
  return new Agent({
    connect: {
      lookup,
      autoSelectFamily: false,
    },
  });
}

/** Return a normalized MIME type without parameters, or null if absent. */
export function normalizedContentType(value: string | null): string | null {
  if (!value) return null;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  if (!mediaType) return null;
  return mediaType === "image/jpg" ? "image/jpeg" : mediaType;
}

export function isAllowedContentType(
  kind: PublicResourceKind,
  value: string | null
): boolean {
  const mediaType = normalizedContentType(value);
  if (!mediaType) return false;
  if (kind === "html") {
    return mediaType === "text/html" || mediaType === "application/xhtml+xml";
  }
  return (
    SUPPORTED_IMAGE_TYPES.has(mediaType) ||
    mediaType === "application/octet-stream"
  );
}

/** Detect supported raster formats. SVG is deliberately excluded. */
export function detectImageContentType(
  bytes: Uint8Array
): Exclude<string, "image/svg+xml"> | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 6) {
    const signature = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
    if (signature === "GIF87a" || signature === "GIF89a") {
      return "image/gif";
    }
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 16 &&
    Buffer.from(bytes.subarray(4, 8)).toString("ascii") === "ftyp"
  ) {
    const boxSize = Math.min(
      bytes.length,
      Math.max(16, readUint32BigEndian(bytes, 0))
    );
    for (let offset = 8; offset + 4 <= boxSize; offset += 4) {
      const brand = Buffer.from(bytes.subarray(offset, offset + 4)).toString(
        "ascii"
      );
      if (brand === "avif" || brand === "avis") return "image/avif";
    }
  }
  return null;
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      (bytes[offset + 1] ?? 0) * 0x10000 +
      (bytes[offset + 2] ?? 0) * 0x100 +
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

/** Read a web stream with a hard cap and cancel it as soon as the cap is hit. */
export async function readStreamWithLimit(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  onLimit?: (error: PublicFetchError) => void
): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("maxBytes must be a non-negative safe integer");
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        const error = new PublicFetchError(
          "BODY_TOO_LARGE",
          `Response body exceeds ${maxBytes} bytes`
        );
        onLimit?.(error);
        await reader.cancel(error).catch(() => undefined);
        throw error;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

function parseContentLength(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function cancelResponse(response: Response, reason?: unknown): Promise<void> {
  if (!response.body) return;
  await response.body.cancel(reason).catch(() => undefined);
}

function createRequestController(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number
): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });

  const timer = setTimeout(() => {
    controller.abort(
      new PublicFetchError(
        "FETCH_TIMEOUT",
        `Public fetch timed out after ${timeoutMs}ms`
      )
    );
  }, timeoutMs);
  return {
    controller,
    dispose() {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    },
  };
}

async function fetchPublicResource(
  input: string | URL,
  kind: PublicResourceKind,
  options: PublicFetchOptions
): Promise<PublicFetchResult> {
  let currentUrl = parsePublicHttpUrl(input);
  const lookup = options.lookup ?? defaultPublicLookup;
  const fetchImpl = options.fetchImpl;
  const allowPrivate =
    options.allowPrivate ??
    isPrivateFetchAllowed(process.env.ALLOW_PRIVATE_FETCH);
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? 12_000));
  const requestedMaxRedirects = Math.max(
    0,
    Math.floor(options.maxRedirects ?? MAX_PUBLIC_REDIRECTS)
  );
  const maxRedirects = Math.min(MAX_PUBLIC_REDIRECTS, requestedMaxRedirects);
  const maxBytes = kind === "html" ? MAX_HTML_BYTES : MAX_IMAGE_BYTES;
  const headers = new Headers(options.headers);
  // User-provided URLs must not be able to override connection routing.
  headers.delete("host");
  headers.delete("cookie");
  headers.delete("authorization");
  headers.delete("proxy-authorization");

  const { controller, dispose } = createRequestController(
    options.signal,
    timeoutMs
  );
  let redirectCount = 0;

  try {
    while (true) {
      const addresses = await validatePublicTarget(
        currentUrl,
        lookup,
        allowPrivate,
        controller.signal
      );
      const requestInit: RequestInit = {
        method: "GET",
        headers,
        redirect: "manual",
        signal: controller.signal,
      };
      let pinnedAgent: Agent | null = null;
      try {
        let response: Response;
        if (fetchImpl) {
          response = await fetchImpl(currentUrl.toString(), requestInit);
        } else {
          pinnedAgent = createPinnedAgent(addresses);
          response = (await undiciFetch(currentUrl.toString(), {
            ...(requestInit as UndiciRequestInit),
            dispatcher: pinnedAgent,
          })) as unknown as Response;
        }

        if (REDIRECT_STATUSES.has(response.status)) {
          const location = response.headers.get("location");
          await cancelResponse(response);
          if (!location) {
            throw new PublicFetchError(
              "INVALID_REDIRECT",
              `Redirect response ${response.status} has no Location header`
            );
          }
          if (redirectCount >= maxRedirects) {
            throw new PublicFetchError(
              "TOO_MANY_REDIRECTS",
              `Response exceeded ${maxRedirects} redirects`
            );
          }
          try {
            currentUrl = parsePublicHttpUrl(new URL(location, currentUrl));
          } catch (cause) {
            if (cause instanceof PublicFetchError) throw cause;
            throw new PublicFetchError(
              "INVALID_REDIRECT",
              "Redirect Location is invalid",
              { cause }
            );
          }
          redirectCount += 1;
          continue;
        }

        const contentTypeHeader = response.headers.get("content-type");
        const mediaType = normalizedContentType(contentTypeHeader);
        if (!response.ok) {
          await cancelResponse(response);
          return {
            ok: false,
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            body: Buffer.alloc(0),
            contentType: mediaType,
            finalUrl: currentUrl,
            redirectCount,
          };
        }

        if (!isAllowedContentType(kind, contentTypeHeader)) {
          await cancelResponse(response);
          throw new PublicFetchError(
            "UNSUPPORTED_CONTENT_TYPE",
            `Unexpected ${kind} Content-Type: ${contentTypeHeader || "(missing)"}`
          );
        }

        const contentLength = parseContentLength(
          response.headers.get("content-length")
        );
        if (contentLength !== null && contentLength > maxBytes) {
          const error = new PublicFetchError(
            "BODY_TOO_LARGE",
            `Response Content-Length exceeds ${maxBytes} bytes`
          );
          controller.abort(error);
          await cancelResponse(response, error);
          throw error;
        }

        const body = await readStreamWithLimit(response.body, maxBytes, (error) =>
          controller.abort(error)
        );
        let verifiedContentType = mediaType;
        if (kind === "image") {
          const detected = detectImageContentType(body);
          if (!detected) {
            throw new PublicFetchError(
              "INVALID_IMAGE",
              "Response is not a supported raster image"
            );
          }
          if (mediaType !== "application/octet-stream" && mediaType !== detected) {
            throw new PublicFetchError(
              "INVALID_IMAGE",
              `Image bytes do not match Content-Type ${mediaType}`
            );
          }
          verifiedContentType = detected;
        }

        return {
          ok: true,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          body,
          contentType: verifiedContentType,
          finalUrl: currentUrl,
          redirectCount,
        };
      } finally {
        if (pinnedAgent) await pinnedAgent.close();
      }
    }
  } finally {
    dispose();
  }
}

export function fetchPublicHtml(
  input: string | URL,
  options: PublicFetchOptions = {}
): Promise<PublicFetchResult> {
  return fetchPublicResource(input, "html", options);
}

export function fetchPublicImage(
  input: string | URL,
  options: PublicFetchOptions = {}
): Promise<PublicFetchResult> {
  return fetchPublicResource(input, "image", options);
}
