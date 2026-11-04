const express = require("express");
const { randomBytes } = require("node:crypto");
const path = require("node:path");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const session = require("express-session");
const { createAuthRouter } = require("./routes/auth");
const { createPortalRouter } = require("./routes/portal");
const { createPublicRouter } = require("./routes/public");
const { createHealthRouter } = require("./routes/health");
const { readMaintenanceMode } = require("./maintenance-mode");
const { createPublicSiteApp } = require("./public-site");

const MANAGEMENT_PATHS = new Set([
  "/login",
  "/developer",
  "/developer/overview",
  "/developer/content",
  "/developer/portfolio",
  "/developer/media",
  "/developer/maintenance",
  "/set-password",
]);

function createApp(config, { pool, sessionStore, publicSiteDirectory, managementFrontendDirectory, startupReady = true } = {}) {
  if (!pool || !sessionStore) throw new Error("A database pool and persistent session store are required.");
  const app = express(); app.locals.startupReady = startupReady; app.disable("x-powered-by"); app.set("trust proxy", 1);
  app.use((_request, response, next) => {
    const nonce = randomBytes(16).toString("base64");
    response.locals.cspNonce = nonce;
    response.setHeader("Content-Security-Policy", [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net`,
      "style-src 'self' 'nonce-" + nonce + "' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com",
      "img-src 'self' data: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "));
    return next();
  });
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use((_request, response, next) => app.locals.startupReady ? next() : response.status(503).json({ error: "Service unavailable" }));
  app.use(express.json({ limit: "100kb" }));
  app.use(session({ name: "fetman.sid", secret: config.sessionSecret, store: sessionStore, resave: false, saveUninitialized: false, rolling: true, cookie: { httpOnly: true, secure: config.environment === "production", sameSite: "lax", maxAge: 8 * 60 * 60 * 1000, path: "/" } }));
  app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 150, standardHeaders: "draft-8", legacyHeaders: false }));
  app.use("/api/health", createHealthRouter(pool));
  app.use("/api/auth", createAuthRouter({ pool, sessionStore }));
  app.use("/api/public", async (_request, response, next) => { try { const setting = await readMaintenanceMode(pool); if (setting.maintenanceMode) return response.status(503).json({ error: "The public website is temporarily unavailable." }); return next(); } catch { return response.status(503).json({ error: "The public website is temporarily unavailable." }); } });
  app.use("/api/public", createPublicRouter({ pool, smtp: config.smtp || { host: "" }, recipient: config.contactRecipient || "", mediaDirectory: config.mediaDirectory }));
  app.use("/api/developer", createPortalRouter({ pool, mediaDirectory: config.mediaDirectory }));
  app.use("/api", (_request, response) => response.status(404).json({ error: "Not found" }));

  if (publicSiteDirectory && managementFrontendDirectory) {
    app.use("/assets", (request, response, next) => /\.(?:map|env|pem|key)$/i.test(request.path) ? response.status(404).end() : next());
    app.use("/assets", express.static(path.join(managementFrontendDirectory, "assets"), { immutable: true, maxAge: "1y" }));
    app.use((request, response, next) => {
      if (/^\/developer(?:\/.*)?\/$/.test(request.path) || request.path === "/login/") {
        return response.redirect(308, request.path.replace(/\/+$/, "") || "/");
      }
      return next();
    });
    app.get("*splat", (request, response, next) => MANAGEMENT_PATHS.has(request.path) ? response.sendFile(path.join(managementFrontendDirectory, "index.html")) : next());
    app.use(createPublicSiteApp({ pool, siteDirectory: publicSiteDirectory }));
  }
  app.use((_request, response) => response.status(404).json({ error: "Not found" }));
  app.use((error, request, response, next) => { if (response.headersSent) return next(error); console.error("Unhandled request error", { method: request.method, path: request.path, errorCode: typeof error?.code === "string" ? error.code : "INTERNAL_ERROR" }); return response.status(Number.isInteger(error.status) ? error.status : 500).json({ error: Number.isInteger(error.status) ? "Invalid request" : "Internal server error" }); });
  return app;
}
module.exports = { createApp };
