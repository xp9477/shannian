import assert from "node:assert/strict";
import test from "node:test";
import {
  sealSetting,
  settingsEncryptionConfigured,
  unsealSetting,
} from "./secret-box.js";

type SecretEnv = {
  SETTINGS_ENCRYPTION_KEY?: string;
  SETTINGS_ENCRYPTION_KEY_FILE?: string;
};

function saveSecretEnv(): SecretEnv {
  return {
    SETTINGS_ENCRYPTION_KEY: process.env.SETTINGS_ENCRYPTION_KEY,
    SETTINGS_ENCRYPTION_KEY_FILE: process.env.SETTINGS_ENCRYPTION_KEY_FILE,
  };
}

function restoreSecretEnv(saved: SecretEnv): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function useKey(value?: string): void {
  delete process.env.SETTINGS_ENCRYPTION_KEY_FILE;
  if (value === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
  else process.env.SETTINGS_ENCRYPTION_KEY = value;
}

// Environment controls the key, so keep all cases in one serial test. This also
// exercises the module's key-cache invalidation instead of relying on re-imports.
test("sensitive settings encryption is optional, authenticated, and fail-closed", () => {
  const saved = saveSecretEnv();
  try {
    useKey();
    assert.equal(settingsEncryptionConfigured(), false);
    assert.equal(sealSetting("ai_api_key", "plain-token"), "plain-token");
    assert.equal(unsealSetting("ai_api_key", "plain-token"), "plain-token");

    useKey("first-test-key-is-long-enough-to-be-safe-0001");
    assert.equal(settingsEncryptionConfigured(), true);
    const sealed = sealSetting("ai_api_key", "plain-token");
    assert.match(sealed, /^sealed:v1:/);
    assert.notEqual(sealed, "plain-token");
    assert.equal(unsealSetting("ai_api_key", sealed), "plain-token");

    // The setting name is additional authenticated data: moving ciphertext to
    // another setting must not make it decryptable.
    assert.throws(
      () => unsealSetting("x_auth_token", sealed),
      /Cannot decrypt setting x_auth_token/
    );

    useKey("second-test-key-is-long-enough-to-be-safe-0002");
    assert.throws(
      () => unsealSetting("ai_api_key", sealed),
      /Cannot decrypt setting ai_api_key/
    );

    useKey();
    assert.throws(
      () => unsealSetting("ai_api_key", sealed),
      /Encrypted settings exist but SETTINGS_ENCRYPTION_KEY is not configured/
    );

    useKey("first-test-key-is-long-enough-to-be-safe-0001");
    const malformed = `${sealed.slice(0, -1)}A`;
    assert.throws(
      () => unsealSetting("ai_api_key", malformed),
      /Cannot decrypt setting ai_api_key/
    );
  } finally {
    restoreSecretEnv(saved);
  }
});
