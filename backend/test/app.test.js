const assert = require("node:assert/strict");
const argon2 = require("argon2");
const express = require("express");
const session = require("express-session");
const { after, before, describe, it } = require("node:test");
const { z } = require("zod");
const { createApp } = require("../src/app");
const { parseConfig } = require("../src/config/env");
const { MySQLSessionStore } = require("../src/db/session-store");
const { validate } = require("../src/middleware/validate");
const {
  INITIAL_DEVELOPER_EMAIL,
  bootstrapDeveloper,
  validatePassword,
} = require("../src/scripts/bootstrap-developer");

const testPassword = "test-only-password-for-authentication";
const config = {
  environment: "test",
  sessionSecret: "test-only-session-secret-with-more-than-32-characters",
  corsOrigins: ["http://localhost:5173"],
};
const state = { databaseAvailable: true };
let users;
let pool;
let server;
let baseUrl;

function createPool() {
  return {
    async query() {
      if (!state.databaseAvailable) {
        throw new Error("database unavailable");
      }
      return [[{ result: 1 }], []];
    },
    async execute(sql, parameters) {
      if (sql.includes("WHERE email = ?")) {
        return [users.filter((user) => user.email === parameters[0]), []];
      }
      if (sql.includes("WHERE id = ?")) {
        return [users.filter((user) => user.id === parameters[0]), []];
      }
      if (sql.includes("FROM graphic_design_tasks")) {
        return [[], []];
      }
      throw new Error("Unexpected SQL in test pool");
    },
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async execute(sql, parameters) {
          if (sql.includes("FROM management_users WHERE id = ? AND is_active = 1")) {
            return [
              users.filter(
                (user) =>
                  user.id === parameters[0] &&
                  (user.is_active === 1 || user.is_active === true),
              ),
              [],
            ];
          }
          if (sql.startsWith("DELETE FROM management_sessions")) {
            return [{ affectedRows: 1 }, []];
          }
          if (sql.includes("UPDATE management_users") && sql.includes("password_hash")) {
            const user = users.find((item) => item.id === parameters[1]);
            if (user) {
              user.password_hash = parameters[0];
              user.password_change_required = 0;
            }
            return [{ affectedRows: user ? 1 : 0 }, []];
          }
          throw new Error("Unexpected transaction SQL in test pool");
        },
      };
    },
  };
}

class TestSessionStore extends session.MemoryStore {
  async deleteUserSessions(userId, executor) {
    await executor.execute("DELETE FROM management_sessions", [String(userId)]);
    for (const [sessionId, serialized] of Object.entries(this.sessions)) {
      const value = JSON.parse(serialized);
      if (String(value.userId) === String(userId)) {
        await new Promise((resolve, reject) =>
          this.destroy(sessionId, (error) => (error ? reject(error) : resolve())),
        );
      }
    }
  }
}

function startTestServer(
  testPool = pool,
  loginLimit = 20,
  sessionStore = new TestSessionStore(),
  appConfig = config,
) {
  const app = createApp(appConfig, {
    pool: testPool,
    sessionStore,
    loginLimit,
    passwordChangeLimit: 100,
  });
  const testServer = app.listen(0);

  return new Promise((resolve, reject) => {
    testServer.once("listening", () => {
      resolve({
        server: testServer,
        url: `http://127.0.0.1:${testServer.address().port}`,
        sessionStore,
      });
    });
    testServer.once("error", reject);
  });
}

function getCookie(response) {
  const setCookie = response.headers.get("set-cookie");
  return setCookie ? setCookie.split(";", 1)[0] : undefined;
}

async function closeServer(testServer) {
  await new Promise((resolve, reject) => {
    testServer.close((error) => (error ? reject(error) : resolve()));
  });
}

async function createCsrfToken(url, cookie) {
  const response = await fetch(`${url}/api/auth/csrf`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  return {
    response,
    cookie: getCookie(response) ?? cookie,
    csrfToken: (await response.json()).csrfToken,
  };
}

async function login(url, cookie, csrfToken, credentials) {
  return fetch(`${url}/api/auth/login`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify(credentials),
  });
}

