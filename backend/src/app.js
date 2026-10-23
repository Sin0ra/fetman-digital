const cors = require("cors");
const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const session = require("express-session");
const { createAuthRouter } = require("./routes/auth");
const { createGraphicDesignRouter } = require("./routes/graphic-design");
const { createPublicDesignRouter } = require("./routes/public-design");
const { createHealthRouter } = require("./routes/health");
const { createDeveloperRouter } = require("./routes/developer");
const { createDeveloperUsersRouter } = require("./routes/developer-users");
const { requirePasswordChangeComplete } = require("./middleware/auth");
const { readMaintenanceMode, safeErrorCode } = require("./maintenance-mode");

function createApp(
  config,
  {
    pool,
    sessionStore,
    loginLimit = 10,
    passwordChangeLimit = 5,
    passwordResetLimit = 5,
    designAssetDirectory,
  } = {},
) {
  if (!pool || !sessionStore) {
    throw new Error("A database pool and persistent session store are required.");
  }

  const app = express();
  const allowedOrigins = new Set(config.corsOrigins);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, !origin || allowedOrigins.has(origin));
      },
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );
  app.use(
    "/api",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 100,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(
    session({
      name: "fetman.sid",
      secret: config.sessionSecret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: config.environment === "production",
        sameSite: "lax",
        maxAge: 8 * 60 * 60 * 1000,
        path: "/",
      },
    }),
  );

  app.use("/api/health", createHealthRouter(pool));
  app.use("/api/public", async (_request, response, next) => {
    try {
      const setting = await readMaintenanceMode(pool);
      if (setting.maintenanceMode) {
        response.set("Cache-Control", "no-store");
        return response.status(503).json({
          error: "The public website is temporarily unavailable.",
        });
      }
      return next();
    } catch (error) {
      console.error("Public API maintenance state is unavailable", {
        errorCode: safeErrorCode(error),
      });
      response.set("Cache-Control", "no-store");
      return response.status(503).json({
        error: "The public website is temporarily unavailable.",
      });
    }
  });
  app.use(
    "/api/public",
    createPublicDesignRouter({
      pool,
      assetDirectory: designAssetDirectory,
    }),
  );
  app.use(
    "/api/auth",
    createAuthRouter({ pool, sessionStore, loginLimit, passwordChangeLimit }),
  );
  app.use("/api", requirePasswordChangeComplete(pool));
  app.use(
    "/api/developer/users",
    createDeveloperUsersRouter({ pool, sessionStore, passwordResetLimit }),
  );
  app.use(
    "/api/developer",
    createDeveloperRouter({ pool, environment: config.environment }),
  );
  app.use(
    "/api/graphic-design",
    createGraphicDesignRouter({
      pool,
      assetDirectory: designAssetDirectory,
    }),
  );
  app.use((_request, response) => {
    response.status(404).json({ error: "Not found" });
  });
  app.use((error, request, response, next) => {
    if (response.headersSent) {
      return next(error);
    }

    const status =
      Number.isInteger(error.status) && error.status >= 400 && error.status < 500
        ? error.status
        : 500;

    if (status === 500) {
      console.error("Unhandled request error", {
        method: request.method,
        path: request.path,
        errorCode:
          typeof error.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
            ? error.code
            : "INTERNAL_ERROR",
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }

    return response.status(status).json({
      error: status === 500 ? "Internal server error" : "Invalid request",
    });
  });

  return app;
}

module.exports = { createApp };
