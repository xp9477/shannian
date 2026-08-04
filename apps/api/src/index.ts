import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { initDb } from "./db/index.js";
import { authRoutes } from "./routes/auth.js";
import { setupRoutes } from "./routes/setup.js";
import { cardsRoutes } from "./routes/cards.js";
import { metaRoutes } from "./routes/meta.js";
import { importRoutes } from "./routes/import.js";
import { queueThumbnailBackfill } from "./services/cards.js";

initDb();
// Fill missing local covers / authors for existing cards (rate-limited, non-blocking)
queueThumbnailBackfill();

const app = new Hono();

app.use("*", logger());
app.use(
  "/api/*",
  cors({
    origin: (origin) => origin || "http://localhost:5173",
    credentials: true,
  })
);

app.get("/api/health", (c) => c.json({ ok: true, name: "闪念" }));

app.route("/api/auth", authRoutes);
app.route("/api/setup", setupRoutes);
app.route("/api/cards", cardsRoutes);
app.route("/api/import", importRoutes);
app.route("/api", metaRoutes);

// Serve web build in production
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = process.env.WEB_DIST || path.resolve(__dirname, "../../web/dist");
if (fs.existsSync(webDist)) {
  app.use(
    "/*",
    serveStatic({
      root: webDist,
      rewriteRequestPath: (p) => p,
    })
  );
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api")) {
      return c.json({ error: "NOT_FOUND" }, 404);
    }
    const index = path.join(webDist, "index.html");
    if (fs.existsSync(index)) {
      return c.html(fs.readFileSync(index, "utf8"));
    }
    return c.text("Web UI not built", 404);
  });
}

const port = Number(process.env.PORT || 8787);
console.log(`闪念 API listening on http://0.0.0.0:${port}`);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
