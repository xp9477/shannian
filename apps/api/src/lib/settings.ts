import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { settings } from "../db/schema.js";
import { maskSecret } from "./crypto.js";
import type { AiSettingsPublic, MinioSettingsPublic, SetupStatus } from "@shannian/shared";

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

export async function deleteSetting(key: string): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key));
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const passwordHash = await getSetting("password_hash");
  const aiKey = await getSetting("ai_api_key");
  const minioAccess = await getSetting("minio_access_key");
  const minioSecret = await getSetting("minio_secret_key");
  const minioEndpoint = await getSetting("minio_endpoint");
  const minioBucket = await getSetting("minio_bucket");
  return {
    initialized: Boolean(passwordHash),
    hasAi: Boolean(aiKey && (await getSetting("ai_base_url")) && (await getSetting("ai_model"))),
    hasMinio: Boolean(minioAccess && minioSecret && minioEndpoint && minioBucket),
  };
}

export async function getAiSettingsPublic(): Promise<AiSettingsPublic> {
  const key = await getSetting("ai_api_key");
  return {
    baseUrl: (await getSetting("ai_base_url")) || "",
    model: (await getSetting("ai_model")) || "",
    hasKey: Boolean(key),
    keyHint: maskSecret(key),
  };
}

export async function getMinioSettingsPublic(): Promise<MinioSettingsPublic> {
  const access = await getSetting("minio_access_key");
  return {
    endpoint: (await getSetting("minio_endpoint")) || "",
    bucket: (await getSetting("minio_bucket")) || "",
    region: (await getSetting("minio_region")) || "us-east-1",
    thumbsPrefix: (await getSetting("minio_thumbs_prefix")) || "thumbs/",
    vaultPrefix: (await getSetting("minio_vault_prefix")) || "vault-export/",
    hasKeys: Boolean(access && (await getSetting("minio_secret_key"))),
    accessKeyHint: maskSecret(access),
  };
}

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export async function getAiConfig(): Promise<AiConfig | null> {
  const baseUrl = await getSetting("ai_base_url");
  const apiKey = await getSetting("ai_api_key");
  const model = await getSetting("ai_model");
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, model };
}

export interface MinioConfig {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
  thumbsPrefix: string;
  vaultPrefix: string;
  useSSL: boolean;
}

export async function getMinioConfig(): Promise<MinioConfig | null> {
  const endpoint = await getSetting("minio_endpoint");
  const bucket = await getSetting("minio_bucket");
  const accessKey = await getSetting("minio_access_key");
  const secretKey = await getSetting("minio_secret_key");
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  const region = (await getSetting("minio_region")) || "us-east-1";
  const thumbsPrefix = (await getSetting("minio_thumbs_prefix")) || "thumbs/";
  const vaultPrefix = (await getSetting("minio_vault_prefix")) || "vault-export/";
  let useSSL = true;
  let host = endpoint;
  try {
    const u = new URL(endpoint.includes("://") ? endpoint : `https://${endpoint}`);
    useSSL = u.protocol === "https:";
    host = u.host;
  } catch {
    host = endpoint.replace(/^https?:\/\//, "");
  }
  return {
    endpoint: host,
    bucket,
    accessKey,
    secretKey,
    region,
    thumbsPrefix: thumbsPrefix.endsWith("/") ? thumbsPrefix : `${thumbsPrefix}/`,
    vaultPrefix: vaultPrefix.endsWith("/") ? vaultPrefix : `${vaultPrefix}/`,
    useSSL,
  };
}
