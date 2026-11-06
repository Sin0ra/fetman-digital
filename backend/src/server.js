const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { createApp } = require("./app");
const { loadConfig } = require("./config/env");
const { createPool } = require("./db/pool");
const { MySQLSessionStore } = require("./db/session-store");

async function startServer() {
  const config = loadConfig(); const pool = createPool(config); const sessionStore = new MySQLSessionStore(pool);
  const frontend = path.resolve(__dirname, "../../management-frontend/dist"); let server;
  try {
    if (!fs.existsSync(path.join(frontend, "index.html"))) throw new Error("The management frontend build is missing. Run npm run build first.");
    await ensurePersistentMediaDirectory(config.mediaDirectory);
    const app = createApp(config, { pool, sessionStore, publicSiteDirectory: path.resolve(__dirname, "../.."), managementFrontendDirectory: frontend, startupReady: false });
    server = app.listen(config.port, config.host); await onceListening(server);
    await pool.query("SELECT 1");
    await pool.query("SELECT id FROM developer_account LIMIT 0");
    await pool.query("SELECT session_id FROM sessions LIMIT 0");
    await pool.query("SELECT setting_key FROM site_settings LIMIT 0");
    app.locals.startupReady = true;
    console.log("SMTP environment availability", config.smtp.environmentAvailability);
    console.log(`Fetman application listening at http://${config.host}:${config.port}`);
    const shutdown = async () => { await new Promise((resolve) => server.close(resolve)); sessionStore.close(); await pool.end(); };
    process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
  } catch (error) { if (server?.listening) server.close(); sessionStore.close(); await pool.end(); throw error; }
}
async function ensurePersistentMediaDirectory(directory) {
  try {
    await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
    await fsp.access(directory, fs.constants.R_OK | fs.constants.W_OK);
  } catch (error) {
    throw new Error(`Persistent media storage is unavailable at the configured location (${error.code || "storage error"}).`);
  }
}
function onceListening(server) { return new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); }); }
startServer().catch((error) => { console.error(error instanceof Error ? error.message : "The API could not start."); process.exitCode = 1; });
