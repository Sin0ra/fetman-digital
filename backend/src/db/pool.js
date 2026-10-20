const fs = require("node:fs");
const mysql = require("mysql2/promise");

function createPool(config) {
  return mysql.createPool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
    ssl: {
      ca: fs.readFileSync(config.database.tlsCaPath),
      rejectUnauthorized: true,
      verifyIdentity: true,
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: "utf8mb4",
  });
}

module.exports = { createPool };
