const { createApp } = require("./app");
const { loadConfig } = require("./config/env");
const { createPool } = require("./db/pool");
const { MySQLSessionStore } = require("./db/session-store");
const {
  safeErrorCode,
  verifyMaintenanceModeStorage,
} = require("./maintenance-mode");
const { createPublicSiteApp } = require("./public-site");

async function startServer() {
  const config = loadConfig();
  const pool = createPool(config);
  let sessionStore;
  let app;
  let publicSiteApp;
  let server;
  let publicSiteServer;
  try {
    sessionStore = new MySQLSessionStore(pool);
    await pool.query("SELECT 1");
    await pool.query("SELECT id FROM management_users LIMIT 0");
    await pool.query("SELECT session_id FROM management_sessions LIMIT 0");
    await verifyMaintenanceModeStorage(pool);
    app = createApp(config, { pool, sessionStore });
    publicSiteApp = createPublicSiteApp({ pool });
    server = app.listen(config.port, "127.0.0.1");
    publicSiteServer = publicSiteApp.listen(config.publicSitePort, "127.0.0.1");
    await Promise.all([
      waitForListening(server),
      waitForListening(publicSiteServer),
    ]);
  } catch (error) {
    await Promise.all(
      [server, publicSiteServer].filter(Boolean).map(closeIfListening),
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

  console.log(`Fetman management API listening at http://localhost:${config.port}`);
  console.log(`Fetman public website listening at http://localhost:${config.publicSitePort}`);
  let isShuttingDown = false;

  function shutdown(signal) {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    console.log(`Received ${signal}; closing the management API and public website.`);

    Promise.all([
      closeIfListening(server),
      closeIfListening(publicSiteServer),
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
