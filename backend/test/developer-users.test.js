const assert = require("node:assert/strict");
const argon2 = require("argon2");
const session = require("express-session");
const { after, before, beforeEach, describe, it } = require("node:test");
const { createApp } = require("../src/app");

const password = "test-only-user-management-password";
const config = {
  environment: "test",
  sessionSecret: "test-only-session-secret-with-more-than-32-characters",
  corsOrigins: ["http://localhost:5173"],
};
const database = { users: [] };
let passwordHash;
let server;
let baseUrl;

function resetUsers() {
  database.users = [
    {
      id: 1,
      email: "developer@example.test",
      password_hash: passwordHash,
      role: "Developer",
      is_active: 1,
      password_change_required: 0,
      created_at: "2026-10-19 10:00:00",
      updated_at: "2026-10-19 10:00:00",
    },
    {
      id: 2,
      email: "designer@example.test",
      password_hash: passwordHash,
      role: "Graphic Design",
      is_active: 1,
      password_change_required: 0,
      created_at: "2026-10-19 10:00:00",
      updated_at: "2026-10-19 10:00:00",
    },
  ];
}

function selectUserById(id) {
  return database.users.filter((user) => String(user.id) === String(id));
}

function createPool() {
  return {
    async execute(sql, parameters = []) {
      const statement = sql.replace(/\s+/g, " ").trim();
      if (statement.includes("FROM management_users WHERE email = ?")) {
        return [
          database.users.filter((user) => user.email === parameters[0]),
          [],
        ];
      }
      if (statement.includes("FROM management_users WHERE id = ?")) {
        return [selectUserById(parameters[0]), []];
      }
      if (statement.startsWith("SELECT id, email, role, is_active, created_at")) {
        let users = [...database.users];
        let index = 0;
        if (statement.includes("email LIKE ?")) {
          const term = parameters[index++].replaceAll("%", "");
          users = users.filter((user) => user.email.includes(term));
        }
        if (statement.includes("role = ?")) {
          const role = parameters[index++];
          users = users.filter((user) => user.role === role);
        }
        if (statement.includes("is_active = ?")) {
          const isActive = parameters[index++];
          users = users.filter((user) => user.is_active === isActive);
        }
        if (statement.includes("WHERE id = ?")) {
          users = selectUserById(parameters[0]);
        }
        return [users.map((user) => ({ ...user })), []];
      }
      if (statement.startsWith("INSERT INTO management_users")) {
        if (database.users.some((user) => user.email === parameters[0])) {
          const error = new Error("Duplicate email");
          error.code = "ER_DUP_ENTRY";
          throw error;
        }
        const user = {
          id: Math.max(...database.users.map((item) => item.id), 0) + 1,
          email: parameters[0],
          password_hash: parameters[1],
          role: parameters[2],
          is_active: parameters[3],
          password_change_required: 1,
          created_at: "2026-10-19 11:00:00",
          updated_at: "2026-10-19 11:00:00",
        };
        database.users.push(user);
        return [{ insertId: user.id, affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected test SQL: ${statement}`);
    },
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async execute(sql, parameters = []) {
          const statement = sql.replace(/\s+/g, " ").trim();
          if (statement.startsWith("SELECT id FROM management_users WHERE role")) {
            return [
              database.users
                .filter((user) => user.role === "Developer" && user.is_active === 1)
                .map(({ id }) => ({ id })),
              [],
            ];
          }
          if (statement.startsWith("SELECT id, role, is_active FROM management_users")) {
            return [
              selectUserById(parameters[0]).map(({ id, role, is_active }) => ({
                id,
                role,
                is_active,
              })),
              [],
            ];
          }
          if (statement.startsWith("DELETE FROM management_sessions")) {
            return [{ affectedRows: 1 }, []];
          }
          if (statement.startsWith("UPDATE management_users") && statement.includes("password_hash")) {
            const user = database.users.find(
              (item) => String(item.id) === String(parameters[1]),
            );
            if (user) {
              user.password_hash = parameters[0];
              if (statement.includes("password_change_required = 1")) {
                user.password_change_required = 1;
              }
              if (statement.includes("password_change_required = 0")) {
                user.password_change_required = 0;
              }
            }
            return [{ affectedRows: user ? 1 : 0 }, []];
          }
          if (statement.includes("FROM management_users WHERE id = ?")) {
            return [selectUserById(parameters[0]).map((user) => ({ ...user })), []];
          }
          if (statement.startsWith("UPDATE management_users")) {
            const user = database.users.find(
              (item) => String(item.id) === String(parameters[3]),
            );
            if (!user) return [{ affectedRows: 0 }, []];
            [user.email, user.role, user.is_active] = parameters.slice(0, 3);
            return [{ affectedRows: 1 }, []];
          }
          if (statement.startsWith("SELECT id, email, role, is_active, created_at")) {
            return [selectUserById(parameters[0]).map((user) => ({ ...user })), []];
          }
          throw new Error(`Unexpected transaction SQL: ${statement}`);
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

async function startTestServer() {
  const app = createApp(config, {
    pool: createPool(),
    sessionStore: new TestSessionStore(),
    loginLimit: 100,
    passwordResetLimit: 100,
  });
  const testServer = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    testServer.once("listening", resolve);
    testServer.once("error", reject);
  });
  return {
    server: testServer,
    url: `http://127.0.0.1:${testServer.address().port}`,
  };
}

function getCookie(response) {
  const value = response.headers.get("set-cookie");
  return value ? value.split(";", 1)[0] : undefined;
}

async function getCsrfToken(cookie) {
  const response = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  const result = await response.json();
  return { cookie: getCookie(response) ?? cookie, csrfToken: result.csrfToken };
}

async function login(email = "developer@example.test", loginPassword = password) {
  const csrf = await getCsrfToken();
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      Cookie: csrf.cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf.csrfToken,
    },
    body: JSON.stringify({ email, password: loginPassword }),
  });
  return { response, cookie: getCookie(response) };
}

async function sendCsrfMutation(path, cookie, method, body) {
  const csrf = await getCsrfToken(cookie);
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Cookie: csrf.cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf.csrfToken,
    },
    body: JSON.stringify(body),
  });
}

