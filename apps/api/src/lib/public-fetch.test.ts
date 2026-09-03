import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// public-fetch imports settings (and therefore SQLite) through its production
// outbound-fetch default. Set an isolated directory before the dynamic import.
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shannian-public-fetch-"));
process.env.DATA_DIR = tempDataDir;

const {
  MAX_HTML_BYTES,
  PublicFetchError,
  fetchPublicHtml,
  fetchPublicImage,
} = await import("./public-fetch.js");
const { sqlite } = await import("../db/index.js");

after(() => {
  sqlite.close();
  fs.rmSync(tempDataDir, { recursive: true, force: true });
});

const publicLookup = async () => [{ address: "8.8.8.8", family: 4 }] as const;

async function assertPublicFetchError(
  promise: Promise<unknown>,
  code: string
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    return error instanceof PublicFetchError && error.code === code;
  });
}

test("public fetch rejects private DNS answers before opening a connection", async () => {
  let requests = 0;
  await assertPublicFetchError(
    fetchPublicHtml("http://metadata.internal.example/", {
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      fetchImpl: async () => {
        requests += 1;
        return new Response("unreachable");
      },
    }),
    "BLOCKED_HOST"
  );
  assert.equal(requests, 0);
});

test("public fetch deadline also bounds a stalled DNS lookup", async () => {
  const started = Date.now();
  await assertPublicFetchError(
    fetchPublicHtml("https://stalled-dns.example/", {
      timeoutMs: 20,
      lookup: () => new Promise(() => undefined),
      fetchImpl: async () => new Response("unreachable"),
    }),
    "FETCH_TIMEOUT"
  );
  assert.ok(Date.now() - started < 500, "stalled DNS should release the worker promptly");
});

test("public fetch validates every redirect target before following it", async () => {
  const requested: string[] = [];
  await assertPublicFetchError(
    fetchPublicHtml("https://public.example/start", {
      lookup: async (hostname) => {
        if (hostname === "public.example") {
          return [{ address: "1.1.1.1", family: 4 }];
        }
        if (hostname === "127.0.0.1") {
          return [{ address: "127.0.0.1", family: 4 }];
        }
        throw new Error(`unexpected lookup: ${hostname}`);
      },
      fetchImpl: async (input) => {
        requested.push(input.toString());
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/admin" },
        });
      },
    }),
    "BLOCKED_HOST"
  );
  assert.deepEqual(requested, ["https://public.example/start"]);
});

test("public HTML fetch cancels a streamed response exceeding its byte cap", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_HTML_BYTES + 1));
    },
    cancel() {
      cancelled = true;
    },
  });

  await assertPublicFetchError(
    fetchPublicHtml("https://public.example/large", {
      lookup: publicLookup,
      fetchImpl: async () =>
        new Response(body, {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    }),
    "BODY_TOO_LARGE"
  );
  assert.equal(cancelled, true);
});

test("public image fetch verifies bytes rather than trusting the MIME header", async () => {
  await assertPublicFetchError(
    fetchPublicImage("https://public.example/not-a-png", {
      lookup: publicLookup,
      fetchImpl: async () =>
        new Response(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]), {
          headers: { "content-type": "image/png" },
        }),
    }),
    "INVALID_IMAGE"
  );

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const result = await fetchPublicImage("https://public.example/photo", {
    lookup: publicLookup,
    fetchImpl: async () =>
      new Response(jpeg, { headers: { "content-type": "application/octet-stream" } }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.contentType, "image/jpeg");
});
