import * as Minio from "minio";
import { getMinioConfig } from "../lib/settings.js";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { createHash } from "node:crypto";
import { fetchPublicImage } from "../lib/public-fetch.js";

let cachedClient:
  | { key: string; client: Minio.Client; agent: http.Agent }
  | null = null;

function deadline<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function client() {
  const config = await getMinioConfig();
  if (!config) return null;
  const host = config.endpoint;
  const port = config.port ?? (config.useSSL ? 443 : 80);
  const cacheKey = createHash("sha256")
    .update(JSON.stringify(config))
    .digest("hex");
  if (cachedClient?.key === cacheKey) {
    return { client: cachedClient.client, config };
  }
  cachedClient?.agent.destroy();
  const agent = config.useSSL
    ? new https.Agent({ keepAlive: true, maxSockets: 4, timeout: 15_000 })
    : new http.Agent({ keepAlive: true, maxSockets: 4, timeout: 15_000 });
  const c = new Minio.Client({
    endPoint: host,
    port: Number.isFinite(port) ? port : undefined,
    useSSL: config.useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    region: config.region,
    transportAgent: agent,
    retryOptions: {
      maximumRetryCount: 2,
      baseDelayMs: 250,
      maximumDelayMs: 2_000,
    },
  });
  cachedClient = { key: cacheKey, client: c, agent };
  return { client: c, config };
}

export async function testMinioConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const ctx = await client();
    if (!ctx) return { ok: false, message: "未配置 MinIO" };
    const exists = await deadline(
      ctx.client.bucketExists(ctx.config.bucket),
      15_000,
      "MINIO_BUCKET_CHECK"
    );
    if (!exists) return { ok: false, message: `Bucket 不存在: ${ctx.config.bucket}` };
    return { ok: true, message: "连接成功" };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

export async function uploadBuffer(
  objectKey: string,
  buffer: Buffer,
  contentType: string
): Promise<string | null> {
  const ctx = await client();
  if (!ctx) return null;
  await deadline(
    ctx.client.putObject(ctx.config.bucket, objectKey, buffer, buffer.length, {
      "Content-Type": contentType,
    }),
    30_000,
    "MINIO_UPLOAD"
  );
  return objectKey;
}

export async function uploadThumbnailFromUrl(
  cardId: string,
  imageUrl: string
): Promise<string | null> {
  const ctx = await client();
  if (!ctx) return null;
  try {
    const res = await fetchPublicImage(imageUrl, {
      timeoutMs: 15_000,
      headers: { "User-Agent": "ShannianBot/0.1" },
    });
    if (!res.ok) return null;
    const buf = res.body;
    const ct = res.contentType || "image/jpeg";
    let ext = "jpg";
    if (ct.includes("png")) ext = "png";
    else if (ct.includes("webp")) ext = "webp";
    else if (ct.includes("gif")) ext = "gif";
    else if (ct.includes("avif")) ext = "avif";
    const key = `${ctx.config.thumbsPrefix}${cardId}.${ext}`;
    await deadline(
      ctx.client.putObject(ctx.config.bucket, key, buf, buf.length, {
        "Content-Type": ct,
      }),
      30_000,
      "MINIO_THUMBNAIL_UPLOAD"
    );
    return key;
  } catch {
    return null;
  }
}

export async function uploadVaultMarkdown(
  objectKey: string,
  content: string
): Promise<string | null> {
  return uploadBuffer(objectKey, Buffer.from(content, "utf8"), "text/markdown; charset=utf-8");
}

export async function getObjectStream(objectKey: string) {
  const ctx = await client();
  if (!ctx) return null;
  const stream = await deadline(
    ctx.client.getObject(ctx.config.bucket, objectKey),
    15_000,
    "MINIO_DOWNLOAD"
  );
  const { Readable } = await import("node:stream");
  return Readable.toWeb(stream as import("node:stream").Readable);
}

export function vaultObjectKey(cardId: string, title: string | null, vaultPrefix: string): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const slug = (title || "untitled")
    .slice(0, 40)
    .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return path.posix.join(vaultPrefix, String(y), m, `${cardId}-${slug || "note"}.md`);
}
