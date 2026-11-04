const assert = require("node:assert/strict");
const session = require("express-session");
const { after, before, describe, it } = require("node:test");
const { createApp } = require("../src/app");

let server;
let url;
before(async () => {
  const pool = { async query() { return [[{ result: 1 }], []]; }, async execute() { return [[{ setting_value: "0" }], []]; } };
  server = createApp({ environment: "test", sessionSecret: "test-only-session-secret-with-more-than-32-characters" }, { pool, sessionStore: new session.MemoryStore() }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

describe("deferred employee management", () => {
  it("does not expose the retired user-management API", async () => {
    const response = await fetch(`${url}/api/developer/users`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Authentication required." });
  });
});