before(async () => {
  const passwordHash = await argon2.hash(testPassword, { type: argon2.argon2id });
  users = [
    {
      id: 1,
      email: INITIAL_DEVELOPER_EMAIL,
      password_hash: passwordHash,
      role: "Developer",
      is_active: 1,
      password_change_required: 0,
    },
    {
      id: 2,
      email: "designer@example.test",
      password_hash: passwordHash,
      role: "Graphic Design",
      is_active: 1,
      password_change_required: 0,
    },
  ];
  pool = createPool();
  const testApp = await startTestServer();
  server = testApp.server;
  baseUrl = testApp.url;
});

after(async () => {
  await closeServer(server);
});

describe("management API and Developer authentication", () => {
  it("serves safe liveness and database status with security headers", async () => {
    const response = await fetch(`${baseUrl}/api/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", database: "connected" });
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-powered-by"), null);
  });

  it("reports database outages without leaking internal errors", async () => {
    state.databaseAvailable = false;
    const response = await fetch(`${baseUrl}/api/health`);
    const responseBody = await response.text();
    state.databaseAvailable = true;

    assert.equal(response.status, 503);
    assert.deepEqual(JSON.parse(responseBody), {
      status: "unavailable",
      database: "unavailable",
    });
    assert.equal(responseBody.includes("database unavailable"), false);
  });

  it("allows only configured browser origins and supports credentialed requests", async () => {
    const allowed = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: "http://localhost:5173" },
    });
    const rejected = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: "https://unapproved.example" },
    });

    assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:5173");
    assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
    assert.equal(rejected.headers.get("access-control-allow-origin"), null);
  });

  it("returns a safe not-found response", async () => {
    const response = await fetch(`${baseUrl}/api/missing`);

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Not found" });
  });

  it("rejects invalid configuration without exposing environment values", () => {
    const secret = "do-not-include-this-in-errors";

    assert.throws(
      () =>
        parseConfig({
          NODE_ENV: "test",
          CORS_ORIGINS: "*",
          DB_HOST: "127.0.0.1",
          DB_NAME: "fetman_management",
          DB_USER: "fetman_app",
          DB_PASSWORD: secret,
          DB_TLS_CA_PATH: "C:/ProgramData/FetmanDigital/MySQLTLS/fetman-dev-ca.pem",
          SESSION_SECRET: "test-only-session-secret-with-more-than-32-characters",
        }),
      (error) => {
        assert.match(error.message, /CORS_ORIGINS/);
        assert.equal(error.message.includes(secret), false);
        return true;
      },
    );
  });

  it("identifies missing environment variable names", () => {
    assert.throws(
      () => parseConfig({ NODE_ENV: "test" }),
      (error) => {
        assert.match(error.message, /DB_HOST/);
        assert.match(error.message, /SESSION_SECRET/);
        return true;
      },
    );
  });

  it("requires an absolute path to the MySQL TLS CA certificate", () => {
    assert.throws(
      () =>
        parseConfig({
          NODE_ENV: "test",
          CORS_ORIGINS: "http://localhost:5173",
          DB_HOST: "localhost",
          DB_NAME: "fetman_management",
          DB_USER: "fetman_app",
          DB_PASSWORD: testPassword,
          DB_TLS_CA_PATH: "ca.pem",
          SESSION_SECRET: "test-only-session-secret-with-more-than-32-characters",
        }),
      /DB_TLS_CA_PATH/,
    );
  });

  it("rejects unauthenticated access to protected routes", async () => {
    const response = await fetch(`${baseUrl}/api/developer/dashboard`);

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Authentication required" });
  });

  it("requires a CSRF token before login", async () => {
    const { cookie } = await createCsrfToken(baseUrl);
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ email: INITIAL_DEVELOPER_EMAIL, password: testPassword }),
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Invalid request token." });
  });

  it("does not issue production session cookies over HTTP", async () => {
    const productionApp = await startTestServer(
      pool,
      20,
      new session.MemoryStore(),
      { ...config, environment: "production" },
    );

    try {
      const csrf = await createCsrfToken(productionApp.url);
      assert.equal(csrf.response.headers.get("set-cookie"), null);
    } finally {
      await closeServer(productionApp.server);
    }
  });

  it("authenticates a valid user and preserves the server session across requests", async () => {
    const csrf = await createCsrfToken(baseUrl);
    const response = await login(baseUrl, csrf.cookie, csrf.csrfToken, {
      email: INITIAL_DEVELOPER_EMAIL.toUpperCase(),
      password: testPassword,
    });
    const authCookie = getCookie(response);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      user: {
        id: "1",
        email: INITIAL_DEVELOPER_EMAIL,
        role: "Developer",
        passwordChangeRequired: false,
      },
    });
    assert.ok(authCookie);
    assert.notEqual(authCookie, csrf.cookie, "login should regenerate the session identifier");
    assert.match(response.headers.get("set-cookie"), /HttpOnly/i);
    assert.match(response.headers.get("set-cookie"), /SameSite=Lax/i);

    const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: authCookie },
    });
    const dashboardResponse = await fetch(`${baseUrl}/api/developer/dashboard`, {
      headers: { Cookie: authCookie },
    });

    assert.equal(meResponse.status, 200);
    assert.deepEqual(await meResponse.json(), {
      user: {
        id: "1",
        email: INITIAL_DEVELOPER_EMAIL,
        role: "Developer",
        passwordChangeRequired: false,
      },
    });
    assert.equal(dashboardResponse.status, 200);
    assert.deepEqual(await dashboardResponse.json(), {
      user: { email: INITIAL_DEVELOPER_EMAIL, role: "Developer" },
      status: "authenticated",
    });
  });

  it("restores a session through the MySQL store after the API restarts", async () => {
    const persistedSessions = new Map();
    const persistentPool = {
      async query() {
        return [[{ result: 1 }], []];
      },
      async execute(sql, parameters) {
        if (sql.includes("FROM management_users WHERE email = ?")) {
          return [users.filter((user) => user.email === parameters[0]), []];
        }
        if (sql.includes("FROM management_users WHERE id = ?")) {
          return [users.filter((user) => user.id === parameters[0]), []];
        }
        if (sql.startsWith("SELECT data FROM management_sessions")) {
          const record = persistedSessions.get(parameters[0]);
          return [
            record && record.expires > parameters[1] ? [{ data: record.data }] : [],
            [],
          ];
        }
        if (sql.startsWith("INSERT INTO management_sessions")) {
          persistedSessions.set(parameters[0], {
            expires: parameters[1],
            data: parameters[2],
          });
          return [{ affectedRows: 1 }, []];
        }
        if (sql.startsWith("UPDATE management_sessions")) {
          const record = persistedSessions.get(parameters[1]);
          if (record) record.expires = parameters[0];
          return [{ affectedRows: record ? 1 : 0 }, []];
        }
        if (sql.startsWith("DELETE FROM management_sessions WHERE session_id")) {
          persistedSessions.delete(parameters[0]);
          return [{ affectedRows: 1 }, []];
        }
        if (sql.startsWith("DELETE FROM management_sessions WHERE expires")) {
          for (const [id, record] of persistedSessions) {
            if (record.expires <= parameters[0]) persistedSessions.delete(id);
          }
          return [{ affectedRows: 1 }, []];
        }
        throw new Error("Unexpected SQL in persistent session test");
      },
    };
    const firstApp = await startTestServer(
      persistentPool,
      20,
      new MySQLSessionStore(persistentPool),
    );

    let authCookie;
    try {
      const csrf = await createCsrfToken(firstApp.url);
      const loginResponse = await login(firstApp.url, csrf.cookie, csrf.csrfToken, {
        email: INITIAL_DEVELOPER_EMAIL,
        password: testPassword,
      });
      authCookie = getCookie(loginResponse);
      assert.equal(loginResponse.status, 200);
      assert.ok(persistedSessions.size > 0);
    } finally {
      await closeServer(firstApp.server);
      firstApp.sessionStore.close();
    }

    const restartedApp = await startTestServer(
      persistentPool,
      20,
      new MySQLSessionStore(persistentPool),
    );
    try {
      const response = await fetch(`${restartedApp.url}/api/auth/me`, {
        headers: { Cookie: authCookie },
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        user: {
          id: "1",
          email: INITIAL_DEVELOPER_EMAIL,
          role: "Developer",
          passwordChangeRequired: false,
        },
      });
    } finally {
      await closeServer(restartedApp.server);
      restartedApp.sessionStore.close();
    }
  });

  it("uses the same generic failure for incorrect passwords and unknown emails", async () => {
    const csrf = await createCsrfToken(baseUrl);
    const wrongPassword = await login(baseUrl, csrf.cookie, csrf.csrfToken, {
      email: INITIAL_DEVELOPER_EMAIL,
      password: "a-different-invalid-password",
    });
    const unknownEmail = await login(baseUrl, csrf.cookie, csrf.csrfToken, {
      email: "unknown@example.test",
      password: testPassword,
    });

    assert.equal(wrongPassword.status, 401);
    const wrongPasswordBody = await wrongPassword.json();
    const unknownEmailBody = await unknownEmail.json();
    assert.deepEqual(wrongPasswordBody, unknownEmailBody);
    assert.deepEqual(wrongPasswordBody, { error: "Invalid email or password." });
  });

  it("rejects malformed login input", async () => {
    const csrf = await createCsrfToken(baseUrl);
    const response = await login(baseUrl, csrf.cookie, csrf.csrfToken, {
      email: "not-an-email",
      password: testPassword,
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Invalid request data",
      issues: [{ path: ["email"], message: "Invalid email address" }],
    });
  });

  it("denies a valid non-Developer account from the Developer route", async () => {
    const csrf = await createCsrfToken(baseUrl);
    const response = await login(baseUrl, csrf.cookie, csrf.csrfToken, {
      email: "designer@example.test",
      password: testPassword,
    });
    const authCookie = getCookie(response);
    const dashboardResponse = await fetch(`${baseUrl}/api/developer/dashboard`, {
      headers: { Cookie: authCookie },
    });

    assert.equal(response.status, 200);
    assert.equal(dashboardResponse.status, 403);
    assert.deepEqual(await dashboardResponse.json(), { error: "Forbidden" });
  });

  it("invalidates a session after logout", async () => {
    const csrf = await createCsrfToken(baseUrl);
    const loginResponse = await login(baseUrl, csrf.cookie, csrf.csrfToken, {
      email: INITIAL_DEVELOPER_EMAIL,
      password: testPassword,
    });
    const authCookie = getCookie(loginResponse);
    const logoutCsrf = await createCsrfToken(baseUrl, authCookie);
    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: {
        Cookie: logoutCsrf.cookie,
        "X-CSRF-Token": logoutCsrf.csrfToken,
      },
    });
    const protectedResponse = await fetch(`${baseUrl}/api/developer/dashboard`, {
      headers: { Cookie: authCookie },
    });

    assert.equal(logoutResponse.status, 204);
    assert.equal(protectedResponse.status, 401);
  });

  it("changes the authenticated user's password and keeps only a fresh session", async () => {
    const firstLoginCsrf = await createCsrfToken(baseUrl);
    const firstLogin = await login(baseUrl, firstLoginCsrf.cookie, firstLoginCsrf.csrfToken, {
      email: INITIAL_DEVELOPER_EMAIL,
      password: testPassword,
    });
    const firstCookie = getCookie(firstLogin);
    const otherLoginCsrf = await createCsrfToken(baseUrl);
    const otherLogin = await login(baseUrl, otherLoginCsrf.cookie, otherLoginCsrf.csrfToken, {
      email: INITIAL_DEVELOPER_EMAIL,
      password: testPassword,
    });
    const otherCookie = getCookie(otherLogin);
    const csrf = await createCsrfToken(baseUrl, firstCookie);
    const newPassword = "new-password-for-current-user";
    const oldPasswordHash = users[0].password_hash;
    const response = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: {
        Cookie: csrf.cookie,
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf.csrfToken,
      },
      body: JSON.stringify({
        currentPassword: testPassword,
        newPassword,
        passwordConfirmation: newPassword,
      }),
    });
    const freshCookie = getCookie(response);
    const body = await response.json();
    const freshSession = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: freshCookie },
    });
    const revokedFirstSession = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: firstCookie },
    });
    const revokedOtherSession = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: otherCookie },
    });
    assert.equal(response.status, 200);
    assert.ok(freshCookie);
    assert.notEqual(freshCookie, firstCookie);
    assert.equal(JSON.stringify(body).includes(newPassword), false);
    assert.equal(JSON.stringify(body).includes(testPassword), false);
    assert.equal(JSON.stringify(body).includes(oldPasswordHash), false);
    assert.equal("password_hash" in body, false);
    assert.equal(freshSession.status, 200);
    assert.equal(revokedFirstSession.status, 401);
    assert.equal(revokedOtherSession.status, 401);
    assert.equal(await argon2.verify(users[0].password_hash, newPassword), true);
    assert.equal(users[0].password_change_required, 0);

    const newLoginCsrf = await createCsrfToken(baseUrl);
    const newLogin = await login(baseUrl, newLoginCsrf.cookie, newLoginCsrf.csrfToken, {
      email: INITIAL_DEVELOPER_EMAIL,
      password: newPassword,
    });

    assert.equal(newLogin.status, 200);
    users[0].password_hash = await argon2.hash(testPassword, { type: argon2.argon2id });
  });

  it("forces reset accounts through password change before protected API access", async () => {
    users[1].password_change_required = 1;
    const designerCsrf = await createCsrfToken(baseUrl);
    const designerLogin = await login(baseUrl, designerCsrf.cookie, designerCsrf.csrfToken, {
      email: "designer@example.test",
      password: testPassword,
    });
    const designerCookie = getCookie(designerLogin);
    const designerBody = await designerLogin.json();
    const restrictedDashboard = await fetch(`${baseUrl}/api/developer/dashboard`, {
      headers: { Cookie: designerCookie },
    });
    const restrictedWorkspace = await fetch(`${baseUrl}/api/graphic-design/tasks`, {
      headers: { Cookie: designerCookie },
    });
    const restrictedUsers = await fetch(`${baseUrl}/api/developer/users`, {
      headers: { Cookie: designerCookie },
    });
    const unauthenticatedDashboard = await fetch(`${baseUrl}/api/developer/dashboard`);

    assert.equal(designerBody.user.passwordChangeRequired, true);
    for (const response of [restrictedDashboard, restrictedWorkspace, restrictedUsers]) {
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "PASSWORD_CHANGE_REQUIRED");
    }
    assert.equal(unauthenticatedDashboard.status, 401);

    const token = await createCsrfToken(baseUrl, designerCookie);
    const reusingTemporaryPassword = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: {
        Cookie: token.cookie,
        "Content-Type": "application/json",
        "X-CSRF-Token": token.csrfToken,
      },
      body: JSON.stringify({
        newPassword: testPassword,
        passwordConfirmation: testPassword,
      }),
    });
    assert.equal(reusingTemporaryPassword.status, 400);

    const preferredPassword = "designer-preferred-password-long";
    const changed = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: {
        Cookie: token.cookie,
        "Content-Type": "application/json",
        "X-CSRF-Token": token.csrfToken,
      },
      body: JSON.stringify({
        newPassword: preferredPassword,
        passwordConfirmation: preferredPassword,
      }),
    });
    const freshCookie = getCookie(changed);
    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: freshCookie },
    });
    const workspace = await fetch(`${baseUrl}/api/graphic-design/tasks`, {
      headers: { Cookie: freshCookie },
    });

    assert.equal(changed.status, 200);
    assert.equal(users[1].password_change_required, 0);
    assert.equal((await me.json()).user.passwordChangeRequired, false);
    assert.equal(workspace.status, 200);
    assert.equal(await argon2.verify(users[1].password_hash, preferredPassword), true);
  });

  it("continues allowing existing accounts without a pending password change", async () => {
    users[1].password_hash = await argon2.hash(testPassword, {
      type: argon2.argon2id,
    });
    users[1].password_change_required = 0;
    const csrf = await createCsrfToken(baseUrl);
    const response = await login(baseUrl, csrf.cookie, csrf.csrfToken, {
      email: "designer@example.test",
      password: testPassword,
    });
    const body = await response.json();
    const cookie = getCookie(response);
    const workspace = await fetch(`${baseUrl}/api/graphic-design/tasks`, {
      headers: { Cookie: cookie },
    });

    assert.equal(body.user.passwordChangeRequired, false);
    assert.equal(workspace.status, 200);
  });

  it("rejects password changes with an incorrect current password or mismatched new passwords", async () => {
    const loginCsrf = await createCsrfToken(baseUrl);
    const authenticated = await login(baseUrl, loginCsrf.cookie, loginCsrf.csrfToken, {
      email: INITIAL_DEVELOPER_EMAIL,
      password: testPassword,
    });
    const cookie = getCookie(authenticated);
    const csrf = await createCsrfToken(baseUrl, cookie);
    const missingCsrf = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: testPassword,
        newPassword: "new-password-for-current-user",
        passwordConfirmation: "new-password-for-current-user",
      }),
    });
    const mismatch = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: {
        Cookie: csrf.cookie,
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf.csrfToken,
      },
      body: JSON.stringify({
        currentPassword: testPassword,
        newPassword: "new-password-for-current-user",
        passwordConfirmation: "another-password-for-current-user",
      }),
    });
    const wrongCurrent = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: {
        Cookie: csrf.cookie,
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf.csrfToken,
      },
      body: JSON.stringify({
        currentPassword: "not-the-current-password",
        newPassword: "new-password-for-current-user",
        passwordConfirmation: "new-password-for-current-user",
      }),
    });

    assert.equal(missingCsrf.status, 403);
    assert.equal(mismatch.status, 400);
    assert.equal(wrongCurrent.status, 400);
    assert.deepEqual(await wrongCurrent.json(), {
      error: "The current password is incorrect.",
    });
    assert.equal(await argon2.verify(users[0].password_hash, testPassword), true);
  });

  it("limits repeated login attempts", async () => {
    const limitedApp = await startTestServer(pool, 2);
    try {
      const csrf = await createCsrfToken(limitedApp.url);
      let cookie = csrf.cookie;
      const responses = [];

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await login(limitedApp.url, cookie, csrf.csrfToken, {
          email: INITIAL_DEVELOPER_EMAIL,
          password: "wrong-password",
        });
        responses.push(response);
        cookie = getCookie(response) ?? cookie;
      }

      assert.deepEqual(responses.map((response) => response.status), [401, 401, 429]);
      assert.deepEqual(await responses[2].json(), {
        error: "Too many login attempts. Try again later.",
      });
    } finally {
      await closeServer(limitedApp.server);
    }
  });

  it("validates request bodies before invoking a route handler", async () => {
    const validationApp = express();
    validationApp.use(express.json());
    validationApp.post(
      "/example",
      validate(z.object({ name: z.string().min(2) })),
      (request, response) => response.json(request.body),
    );

    const validationServer = validationApp.listen(0);

    try {
      await new Promise((resolve, reject) => {
        validationServer.once("listening", resolve);
        validationServer.once("error", reject);
      });

      const url = `http://127.0.0.1:${validationServer.address().port}/example`;
      const invalidResponse = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "A" }),
      });
      const validResponse = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Ada" }),
      });

      assert.equal(invalidResponse.status, 400);
      assert.deepEqual(await validResponse.json(), { name: "Ada" });
    } finally {
      await closeServer(validationServer);
    }
  });

  it("validates bootstrap password requirements", () => {
    assert.throws(() => validatePassword("short"), /15 and 128 characters/);
    assert.doesNotThrow(() => validatePassword("a-long-private-test-passphrase"));
  });

  it("stores only an Argon2id hash when bootstrapping the first Developer", async () => {
    const password = "bootstrap-test-passphrase-only";
    let insertedSql;
    let insertedValues;
    const connection = {
      async query(sql) {
        if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }], []];
        return [[{ released: 1 }], []];
      },
      async execute(sql, values) {
        if (sql.startsWith("SELECT id")) return [[], []];
        if (sql.startsWith("INSERT INTO management_users")) {
          insertedSql = sql;
          insertedValues = values;
          return [{ insertId: 10 }, []];
        }
        throw new Error("Unexpected bootstrap SQL in test");
      },
      release() {},
    };
    const mockPool = { async getConnection() { return connection; } };

    const id = await bootstrapDeveloper(mockPool, password);

    assert.equal(id, 10);
    assert.deepEqual(
      [insertedValues[0], insertedValues[2]],
      [INITIAL_DEVELOPER_EMAIL, "Developer"],
    );
    assert.notEqual(insertedValues[1], password);
    assert.equal(await argon2.verify(insertedValues[1], password), true);
    assert.match(insertedSql, /password_change_required/);
  });

  it("refuses a duplicate initial Developer account", async () => {
    let createdAccount = false;
    const connection = {
      async query() {
        return [[{ acquired: 1 }], []];
      },
      async execute(sql) {
        if (sql.startsWith("SELECT id")) return [[{ id: 1 }], []];
        createdAccount = true;
        return [{ insertId: 2 }, []];
      },
      release() {},
    };

    await assert.rejects(
      bootstrapDeveloper({ async getConnection() { return connection; } }, testPassword),
      /already exists/,
    );
    assert.equal(createdAccount, false);
  });
});
