const cors = require("cors");
const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const session = require("express-session");
const { createAuthRouter } = require("./routes/auth");
const { createGraphicDesignRouter } = require("./routes/graphic-design");
const { createHealthRouter } = require("./routes/health");
const { createDeveloperUsersRouter } = require("./routes/developer-users");
const {
  getAuthenticatedUser,
  requirePasswordChangeComplete,
} = require("./middleware/auth");

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
    "/api/graphic-design",
    createGraphicDesignRouter({
      pool,
      assetDirectory: designAssetDirectory,
    }),
  );
  app.get("/api/developer/dashboard", async (request, response) => {
    const user = await getAuthenticatedUser(pool, request, response);

    if (!user) {
      return;
    }
    if (user.role !== "Developer") {
      return response.status(403).json({ error: "Forbidden" });
    }

    return response.status(200).json({
      user: { email: user.email, role: user.role },
      status: "authenticated",
    });
  });
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
      });
    }

    return response.status(status).json({
      error: status === 500 ? "Internal server error" : "Invalid request",
    });
  });

  return app;
}

module.exports = { createApp };
