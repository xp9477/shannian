import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { listPlatformsPublic, testXConnection, X_RISK_NOTE } from "../services/import/registry.js";
import {
  clearXCredentials,
  getXCredentialsPublic,
  saveXCredentials,
} from "../services/import/x-credentials.js";
import {
  cancelXImport,
  getXImportJob,
  startXImport,
} from "../services/import/x-import-job.js";
import { settingValueSchema } from "../lib/validation.js";

export const importRoutes = new Hono<AuthEnv>();
importRoutes.use("*", requireAuth);

importRoutes.get("/platforms", async (c) => {
  return c.json({ items: await listPlatformsPublic(), riskNote: X_RISK_NOTE });
});

importRoutes.get("/x/credentials", async (c) => {
  return c.json({
    credentials: await getXCredentialsPublic(),
    riskNote: X_RISK_NOTE,
  });
});

importRoutes.put("/x/credentials", async (c) => {
  const body = z
    .object({
      authToken: settingValueSchema.optional(),
      ct0: settingValueSchema.optional(),
    }).strict()
    .parse(await c.req.json());
  if (!body.authToken?.trim() && !body.ct0?.trim()) {
    return c.json({ error: "EMPTY" }, 400);
  }
  const credentials = await saveXCredentials(body);
  return c.json({ credentials, riskNote: X_RISK_NOTE });
});

importRoutes.delete("/x/credentials", async (c) => {
  await clearXCredentials();
  return c.json({ ok: true, credentials: await getXCredentialsPublic() });
});

importRoutes.post("/x/test", async (c) => {
  return c.json(await testXConnection());
});

importRoutes.post("/x/start", async (c) => {
  const body = z
    .object({ forceFull: z.boolean().optional() })
    .strict()
    .parse((await c.req.json().catch(() => ({}))) || {});
  try {
    const job = await startXImport({ forceFull: body.forceFull });
    return c.json({ job }, 202);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "IMPORT_ALREADY_RUNNING") {
      return c.json({ error: "IMPORT_ALREADY_RUNNING", job: await getXImportJob() }, 409);
    }
    if (msg === "X_CREDENTIALS_MISSING") {
      return c.json({ error: "X_CREDENTIALS_MISSING" }, 400);
    }
    throw e;
  }
});

importRoutes.get("/x/job", async (c) => {
  return c.json({ job: await getXImportJob() });
});

importRoutes.post("/x/cancel", async (c) => {
  const job = await cancelXImport();
  return c.json({ job });
});
