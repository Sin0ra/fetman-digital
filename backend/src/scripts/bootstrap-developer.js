const { timingSafeEqual } = require("node:crypto");
const argon2 = require("argon2");
const { loadConfig } = require("../config/env");
const { createPool } = require("../db/pool");

const OWNER_EMAIL = "sinoworkguma@gmail.com";
const LOCK_NAME = "fetman_developer_bootstrap";

async function bootstrapDeveloper(pool, password) {
  if (typeof password !== "string" || password.length < 8) throw new Error("Choose a password of at least 8 characters.");
  const connection = await pool.getConnection(); let locked = false;
  try {
    const [lock] = await connection.query("SELECT GET_LOCK(?, 10) AS acquired", [LOCK_NAME]);
    if (lock[0]?.acquired !== 1) throw new Error("Could not acquire the account setup lock.");
    locked = true;
    const [existing] = await connection.execute("SELECT id FROM developer_account WHERE email = ? LIMIT 1", [OWNER_EMAIL]);
    if (existing.length) throw new Error("The developer account already exists; setup was not changed.");
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const [result] = await connection.execute("INSERT INTO developer_account (email, password_hash) VALUES (?, ?)", [OWNER_EMAIL, hash]);
    return result.insertId;
  } finally { if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]); connection.release(); }
}
function readHidden(promptText) { const input = process.stdin; if (!input.isTTY || typeof input.setRawMode !== "function") return Promise.reject(new Error("Run this setup command in an interactive terminal.")); process.stdout.write(promptText); input.setRawMode(true); input.resume(); return new Promise((resolve, reject) => { let value = ""; const onData = (chunk) => { for (const c of chunk.toString()) { if (c === "\u0003") return finish(new Error("Password entry was cancelled.")); if (c === "\r" || c === "\n") return finish(); if (c === "\u007f" || c === "\b") value = value.slice(0, -1); else if (c >= " ") value += c; } }; const finish = (error) => { input.off("data", onData); input.setRawMode(false); input.pause(); process.stdout.write("\n"); error ? reject(error) : resolve(value); }; input.on("data", onData); }); }
async function main() { const config = loadConfig(); const pool = createPool(config); try { const first = await readHidden(`Password for ${OWNER_EMAIL}: `); const second = await readHidden("Confirm password: "); const a = Buffer.from(first); const b = Buffer.from(second); if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("The passwords do not match."); await bootstrapDeveloper(pool, first); console.log("Developer account created successfully."); } finally { await pool.end(); } }
if (require.main === module) main().catch((error) => { console.error(error instanceof Error ? error.message : "Developer setup failed."); process.exitCode = 1; });
module.exports = { OWNER_EMAIL, bootstrapDeveloper, readHidden };
