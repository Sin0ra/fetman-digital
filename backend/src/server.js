const { createApp } = require("./app");
const { loadConfig } = require("./config/env");
const { createPool } = require("./db/pool");
const { MySQLSessionStore } = require("./db/session-store");

async function startServer() {
  const config = loadConfig();
  const pool = createPool(config);
  let sessionStore;
  let app;
  try {
    sessionStore = new MySQLSessionStore(pool);
    await pool.query("SELECT 1");
    await pool.query("SELECT id FROM management_users LIMIT 0");
    await pool.query("SELECT session_id FROM management_sessions LIMIT 0");
    app = createApp(config, { pool, sessionStore });
  } catch (error) {
    sessionStore?.close();
    try {
      await pool.end();
    } catch {
      console.error("Failed to close the MySQL pool after startup failure.");
    }
    throw error;
  }

  const server = app.listen(config.port, "127.0.0.1", () => {
    console.log(`Fetman management API listening at http://localhost:${config.port}`);
  });
  let isShuttingDown = false;

  function shutdown(signal) {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    console.log(`Received ${signal}; closing the API server.`);

    server.close(async (error) => {
      if (error) {
        console.error("Failed to close the API server.");
        process.exitCode = 1;
      }

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

startServer().catch((error) => {
  const message = error instanceof Error ? error.message : "";
  const isSafeConfigError =
    /^Invalid environment configuration for: [A-Z0-9_,. ]+\. Review backend\/\.env\.example\.$/.test(
      message,
    );
  console.error(
    isSafeConfigError
      ? message
      : "The API could not start. Check the required environment variables, MySQL connection, and approved database setup.",
  );
  process.exitCode = 1;
});
