const assert = require("node:assert/strict");
const argon2 = require("argon2");
const session = require("express-session");
const { after, before, describe, it } = require("node:test");
const { createApp } = require("../src/app");
const { OWNER_EMAIL } = require("../src/middleware/auth");
const { bootstrapDeveloper } = require("../src/scripts/bootstrap-developer");

const password = "test-owner-password-123";
const config = {
  environment: "test",
  sessionSecret: "test-only-session-secret-with-more-than-32-characters",
  contactRecipient: "owner@example.test",
  smtp: { host: "" },
  mediaDirectory: "/tmp/fetman-test-media",
};
const state = { maintenance: "0", account: null, projects: [], media: [] };
let pool;
let server;
let baseUrl;

function createPool() {
  return {
    async query() { return [[{ result: 1 }], []]; },
    async execute(statement, values = []) {
      const sql = statement.replace(/\s+/g, " ").trim();
      if (sql.includes("SELECT setting_value") && sql.includes("maintenance_mode")) return [[{ setting_value: state.maintenance, updated_at: "2026-11-03 10:00:00" }], []];
      if (sql.includes("SELECT id FROM developer_account WHERE email")) return [state.account && state.account.email === values[0] ? [{ id: state.account.id }] : [], []];
      if (sql.includes("SELECT id, email, password_hash FROM developer_account")) return [state.account && state.account.email === values[0] ? [{ ...state.account }] : [], []];
      if (sql.includes("SELECT id, email FROM developer_account")) return [state.account && String(state.account.id) === String(values[0]) && state.account.email === values[1] ? [{ id: state.account.id, email: state.account.email }] : [], []];
      if (sql.startsWith("SELECT COUNT(*) AS count FROM portfolio_projects WHERE published")) return [[{ count: state.projects.filter((item) => item.published).length }], []];
      if (sql.startsWith("SELECT COUNT(*) AS count FROM portfolio_projects")) return [[{ count: state.projects.length }], []];
      if (sql.startsWith("SELECT COUNT(*) AS count FROM media_assets")) return [[{ count: state.media.length }], []];
      if (sql.startsWith("UPDATE site_settings SET setting_value") && sql.includes("maintenance_mode")) { state.maintenance = values[0]; return [{ affectedRows: 1 }, []]; }
      if (sql.startsWith("SELECT id, title") && sql.includes("portfolio_projects")) return [state.projects.map((item) => ({ ...item })), []];
      if (sql.startsWith("SELECT storage_name") && sql.includes("media_assets")) return [[], []];
      throw new Error(`Unexpected SQL in active-scope test: ${sql}`);
    },
  };
}

function cookie(response) { return response.headers.get("set-cookie")?.split(";", 1)[0]; }
async function csrf(url, existingCookie) {
  const response = await fetch(`${url}/api/auth/csrf`, { headers: existingCookie ? { Cookie: existingCookie } : {} });
  return { response, cookie: cookie(response) || existingCookie, token: (await response.json()).csrfToken };
}
async function login(url, email = OWNER_EMAIL, secret = password) {
  const token = await csrf(url);
  const response = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { Cookie: token.cookie, "Content-Type": "application/json", "X-CSRF-Token": token.token }, body: JSON.stringify({ email, password: secret }) });
  return { response, cookie: cookie(response) };
}

before(async () => {
  state.account = { id: 1, email: OWNER_EMAIL, password_hash: await argon2.hash(password, { type: argon2.argon2id }) };
  pool = createPool();
  server = createApp(config, { pool, sessionStore: new session.MemoryStore() }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

describe("active application authentication and owner portal", () => {
  it("returns health and safe API 404 responses", async () => {
    const health = await fetch(`${baseUrl}/api/health`);
    const missing = await fetch(`${baseUrl}/api/not-found`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok", database: "connected" });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "Not found" });
  });

  it("creates a CSRF-backed session and rejects login without its token", async () => {
    const token = await csrf(baseUrl);
    const rejected = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { Cookie: token.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ email: OWNER_EMAIL, password }) });
    assert.equal(token.response.status, 200);
    assert.equal(rejected.status, 403);
  });

  it("authenticates only the permitted owner and persists the session", async () => {
    const owner = await login(baseUrl);
    assert.equal(owner.response.status, 200);
    assert.deepEqual(await owner.response.json(), { user: { id: "1", email: OWNER_EMAIL } });
    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: owner.cookie } });
    assert.equal(me.status, 200);
    assert.deepEqual((await me.json()).user.email, OWNER_EMAIL);
  });

  it("rejects non-owner credentials with the same generic response", async () => {
    const unknown = await login(baseUrl, "other@example.test");
    assert.equal(unknown.response.status, 401);
    assert.deepEqual(await unknown.response.json(), { error: "Invalid email or password." });
  });

  it("protects portal routes and accepts the owner maintenance update with CSRF", async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/developer/overview`);
    assert.equal(unauthenticated.status, 401);
    const owner = await login(baseUrl);
    const token = await csrf(baseUrl, owner.cookie);
    const update = await fetch(`${baseUrl}/api/developer/maintenance`, { method: "PUT", headers: { Cookie: token.cookie, "X-CSRF-Token": token.token, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) });
    assert.equal(update.status, 200);
    assert.deepEqual(await update.json(), { enabled: true });
    assert.equal(state.maintenance, "1");
  });

  it("keeps public API content inaccessible while maintenance is enabled", async () => {
    state.maintenance = "1";
    const publicResponse = await fetch(`${baseUrl}/api/public/portfolio`);
    const health = await fetch(`${baseUrl}/api/health`);
    const owner = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(publicResponse.status, 503);
    assert.equal(health.status, 200);
    assert.equal(owner.status, 401);
    state.maintenance = "0";
  });

  it("logs out and invalidates the owner session", async () => {
    const owner = await login(baseUrl);
    const token = await csrf(baseUrl, owner.cookie);
    const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { Cookie: token.cookie, "X-CSRF-Token": token.token } });
    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: owner.cookie } });
    assert.equal(logout.status, 204);
    assert.equal(me.status, 401);
  });
});

describe("developer bootstrap", () => {
  it("validates the eight-character minimum and stores only an Argon2id hash", async () => {
    await assert.rejects(() => bootstrapDeveloper({ getConnection: async () => ({}) }, "short"), /at least 8/);
    let inserted;
    const connection = { async query() { return [[{ acquired: 1 }], []]; }, async execute(sql, values) { if (sql.startsWith("SELECT id")) return [[], []]; inserted = values; return [{ insertId: 9 }, []]; }, release() {} };
    const id = await bootstrapDeveloper({ getConnection: async () => connection }, "a-secure-owner-password");
    assert.equal(id, 9);
    assert.equal(inserted[0], OWNER_EMAIL);
    assert.notEqual(inserted[1], "a-secure-owner-password");
    assert.equal(await argon2.verify(inserted[1], "a-secure-owner-password"), true);
  });
});
