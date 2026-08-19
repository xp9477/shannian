import { sqlite } from "../db/index.js";
import { maskSecret } from "./crypto.js";
import type { AiSettingsPublic, MinioSettingsPublic, SetupStatus } from "@shannian/shared";
import { setupTokenRequired } from "./setup-token.js";
import {
  isSealedSetting,
  isSensitiveSetting,
  sealSetting,
  settingsEncryptionConfigured,
  unsealSetting,
} from "./secret-box.js";
import { parseHttpServiceUrl } from "./validation.js";

export async function getSetting(key: string): Promise<string | null> {
  return (await getSettings([key]))[key] ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await setSettings({ [key]: value });
}

/** Read a related group from one SQLite snapshot to avoid mixed configurations. */
export async function getSettings(
  keys: readonly string[]
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = Object.fromEntries(
    keys.map((key) => [key, null])
  );
  if (keys.length === 0) return result;
  const placeholders = keys.map(() => "?").join(", ");
  const rows = sqlite
    .prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
    .all(...keys) as { key: string; value: string }[];
  for (const row of rows) result[row.key] = unsealSetting(row.key, row.value);
  return result;
}

/** Atomically replace a related group so old credentials never meet a new host. */
export async function setSettings(
  values: Readonly<Record<string, string | undefined>>
): Promise<void> {
  const entries = Object.entries(values).filter(
    (entry): entry is [string, string] => entry[1] !== undefined
  );
  if (entries.length === 0) return;
  const upsert = sqlite.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
  const write = sqlite.transaction(() => {
    for (const [key, value] of entries) upsert.run(key, sealSetting(key, value));
  });
  write();
}

/**
 * Encrypt legacy plaintext secrets when an external key is configured. Also
 * validates all existing ciphertext during startup so a missing/wrong key
 * fails loudly instead of silently corrupting credentials.
 */
export function migrateSecretSettingsEncryption(): void {
  const rows = sqlite
    .prepare("SELECT key, value FROM settings")
    .all() as { key: string; value: string }[];
  const encryptionEnabled = settingsEncryptionConfigured();
  const update = sqlite.prepare("UPDATE settings SET value = ? WHERE key = ?");
  const migrate = sqlite.transaction(() => {
    for (const row of rows) {
      if (!isSensitiveSetting(row.key)) continue;
      if (isSealedSetting(row.value)) {
        unsealSetting(row.key, row.value);
      } else if (encryptionEnabled) {
        update.run(sealSetting(row.key, row.value), row.key);
      }
    }
  });
  migrate();
}

export async function deleteSetting(key: string): Promise<void> {
  await deleteSettings([key]);
}

export async function deleteSettings(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const remove = sqlite.prepare("DELETE FROM settings WHERE key = ?");
  const transaction = sqlite.transaction(() => {
    for (const key of keys) remove.run(key);
  });
  transaction();
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const values = await getSettings([
    "password_hash",
    "ai_api_key",
    "ai_base_url",
    "ai_model",
    "minio_access_key",
    "minio_secret_key",
    "minio_endpoint",
    "minio_bucket",
  ]);
  const passwordHash = values.password_hash;
  const aiKey = values.ai_api_key;
  const aiBaseUrl = values.ai_base_url;
  const aiModel = values.ai_model;
  const minioAccess = values.minio_access_key;
  const minioSecret = values.minio_secret_key;
  const minioEndpoint = values.minio_endpoint;
  const minioBucket = values.minio_bucket;
  return {
    initialized: Boolean(passwordHash),
    hasAi: Boolean(
      aiKey &&
        aiModel &&
        aiBaseUrl &&
        parseHttpServiceUrl(aiBaseUrl, {
          allowBareHost: false,
          allowPath: true,
        })
    ),
    hasMinio: Boolean(
      minioAccess &&
        minioSecret &&
        minioBucket &&
        minioEndpoint &&
        parseHttpServiceUrl(minioEndpoint, {
          allowBareHost: true,
          allowPath: false,
        })
    ),
    requiresSetupToken: !passwordHash && setupTokenRequired(),
  };
}

