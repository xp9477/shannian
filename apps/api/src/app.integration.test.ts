import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shannian-app-test-"));
process.env.DATA_DIR = tempDataDir;
process.env.NODE_ENV = "production";
process.env.SETUP_TOKEN = "integration-setup-token";

const { initDb, sqlite } = await import("./db/index.js");
initDb();
const { createApp } = await import("./app.js");
const { checkLoginRate, clearLoginRate } = await import("./middleware/auth.js");
const app = createApp();

after(() => {
  sqlite.close();
  fs.rmSync(tempDataDir, { recursive: true, force: true });
});

function setupRequest(password: string, setupToken = "integration-setup-token"): Request {
  return new Request("http://flash.test/api/setup/password", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "flash.test",
      origin: "http://flash.test",
      "x-setup-token": setupToken,
    },
    body: JSON.stringify({ password }),
  });
}

test("setup token, atomic first-user claim, and origin protection", async () => {
  const statusResponse = await app.request("http://flash.test/api/setup/status");
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), {
    initialized: false,
    hasAi: false,
    hasMinio: false,
    requiresSetupToken: true,
  });

  const rejectedToken = await app.request(
    setupRequest("valid-password", "wrong-setup-token")
  );
  assert.equal(rejectedToken.status, 403);
  assert.deepEqual(await rejectedToken.json(), { error: "INVALID_SETUP_TOKEN" });

  const [first, second] = await Promise.all([
    app.request(setupRequest("first-valid-password")),
    app.request(setupRequest("second-valid-password")),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  assert.equal(
    (sqlite.prepare("SELECT COUNT(*) AS count FROM settings WHERE key = 'password_hash'").get() as {
      count: number;
    }).count,
    1
  );
  assert.equal(
    (sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { count: number }).count,
    1
  );

  const hostileOrigin = await app.request(
    new Request("http://flash.test/api/setup/password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "flash.test",
        origin: "https://attacker.example",
        "x-setup-token": "integration-setup-token",
      },
      body: JSON.stringify({ password: "another-valid-password" }),
    })
  );
  assert.equal(hostileOrigin.status, 403);
  assert.deepEqual(await hostileOrigin.json(), { error: "ORIGIN_NOT_ALLOWED" });
  assert.equal(hostileOrigin.headers.get("access-control-allow-origin"), null);

  const truncatedPassword = await app.request(
    new Request("http://flash.test/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "flash.test",
        origin: "http://flash.test",
      },
      body: JSON.stringify({ password: "a".repeat(73) }),
    })
  );
  assert.equal(truncatedPassword.status, 400);

  const winner = first.status === 200 ? first : second;
  const cookie = winner.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  const badAiUrl = await app.request(
    new Request("http://flash.test/api/setup/ai", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        host: "flash.test",
        origin: "http://flash.test",
      },
      body: JSON.stringify({
        baseUrl: "https://user:password@ai.example/v1",
        apiKey: "secret",
        model: "model",
      }),
    })
  );
  assert.equal(badAiUrl.status, 400);

  process.env.SETTINGS_ENCRYPTION_KEY = "integration-key-is-at-least-thirty-two-characters";
  process.env.SETTINGS_ENCRYPTION_KEY_FILE = "/must-not-be-read-when-inline-is-set";
  try {
    const failedAtomicAiUpdate = await app.request(
      new Request("http://flash.test/api/settings/ai", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
          host: "flash.test",
          origin: "http://flash.test",
        },
        body: JSON.stringify({
          baseUrl: "https://new-ai.example/v1",
          apiKey: "new-secret",
          model: "new-model",
        }),
      })
    );
    assert.equal(failedAtomicAiUpdate.status, 500);
    const partiallyWritten = sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM settings WHERE key IN ('ai_base_url', 'ai_api_key', 'ai_model')"
      )
      .get() as { count: number };
    assert.equal(partiallyWritten.count, 0);
  } finally {
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    delete process.env.SETTINGS_ENCRYPTION_KEY_FILE;
  }

  const badMinioUrl = await app.request(
    new Request("http://flash.test/api/setup/minio", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        host: "flash.test",
        origin: "http://flash.test",
      },
      body: JSON.stringify({
        endpoint: "http://user:password@minio.example:9000",
        bucket: "bucket",
        accessKey: "access",
        secretKey: "secret",
      }),
    })
  );
  assert.equal(badMinioUrl.status, 400);

  const validMinioUrl = await app.request(
    new Request("http://flash.test/api/setup/minio", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        host: "flash.test",
        origin: "http://flash.test",
      },
      body: JSON.stringify({
        endpoint: "minio.local:9000",
        bucket: "bucket",
        accessKey: "access",
        secretKey: "secret",
      }),
    })
  );
  assert.equal(validMinioUrl.status, 200);
  assert.equal((await validMinioUrl.json()).minio.endpoint, "https://minio.local:9000");

  const proxyWithSecretQuery = await app.request(
    new Request("http://flash.test/api/settings/proxy", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie,
        host: "flash.test",
        origin: "http://flash.test",
      },
      body: JSON.stringify({ proxyUrl: "https://proxy.example/?token=must-not-echo" }),
    })
  );
  assert.equal(proxyWithSecretQuery.status, 400);
  assert.equal((await proxyWithSecretQuery.json()).message.includes("must-not-echo"), false);
});

test("login limiter enforces the per-client window and can clear a successful client", () => {
  const client = "integration-rate-client";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.equal(checkLoginRate(client).allowed, true);
  }
  const blocked = checkLoginRate(client);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
  clearLoginRate(client);
  assert.equal(checkLoginRate(client).allowed, true);
  clearLoginRate(client);
});
