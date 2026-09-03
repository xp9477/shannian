import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDataDir } from "../db/index.js";
import { fetchPublicImage } from "../lib/public-fetch.js";

const THUMBS_SUBDIR = "thumbs";

export function getThumbsDir(): string {
  const dir = path.join(getDataDir(), THUMBS_SUBDIR);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Best effort for filesystems without POSIX permission support.
  }
  return dir;
}

/** Object key stored in cards.thumbnail_key, e.g. thumbs/{cardId}.jpg */
export function thumbKey(cardId: string, ext: string, version?: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "") || "jpg";
  const safeVersion = version?.replace(/[^a-z0-9-]/gi, "") || "";
  return `${THUMBS_SUBDIR}/${cardId}${safeVersion ? `.${safeVersion}` : ""}.${safeExt}`;
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
  if (ct.includes("avif")) return "avif";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  return "jpg";
}

export function contentTypeForKey(objectKey: string): string {
  const ext = path.extname(objectKey).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".avif") return "image/avif";
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
  let temporaryPath: string | null = null;
  try {
    const res = await fetchPublicImage(imageUrl, {
      timeoutMs: 15_000,
      headers: { "User-Agent": "ShannianBot/0.1" },
    });
    if (!res.ok) return null;
    const buf = res.body;
    if (buf.length < 32 || buf.length > 8 * 1024 * 1024) return null;
    const ct = res.contentType || "image/jpeg";
    const ext = extFromContentType(ct);
    // Versioned names let the caller update SQLite first and delete the old
    // object afterwards. A concurrent/stale enrichment can no longer overwrite
    // the bytes referenced by the current database row.
    const key = thumbKey(cardId, ext, randomUUID());
    const filePath = resolveThumbPath(key);
    if (!filePath) return null;
    const dir = getThumbsDir();
    temporaryPath = path.join(dir, `.${cardId}.${randomUUID()}.tmp`);
    await fsp.writeFile(temporaryPath, buf, { mode: 0o600, flag: "wx" });
    // Rename is atomic on the local filesystem: a failed download/write never
    // destroys the last known-good thumbnail.
    await fsp.rename(temporaryPath, filePath);
    temporaryPath = null;
    return key;
  } catch {
    return null;
  } finally {
    if (temporaryPath) await fsp.unlink(temporaryPath).catch(() => undefined);
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
export async function deleteThumbnailsForCard(
  cardId: string,
  keepName?: string
): Promise<void> {
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
      .filter((n) => n.startsWith(prefix) && n !== keepName)
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
