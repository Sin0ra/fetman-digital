const { createApp } = require("./app");
const { loadConfig } = require("./config/env");
const { createPool } = require("./db/pool");
const { MySQLSessionStore } = require("./db/session-store");
const fs = require("node:fs");
const path = require("node:path");
const {
  safeErrorCode,
  verifyMaintenanceModeStorage,
} = require("./maintenance-mode");

async function startServer() {
  const config = loadConfig();
  const pool = createPool(config);
  const managementFrontendDirectory = path.resolve(__dirname, "../../management-frontend/dist");
  let sessionStore;
  let app;
  let server;
  try {
    sessionStore = new MySQLSessionStore(pool);
    if (!fs.existsSync(path.join(managementFrontendDirectory, "index.html"))) {
      throw new Error("The management frontend build is missing. Run the production build before starting the server.");
    }
    app = createApp(config, {
      pool,
      sessionStore,
      publicSiteDirectory: path.resolve(__dirname, "../.."),
      managementFrontendDirectory,
      startupReady: false,
    });
    server = app.listen(config.port, config.host);
    await waitForListening(server);

    await pool.query("SELECT 1");
    await pool.query("SELECT id FROM management_users LIMIT 0");
    await pool.query("SELECT session_id FROM management_sessions LIMIT 0");
    await verifyMaintenanceModeStorage(pool);
    app.locals.startupReady = true;
  } catch (error) {
    await Promise.all(
      [server].filter(Boolean).map(closeIfListening),
    );
    if (typeof sessionStore?.close === "function") {
      await sessionStore.close();
    }
    try {
      await pool.end();
    } catch {
      console.error("Failed to close the MySQL pool after startup failure.");
    }
    throw error;
  }

  console.log(`Fetman application listening at http://${config.host}:${config.port}`);
  let isShuttingDown = false;

  function shutdown(signal) {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    console.log(`Received ${signal}; closing the Fetman application.`);

    Promise.all([
      closeIfListening(server),
    ]).then(async () => {
      try {
        if (typeof sessionStore.close === "function") {
          await sessionStore.close();
        }
        await pool.end();
      } catch {
        console.error("Failed to close the MySQL resources.");
        process.exitCode = 1;
      }
    });
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function waitForListening(server) {
  return new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolve();
    };
    server.once("error", handleError);
    server.once("listening", handleListening);
  });
}

function closeIfListening(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => {
    server.close((error) => {
      if (error) {
        console.error("Failed to close an HTTP server.");
        process.exitCode = 1;
      }
      resolve();
    });
  });
}

startServer().catch((error) => {
  const message = error instanceof Error ? error.message : "";
  const isSafeConfigError =
    /^Invalid environment configuration for: [A-Z0-9_,. ]+(?:\. Review backend\/\.env\.example\.)?$/.test(
      message,
    );
  console.error(
    isSafeConfigError
      ? message
      : "The API could not start. Check the required environment variables, MySQL connection, and approved database setup.",
  );
  if (!isSafeConfigError) {
    console.error("Startup check failed", { errorCode: safeErrorCode(error) });
  }
  process.exitCode = 1;
});