export async function getAiSettingsPublic(): Promise<AiSettingsPublic> {
  const values = await getSettings(["ai_api_key", "ai_base_url", "ai_model"]);
  const key = values.ai_api_key;
  const storedBaseUrl = values.ai_base_url || "";
  const parsedBaseUrl = parseHttpServiceUrl(storedBaseUrl, {
    allowBareHost: false,
    allowPath: true,
  });
  return {
    baseUrl: parsedBaseUrl ? parsedBaseUrl.toString().replace(/\/$/, "") : "",
    model: values.ai_model || "",
    hasKey: Boolean(key),
    keyHint: maskSecret(key),
  };
}

export async function getMinioSettingsPublic(): Promise<MinioSettingsPublic> {
  const values = await getSettings([
    "minio_access_key",
    "minio_secret_key",
    "minio_endpoint",
    "minio_bucket",
    "minio_region",
    "minio_thumbs_prefix",
    "minio_vault_prefix",
  ]);
  const access = values.minio_access_key;
  const storedEndpoint = values.minio_endpoint || "";
  const parsedEndpoint = parseHttpServiceUrl(storedEndpoint, {
    allowBareHost: true,
    allowPath: false,
  });
  return {
    endpoint: parsedEndpoint ? `${parsedEndpoint.protocol}//${parsedEndpoint.host}` : "",
    bucket: values.minio_bucket || "",
    region: values.minio_region || "us-east-1",
    thumbsPrefix: values.minio_thumbs_prefix || "thumbs/",
    vaultPrefix: values.minio_vault_prefix || "vault-export/",
    hasKeys: Boolean(access && values.minio_secret_key),
    accessKeyHint: maskSecret(access),
  };
}

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export async function getAiConfig(): Promise<AiConfig | null> {
  const values = await getSettings(["ai_base_url", "ai_api_key", "ai_model"]);
  const baseUrl = values.ai_base_url;
  const apiKey = values.ai_api_key;
  const model = values.ai_model;
  if (!baseUrl || !apiKey || !model) return null;
  const parsed = parseHttpServiceUrl(baseUrl, {
    allowBareHost: false,
    allowPath: true,
  });
  if (!parsed) return null;
  return { baseUrl: parsed.toString().replace(/\/$/, ""), apiKey, model };
}

export interface MinioConfig {
  endpoint: string;
  port?: number;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
  thumbsPrefix: string;
  vaultPrefix: string;
  useSSL: boolean;
}

export async function getMinioConfig(): Promise<MinioConfig | null> {
  const values = await getSettings([
    "minio_endpoint",
    "minio_bucket",
    "minio_access_key",
    "minio_secret_key",
    "minio_region",
    "minio_thumbs_prefix",
    "minio_vault_prefix",
  ]);
  const endpoint = values.minio_endpoint;
  const bucket = values.minio_bucket;
  const accessKey = values.minio_access_key;
  const secretKey = values.minio_secret_key;
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  const region = values.minio_region || "us-east-1";
  const thumbsPrefix = values.minio_thumbs_prefix || "thumbs/";
  const vaultPrefix = values.minio_vault_prefix || "vault-export/";
  const parsed = parseHttpServiceUrl(endpoint, {
    allowBareHost: true,
    allowPath: false,
  });
  if (!parsed) return null;
  const useSSL = parsed.protocol === "https:";
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const parsedPort = parsed.port ? Number(parsed.port) : undefined;
  return {
    endpoint: host,
    port: parsedPort,
    bucket,
    accessKey,
    secretKey,
    region,
    thumbsPrefix: thumbsPrefix.endsWith("/") ? thumbsPrefix : `${thumbsPrefix}/`,
    vaultPrefix: vaultPrefix.endsWith("/") ? vaultPrefix : `${vaultPrefix}/`,
    useSSL,
  };
}
