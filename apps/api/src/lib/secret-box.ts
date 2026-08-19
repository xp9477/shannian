import fs from "node:fs";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const PREFIX = "sealed:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

const SENSITIVE_SETTING_KEYS = new Set([
  "ai_api_key",
  "http_proxy",
  "minio_access_key",
  "minio_secret_key",
  "x_auth_token",
  "x_ct0",
]);

let cachedSource: string | null = null;
let cachedKey: Buffer | null = null;

export function isSensitiveSetting(key: string): boolean {
  return SENSITIVE_SETTING_KEYS.has(key);
}

export function isSealedSetting(value: string): boolean {
  return value.startsWith(PREFIX);
}

function configuredSecret(): { source: string; value: string } | null {
  const inline = process.env.SETTINGS_ENCRYPTION_KEY?.trim() || "";
  const filePath = process.env.SETTINGS_ENCRYPTION_KEY_FILE?.trim() || "";
  if (inline && filePath) {
    throw new Error(
      "Configure only one of SETTINGS_ENCRYPTION_KEY or SETTINGS_ENCRYPTION_KEY_FILE"
    );
  }
  if (filePath) {
    const value = fs.readFileSync(filePath, "utf8").trim();
    return { source: `file:${filePath}`, value };
  }
  return inline ? { source: "environment", value: inline } : null;
}

function encryptionKey(): Buffer | null {
  const configured = configuredSecret();
  if (!configured) {
    cachedSource = null;
    cachedKey = null;
    return null;
  }
  if (configured.value.length < 32) {
    throw new Error("SETTINGS_ENCRYPTION_KEY must contain at least 32 characters");
  }
  const sourceFingerprint = createHash("sha256")
    .update(configured.source)
    .update("\0")
    .update(configured.value)
    .digest("hex");
  if (cachedSource === sourceFingerprint && cachedKey) return cachedKey;
  cachedSource = sourceFingerprint;
  cachedKey = createHash("sha256").update(configured.value, "utf8").digest();
  return cachedKey;
}

export function settingsEncryptionConfigured(): boolean {
  return encryptionKey() !== null;
}

function aad(settingKey: string): Buffer {
  return Buffer.from(`shannian-setting:${settingKey}`, "utf8");
}

export function sealSetting(settingKey: string, plaintext: string): string {
  if (!isSensitiveSetting(settingKey) || isSealedSetting(plaintext)) {
    return plaintext;
  }
  const key = encryptionKey();
  if (!key) return plaintext;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(settingKey));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  return `${PREFIX}${payload.toString("base64url")}`;
}

export function unsealSetting(settingKey: string, stored: string): string {
  if (!isSealedSetting(stored)) return stored;
  const key = encryptionKey();
  if (!key) {
    throw new Error(
      "Encrypted settings exist but SETTINGS_ENCRYPTION_KEY is not configured"
    );
  }
  try {
    const payload = Buffer.from(stored.slice(PREFIX.length), "base64url");
    if (payload.length < IV_BYTES + TAG_BYTES) throw new Error("truncated payload");
    const iv = payload.subarray(0, IV_BYTES);
    const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad(settingKey));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8"
    );
  } catch (cause) {
    throw new Error(
      `Cannot decrypt setting ${settingKey}; verify SETTINGS_ENCRYPTION_KEY`,
      { cause }
    );
  }
}
