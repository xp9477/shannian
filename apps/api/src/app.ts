import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import { serveStatic } from "@hono/node-server/serve-static";
import { sqlite } from "./db/index.js";
import { AppError } from "./lib/errors.js";
import { authRoutes } from "./routes/auth.js";
import { setupRoutes } from "./routes/setup.js";
import { cardsRoutes } from "./routes/cards.js";
import { metaRoutes } from "./routes/meta.js";
import { importRoutes } from "./routes/import.js";
import { getEnrichmentQueueStats } from "./services/enrichment-queue.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function configuredCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (raw) {
    return raw
      .split(",")
      .map((value) => value.trim().replace(/\/$/, ""))
      .filter(Boolean);
  }
  if (process.env.NODE_ENV !== "production") {
    return ["http://localhost:5173", "http://127.0.0.1:5173"];
  }
  return [];
}

function originMatchesRequest(origin: string, host: string | undefined): boolean {
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export function createApp() {
  const app = new Hono();
  const allowedOrigins = configuredCorsOrigins();

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "https:"],
        manifestSrc: ["'self'"],
        mediaSrc: ["'self'", "https:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        workerSrc: ["'self'"],
      },
      permissionsPolicy: {
        camera: [],
        geolocation: [],
        microphone: [],
      },
      referrerPolicy: "no-referrer",
      strictTransportSecurity:
        process.env.NODE_ENV === "production" ? "max-age=31536000" : false,
    })
  );

  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });

  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => c.json({ error: "BODY_TOO_LARGE" }, 413),
    })
  );

  // Browser state-changing calls must be same-origin unless the operator explicitly
  // configured a CORS origin. Requests without Origin remain usable by CLI clients.
  app.use("/api/*", async (c, next) => {
    if (!UNSAFE_METHODS.has(c.req.method)) return next();
    const origin = c.req.header("origin");
    const fetchSite = c.req.header("sec-fetch-site")?.toLowerCase();
    if (origin) {
      const normalized = origin.replace(/\/$/, "");
      const allowed = allowedOrigins.includes(normalized);
      if (!allowed && !originMatchesRequest(normalized, c.req.header("host"))) {
        return c.json({ error: "ORIGIN_NOT_ALLOWED" }, 403);
      }
    } else if (fetchSite === "cross-site") {
      return c.json({ error: "ORIGIN_NOT_ALLOWED" }, 403);
    }
    return next();
  });

  if (allowedOrigins.length > 0) {
    app.use(
      "/api/*",
      cors({
        origin: allowedOrigins,
        allowMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowHeaders: ["Content-Type", "X-Setup-Token"],
        credentials: true,
        maxAge: 600,
      })
    );
  }

  app.use("*", async (c, next) => {
    const started = Date.now();
    await next();
    if (c.req.path !== "/api/health") {
      console.info(
        `[http] ${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - started}ms`
      );
    }
  });

  app.get("/api/health", (c) => {
    sqlite.prepare("SELECT 1").get();
    return c.json({
      ok: true,
      name: "闪念",
      database: "ok",
      enrichmentQueue: getEnrichmentQueueStats(),
    });
  });

  app.route("/api/auth", authRoutes);
  app.route("/api/setup", setupRoutes);
  app.route("/api/cards", cardsRoutes);
  app.route("/api/import", importRoutes);
  app.route("/api", metaRoutes);

  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const webDist = process.env.WEB_DIST || path.resolve(dirname, "../../web/dist");
  if (fs.existsSync(webDist)) {
    const indexPath = path.join(webDist, "index.html");
    const indexHtml = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : null;
    app.use(
      "/*",
      serveStatic({
        root: webDist,
        rewriteRequestPath: (requestPath) => requestPath,
      })
    );
    app.get("*", (c) => {
      if (c.req.path.startsWith("/api")) {
        return c.json({ error: "NOT_FOUND" }, 404);
      }
      return indexHtml ? c.html(indexHtml) : c.text("Web UI not built", 404);
    });
  }

  app.notFound((c) =>
    c.req.path.startsWith("/api")
      ? c.json({ error: "NOT_FOUND" }, 404)
      : c.text("Not found", 404)
  );

  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json({ error: error.code, message: error.message }, error.status);
    }
    if (error instanceof ZodError) {
      return c.json(
        {
          error: "VALIDATION_ERROR",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400
      );
    }
    if (error instanceof SyntaxError) {
      return c.json({ error: "INVALID_JSON" }, 400);
    }
    if (error instanceof Error && error.message === "INVALID_URL") {
      return c.json({ error: "INVALID_URL" }, 400);
    }
    const sqliteCode = (error as { code?: string }).code;
    if (sqliteCode?.startsWith("SQLITE_CONSTRAINT")) {
      return c.json({ error: "CONFLICT" }, 409);
    }
    const requestId = crypto.randomUUID();
    console.error(`[error:${requestId}]`, error);
    return c.json({ error: "INTERNAL_ERROR", requestId }, 500);
  });

  return app;
}

export type ShannianApp = ReturnType<typeof createApp>;
