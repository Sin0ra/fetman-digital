const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { MySQLSessionStore } = require("../src/db/session-store");

function invoke(store, method, ...arguments_) {
  return new Promise((resolve, reject) => {
    store[method](...arguments_, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

describe("MySQL-backed session store", () => {
  it("writes serialized sessions with a bounded expiry", async () => {
    let query;
    let values;
    const store = new MySQLSessionStore({
      async execute(statement, parameters) {
        query = statement;
        values = parameters;
        return [{ affectedRows: 1 }, []];
      },
    });

    try {
      const session = {
        userId: 42,
        cookie: { expires: new Date(Date.now() + 60_000) },
      };
      await invoke(store, "set", "session-id", session);

      assert.match(query, /INSERT INTO management_sessions/);
      assert.match(query, /ON DUPLICATE KEY UPDATE/);
      assert.equal(values[0], "session-id");
      assert.ok(values[1] > Math.floor(Date.now() / 1000));
      assert.deepEqual(JSON.parse(values[2]), JSON.parse(JSON.stringify(session)));
    } finally {
      store.close();
    }
  });

  it("loads stored session data and returns null when no valid row exists", async () => {
    let row = { data: JSON.stringify({ userId: 42 }) };
    const store = new MySQLSessionStore({
      async execute(_statement, _parameters) {
        return [row ? [row] : [], []];
      },
    });

    try {
      assert.deepEqual(await invoke(store, "get", "session-id"), { userId: 42 });
      row = null;
      assert.equal(await invoke(store, "get", "expired-session"), null);
    } finally {
      store.close();
    }
  });

  it("surfaces invalid stored JSON and database failures", async () => {
    const store = new MySQLSessionStore({
      async execute() {
        return [[{ data: "not-json" }], []];
      },
    });

    try {
      await assert.rejects(invoke(store, "get", "session-id"), SyntaxError);
    } finally {
      store.close();
    }

    const failedStore = new MySQLSessionStore({
      async execute() {
        throw new Error("database unavailable");
      },
    });

    try {
      await assert.rejects(invoke(failedStore, "destroy", "session-id"), /database unavailable/);
    } finally {
      failedStore.close();
    }
  });

  it("updates expiry, deletes sessions, and clears expired records", async () => {
    const queries = [];
    const store = new MySQLSessionStore({
      async execute(statement, parameters) {
        queries.push({ statement, parameters });
        return [{ affectedRows: 1 }, []];
      },
    });

    try {
      const session = { cookie: { expires: new Date(Date.now() + 60_000) } };
      await invoke(store, "touch", "session-id", session);
      await invoke(store, "destroy", "session-id");
      await invoke(store, "clearExpired");

      assert.match(queries[0].statement, /UPDATE management_sessions SET expires/);
      assert.match(queries[1].statement, /DELETE FROM management_sessions WHERE session_id/);
      assert.match(queries[2].statement, /DELETE FROM management_sessions WHERE expires/);
    } finally {
      store.close();
    }
  });

  it("deletes only the sessions associated with the specified user", async () => {
    let query;
    let parameters;
    const store = new MySQLSessionStore({
      async execute(statement, values) {
        query = statement;
        parameters = values;
        return [{ affectedRows: 2 }, []];
      },
    });

    try {
      await store.deleteUserSessions(42);

      assert.match(query, /JSON_VALID\(data\)/);
      assert.match(query, /JSON_EXTRACT\(data, '\$\.userId'\)/);
      assert.deepEqual(parameters, ["42"]);
    } finally {
      store.close();
    }
  });
});
