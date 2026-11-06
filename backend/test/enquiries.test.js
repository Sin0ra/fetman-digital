const assert = require("node:assert/strict");
const net = require("node:net");
const session = require("express-session");
const { after, before, describe, it } = require("node:test");
const { createApp } = require("../src/app");

const privateEnquiry = {
  fullName: "Private Test Name",
  email: "private-person@example.test",
  service: "Private Test Service",
  message: "This enquiry body must never be logged.",
  website: "",
};
const state = { failInsert: false, inserted: null };
const pool = {
  async execute(statement, values = []) {
    if (statement.includes("maintenance_mode")) return [[{ setting_value: "0" }], []];
    if (statement.startsWith("INSERT INTO enquiries")) {
      if (state.failInsert) {
        const error = new Error("Database details must not reach logs.");
        error.code = "ER_NO_SUCH_TABLE";
        throw error;
      }
      state.inserted = values;
      return [{ insertId: 1 }, []];
    }
    throw new Error("Unexpected SQL in enquiry test.");
  },
};

let server;
let baseUrl;
let refusedPort;

before(async () => {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  refusedPort = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));

  const app = createApp({
    environment: "test",
    sessionSecret: "test-only-session-secret-with-more-than-32-characters",
    contactRecipient: "recipient@example.test",
    smtp: { host: "127.0.0.1", port: refusedPort, secure: false, user: "test-user", password: "test-password", from: "sender@example.test" },
  }, { pool, sessionStore: new session.MemoryStore() });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function submitEnquiry() {
  return fetch(`${baseUrl}/api/public/enquiries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(privateEnquiry),
  });
}

describe("public enquiry failure diagnostics", () => {
  it("reports database insertion failures without leaking database or enquiry details", async () => {
    state.failInsert = true;
    const records = [];
    const originalConsoleError = console.error;
    console.error = (...args) => records.push(args);
    try {
      const response = await submitEnquiry();
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: "Internal server error" });
    } finally {
      console.error = originalConsoleError;
      state.failInsert = false;
    }

    assert.equal(records.length, 1);
    assert.deepEqual(records[0][1], {
      method: "POST",
      path: "/api/public/enquiries",
      errorCode: "ER_NO_SUCH_TABLE",
      failureStage: "database_insert",
      failureCategory: "database",
    });
    assert.doesNotMatch(JSON.stringify(records), /Database details|Private Test Name|private-person|Private Test Service|enquiry body/);
  });

  it("keeps the saved enquiry when SMTP connection fails and logs only safe diagnostics", async () => {
    state.inserted = null;
    const records = [];
    const originalConsoleError = console.error;
    console.error = (...args) => records.push(args);
    try {
      const response = await submitEnquiry();
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: "Internal server error" });
    } finally {
      console.error = originalConsoleError;
    }

    assert.deepEqual(state.inserted, [
      privateEnquiry.fullName,
      privateEnquiry.email,
      privateEnquiry.service,
      privateEnquiry.message,
    ]);
    assert.equal(records.length, 1);
    assert.equal(records[0][1].failureStage, "connection");
    assert.equal(records[0][1].failureCategory, "connection");
    assert.equal(records[0][1].errorCode, "ECONNREFUSED");
    assert.doesNotMatch(JSON.stringify(records), /test-password|test-user|Private Test Name|private-person|Private Test Service|enquiry body/);
  });
});
