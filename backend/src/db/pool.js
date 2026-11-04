const mysql = require("mysql2/promise");
const { isLoopbackHost } = require("../config/env");

function createPool(config) {
  const connectionConfig = {
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: "utf8mb4",
  };

  if (config.database.tlsMode === "loopback-plaintext") {
    if (!isLoopbackHost(config.database.host)) {
      throw new Error("Plaintext MySQL is permitted only for an explicitly configured loopback host.");
    }
    return mysql.createPool(connectionConfig);
  }

  connectionConfig.ssl = { rejectUnauthorized: true, verifyIdentity: true };
  if (config.database.tlsCaPath) {
    connectionConfig.ssl.ca = require("node:fs").readFileSync(config.database.tlsCaPath);
  }
  return mysql.createPool(connectionConfig);
}

module.exports = { createPool };
