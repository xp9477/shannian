import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "../db/index.js";

const THUMBS_SUBDIR = "thumbs";

export function getThumbsDir(): string {
  const dir = path.join(getDataDir(), THUMBS_SUBDIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Object key stored in cards.thumbnail_key, e.g. thumbs/{cardId}.jpg */
export function thumbKey(cardId: string, ext: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "") || "jpg";
  return `${THUMBS_SUBDIR}/${cardId}.${safeExt}`;
}

function resolveThumbPath(objectKey: string): string | null {
  if (!objectKey || objectKey.includes("..") || path.isAbsolute(objectKey)) {
    return null;
  }
  const normalized = objectKey.replace(/\\/g, "/");
  if (!normalized.startsWith(`${THUMBS_SUBDIR}/`)) {
    return null;
  }
  const abs = path.resolve(getDataDir(), normalized);
  const root = path.resolve(getDataDir());
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    return null;
  }
  return abs;
}

function extFromContentType(ct: string): string {
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  return "jpg";
}

export function contentTypeForKey(objectKey: string): string {
  const ext = path.extname(objectKey).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

/**
 * Download remote image and store under data/thumbs/.
 * Returns thumbnail_key or null on failure.
 */
export async function saveThumbnailFromUrl(
  cardId: string,
  imageUrl: string
): Promise<string | null> {
  try {
    const { outboundFetch } = await import("../lib/http.js");
    const res = await outboundFetch(imageUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "ShannianBot/0.1" },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 32 || buf.length > 8 * 1024 * 1024) return null;
    const ct = res.headers.get("content-type") || "image/jpeg";
    if (!ct.startsWith("image/") && !ct.includes("octet-stream")) {
      // still try if URL looks like an image path
      if (!/\.(jpe?g|png|webp|gif)(\?|$)/i.test(imageUrl)) return null;
    }
    const ext = extFromContentType(ct);
    const key = thumbKey(cardId, ext);
    const filePath = resolveThumbPath(key);
    if (!filePath) return null;
    getThumbsDir();
    // Remove any previous extension for this card
    await deleteThumbnailsForCard(cardId);
    await fsp.writeFile(filePath, buf);
    return key;
  } catch {
    return null;
  }
}

export async function readThumbnail(objectKey: string): Promise<{
  stream: ReadableStream;
  contentType: string;
} | null> {
  const filePath = resolveThumbPath(objectKey);
  if (!filePath || !fs.existsSync(filePath)) return null;
  const { Readable } = await import("node:stream");
  const nodeStream = fs.createReadStream(filePath);
  return {
    stream: Readable.toWeb(nodeStream) as unknown as ReadableStream,
    contentType: contentTypeForKey(objectKey),
  };
}

/** Delete all local thumb files for a card id (any extension). */
export async function deleteThumbnailsForCard(cardId: string): Promise<void> {
  const dir = getThumbsDir();
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return;
  }
  const prefix = `${cardId}.`;
  await Promise.all(
    names
      .filter((n) => n.startsWith(prefix))
      .map((n) => fsp.unlink(path.join(dir, n)).catch(() => undefined))
  );
}

export async function deleteThumbnailByKey(objectKey: string | null | undefined): Promise<void> {
  if (!objectKey) return;
  const filePath = resolveThumbPath(objectKey);
  if (!filePath) {
    // Legacy minio-style keys still start with thumbs/ — try card id parse
    const base = path.basename(objectKey);
    const id = base.replace(/\.[^.]+$/, "");
    if (id) await deleteThumbnailsForCard(id);
    return;
  }
  await fsp.unlink(filePath).catch(() => undefined);
}
