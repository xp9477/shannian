import { z } from "zod";

const BCRYPT_MAX_BYTES = 72;

export const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .refine((value) => Buffer.byteLength(value, "utf8") <= BCRYPT_MAX_BYTES, {
    message: `密码 UTF-8 编码后不能超过 ${BCRYPT_MAX_BYTES} 字节`,
  });

export const cardTextSchema = z.string().max(50_000);
export const cardUrlSchema = z.string().max(4_096);
export const shortTextSchema = z.string().max(500);
export const settingValueSchema = z.string().max(4_096);

export function parseHttpServiceUrl(
  value: string,
  options: { allowBareHost: boolean; allowPath: boolean }
): URL | null {
  const raw = value.trim();
  if (!raw) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  if (hasScheme && !/^https?:\/\//i.test(raw)) return null;
  if (!hasScheme && !options.allowBareHost) return null;
  try {
    const url = new URL(hasScheme ? raw : `https://${raw}`);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (!options.allowPath && url.pathname !== "/")
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export const aiBaseUrlSchema = settingValueSchema.refine(
  (value) =>
    parseHttpServiceUrl(value, { allowBareHost: false, allowPath: true }) !== null,
  "AI Base URL 必须是无内嵌凭证、查询或片段的 HTTP(S) URL"
);

export const minioEndpointSchema = settingValueSchema.refine(
  (value) =>
    parseHttpServiceUrl(value, { allowBareHost: true, allowPath: false }) !== null,
  "MinIO Endpoint 必须是无内嵌凭证和路径的 HTTP(S) host[:port]"
);

export function normalizeAiBaseUrl(value: string): string {
  const parsed = parseHttpServiceUrl(value, {
    allowBareHost: false,
    allowPath: true,
  });
  if (!parsed) throw new Error("INVALID_AI_BASE_URL");
  return parsed.toString().replace(/\/$/, "");
}

export function normalizeMinioEndpoint(value: string): string {
  const parsed = parseHttpServiceUrl(value, {
    allowBareHost: true,
    allowPath: false,
  });
  if (!parsed) throw new Error("INVALID_MINIO_ENDPOINT");
  return `${parsed.protocol}//${parsed.host}`;
}
