import * as Minio from "minio";
import { getMinioConfig } from "../lib/settings.js";
import path from "node:path";

async function client() {
  const config = await getMinioConfig();
  if (!config) return null;
  // config.endpoint is host[:port]
  const [host, portStr] = config.endpoint.split(":");
  const port = portStr
    ? Number(portStr)
    : config.useSSL
      ? 443
      : 80;
  const c = new Minio.Client({
    endPoint: host,
    port: Number.isFinite(port) ? port : undefined,
    useSSL: config.useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    region: config.region,
  });
  return { client: c, config };
}

export async function testMinioConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const ctx = await client();
    if (!ctx) return { ok: false, message: "未配置 MinIO" };
    const exists = await ctx.client.bucketExists(ctx.config.bucket);
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
  await ctx.client.putObject(ctx.config.bucket, objectKey, buffer, buffer.length, {
    "Content-Type": contentType,
  });
  return objectKey;
}

export async function uploadThumbnailFromUrl(
  cardId: string,
  imageUrl: string
): Promise<string | null> {
  const ctx = await client();
  if (!ctx) return null;
  try {
    const { outboundFetch } = await import("../lib/http.js");
    const res = await outboundFetch(imageUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "ShannianBot/0.1" },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type") || "image/jpeg";
    let ext = "jpg";
    if (ct.includes("png")) ext = "png";
    else if (ct.includes("webp")) ext = "webp";
    else if (ct.includes("gif")) ext = "gif";
    const key = `${ctx.config.thumbsPrefix}${cardId}.${ext}`;
    await ctx.client.putObject(ctx.config.bucket, key, buf, buf.length, {
      "Content-Type": ct,
    });
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
  const stream = await ctx.client.getObject(ctx.config.bucket, objectKey);
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