before(async () => {
  passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const testApp = await startTestServer();
  server = testApp.server;
  baseUrl = testApp.url;
});

beforeEach(resetUsers);

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("Developer user management", () => {
  it("rejects unauthenticated and non-Developer user listing", async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/developer/users`);
    const designer = await login("designer@example.test");
    const forbidden = await fetch(`${baseUrl}/api/developer/users`, {
      headers: { Cookie: designer.cookie },
    });

    assert.equal(unauthenticated.status, 401);
    assert.equal(forbidden.status, 403);
  });

  it("lists filtered users without returning password hashes", async () => {
    const developer = await login();
    const response = await fetch(
      `${baseUrl}/api/developer/users?search=designer&role=Graphic%20Design&status=active`,
      { headers: { Cookie: developer.cookie } },
    );
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.users.length, 1);
    assert.equal(result.users[0].email, "designer@example.test");
    assert.equal(result.users[0].isActive, true);
    assert.equal("password_hash" in result.users[0], false);
  });

  it("requires CSRF and creates users with an Argon2id hash", async () => {
    const developer = await login();
    const withoutCsrf = await fetch(`${baseUrl}/api/developer/users`, {
      method: "POST",
      headers: { Cookie: developer.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "new@example.test",
        role: "Graphic Design",
        password: "temporary-secure-password",
      }),
    });
    const response = await sendCsrfMutation(
      "/api/developer/users",
      developer.cookie,
      "POST",
      {
        email: "New@Example.Test",
        role: "Graphic Design",
        password: "temporary-secure-password",
      },
    );
    const result = await response.json();
    const created = database.users.find((user) => user.email === "new@example.test");

    assert.equal(withoutCsrf.status, 403);
    assert.equal(response.status, 201);
    assert.equal(result.user.email, "new@example.test");
    assert.equal("password_hash" in result.user, false);
    assert.equal(await argon2.verify(created.password_hash, "temporary-secure-password"), true);
    assert.equal(created.password_change_required, 1);

    const createdAccount = await login("new@example.test", "temporary-secure-password");
    const createdBody = await createdAccount.response.json();
    const blockedWorkspace = await fetch(`${baseUrl}/api/developer/dashboard`, {
      headers: { Cookie: createdAccount.cookie },
    });
    assert.equal(createdBody.user.passwordChangeRequired, true);
    assert.equal(blockedWorkspace.status, 403);
    assert.equal((await blockedWorkspace.json()).code, "PASSWORD_CHANGE_REQUIRED");
  });

  it("rejects duplicate email addresses and roles outside the supported set", async () => {
    const developer = await login();
    const duplicate = await sendCsrfMutation(
      "/api/developer/users",
      developer.cookie,
      "POST",
      {
        email: "designer@example.test",
        role: "Graphic Design",
        password: "temporary-secure-password",
      },
    );
    const invalidRole = await sendCsrfMutation(
      "/api/developer/users",
      developer.cookie,
      "POST",
      {
        email: "new@example.test",
        role: "Finance",
        password: "temporary-secure-password",
      },
    );

    assert.equal(duplicate.status, 409);
    assert.equal(invalidRole.status, 400);
  });

  it("updates supported fields and immediately rejects deactivated sessions", async () => {
    const developer = await login();
    const designer = await login("designer@example.test");
    const response = await sendCsrfMutation(
      "/api/developer/users/2",
      developer.cookie,
      "PUT",
      {
        email: "designer-updated@example.test",
        role: "Graphic Design",
        isActive: false,
      },
    );
    const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: designer.cookie },
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.isActive, false);
    assert.equal(meResponse.status, 401);
  });

  it("prevents deactivating or demoting the last active Developer", async () => {
    const developer = await login();
    const response = await sendCsrfMutation(
      "/api/developer/users/1",
      developer.cookie,
      "PUT",
      {
        email: "developer@example.test",
        role: "Graphic Design",
        isActive: true,
      },
    );

    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /last active Developer/);
    assert.equal(database.users[0].role, "Developer");
  });

  it("prevents resetting the only active Developer account", async () => {
    const developer = await login();
    const response = await sendCsrfMutation(
      "/api/developer/users/1/password",
      developer.cookie,
      "POST",
      {
        newPassword: "another-developer-password-long",
        passwordConfirmation: "another-developer-password-long",
      },
    );

    assert.equal(response.status, 409);
    assert.equal(database.users[0].password_change_required, 0);
    assert.equal(await argon2.verify(database.users[0].password_hash, password), true);
  });

  it("resets another user's password, invalidates sessions, and preserves account state", async () => {
    const developer = await login();
    const designer = await login("designer@example.test");
    const newPassword = "new-temporary-password-that-is-long";
    const auditEntries = [];
    const originalInfo = console.info;
    let response;
    console.info = (...values) => auditEntries.push(values);
    try {
      response = await sendCsrfMutation(
        "/api/developer/users/2/password",
        developer.cookie,
        "POST",
        {
          newPassword,
          passwordConfirmation: newPassword,
        },
      );
    } finally {
      console.info = originalInfo;
    }
    const body = await response.json();
    const oldSessionResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: designer.cookie },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(body, { message: "Password reset successfully." });
    assert.equal(JSON.stringify(body).includes(newPassword), false);
    assert.equal(JSON.stringify(body).includes(password), false);
    assert.equal("password_hash" in body, false);
    assert.equal(database.users[1].role, "Graphic Design");
    assert.equal(database.users[1].is_active, 1);
    assert.equal(database.users[1].password_change_required, 1);
    assert.equal(await argon2.verify(database.users[1].password_hash, newPassword), true);
    assert.equal(await argon2.verify(database.users[1].password_hash, password), false);
    assert.equal(oldSessionResponse.status, 401);
    const resetLogin = await login("designer@example.test", newPassword);
    const resetLoginBody = await resetLogin.response.json();
    const deniedApi = await fetch(`${baseUrl}/api/graphic-design/tasks`, {
      headers: { Cookie: resetLogin.cookie },
    });
    assert.equal(resetLoginBody.user.passwordChangeRequired, true);
    assert.equal(deniedApi.status, 403);
    assert.equal((await deniedApi.json()).code, "PASSWORD_CHANGE_REQUIRED");
    assert.equal(auditEntries.length, 1);
    const auditText = JSON.stringify(auditEntries);
    assert.equal(auditText.includes(newPassword), false);
    assert.equal(auditText.includes(passwordHash), false);
    assert.equal(auditText.includes(designer.cookie), false);
    assert.match(auditText, /actorId/);
    assert.match(auditText, /targetId/);
    assert.match(auditText, /timestamp/);
    assert.match(auditText, /password_reset/);
    assert.match(auditText, /success/);
  });

  it("rejects reset without authentication, Developer role, or CSRF", async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/developer/users/2/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newPassword: "new-temporary-password-that-is-long",
        passwordConfirmation: "new-temporary-password-that-is-long",
      }),
    });
    const designer = await login("designer@example.test");
    const nonDeveloper = await sendCsrfMutation(
      "/api/developer/users/1/password",
      designer.cookie,
      "POST",
      {
        newPassword: "new-temporary-password-that-is-long",
        passwordConfirmation: "new-temporary-password-that-is-long",
      },
    );
    const developer = await login();
    assert.equal(developer.response.status, 200);
    const missingCsrf = await fetch(`${baseUrl}/api/developer/users/2/password`, {
      method: "POST",
      headers: { Cookie: developer.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        newPassword: "new-temporary-password-that-is-long",
        passwordConfirmation: "new-temporary-password-that-is-long",
      }),
    });

    assert.equal(unauthenticated.status, 401);
    assert.equal(nonDeveloper.status, 403);
    assert.equal(missingCsrf.status, 403);
  });

  it("rejects self-reset, weak passwords, and mismatches", async () => {
    const developer = await login();
    assert.equal(developer.response.status, 200);
    const selfReset = await sendCsrfMutation(
      "/api/developer/users/1/password",
      developer.cookie,
      "POST",
      {
        newPassword: "new-temporary-password-that-is-long",
        passwordConfirmation: "new-temporary-password-that-is-long",
      },
    );
    const weakPassword = await sendCsrfMutation(
      "/api/developer/users/2/password",
      developer.cookie,
      "POST",
      { newPassword: "too-short", passwordConfirmation: "too-short" },
    );
    const mismatch = await sendCsrfMutation(
      "/api/developer/users/2/password",
      developer.cookie,
      "POST",
      {
        newPassword: "new-temporary-password-that-is-long",
        passwordConfirmation: "a-different-password-that-is-long",
      },
    );

    assert.equal(selfReset.status, 409);
    assert.equal(database.users[0].role, "Developer");
    assert.equal(database.users[0].is_active, 1);
    assert.equal(weakPassword.status, 400);
    assert.equal(mismatch.status, 400);
  });

  it("preserves the inactive status when resetting an inactive account", async () => {
    const developer = await login();
    assert.equal(developer.response.status, 200);
    database.users[1].is_active = 0;
    const newPassword = "inactive-account-password-long";
    const response = await sendCsrfMutation(
      "/api/developer/users/2/password",
      developer.cookie,
      "POST",
      {
        newPassword,
        passwordConfirmation: newPassword,
      },
    );

    assert.equal(response.status, 200);
    assert.equal(database.users[1].is_active, 0);
    assert.equal(database.users[1].role, "Graphic Design");
    assert.equal(database.users[1].password_change_required, 1);
  });
});
