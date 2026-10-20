const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { it } = require("node:test");
const { createPool } = require("../src/db/pool");

it("configures MySQL TLS with the supplied CA and identity verification", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fetman-mysql-tls-"));
  const caPath = path.join(directory, "ca.pem");
  const caCertificate = Buffer.from("test CA certificate");
  fs.writeFileSync(caPath, caCertificate);

  const pool = createPool({
    database: {
      host: "localhost",
      port: 3306,
      name: "fetman_management",
      user: "fetman_app",
      password: "test-only-password",
      tlsCaPath: caPath,
    },
  });

  context.after(async () => {
    await pool.end();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const ssl = pool.pool.config.connectionConfig.ssl;
  assert.deepEqual(ssl.ca, caCertificate);
  assert.equal(ssl.rejectUnauthorized, true);
  assert.equal(ssl.verifyIdentity, true);
});
