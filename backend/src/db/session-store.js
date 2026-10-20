const session = require("express-session");

const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

class MySQLSessionStore extends session.Store {
  constructor(pool) {
    super();
    this.pool = pool;
    this.cleanupTimer = setInterval(
      () => this.clearExpired((error) => {
        if (error) {
          console.error("Expired session cleanup failed.");
        }
      }),
      CLEANUP_INTERVAL_MS,
    );
    this.cleanupTimer.unref();
  }

  get(sessionId, callback) {
    this.pool
      .execute(
        "SELECT data FROM management_sessions WHERE session_id = ? AND expires > ? LIMIT 1",
        [sessionId, Math.floor(Date.now() / 1000)],
      )
      .then(([rows]) => {
        if (!rows[0]) {
          callback(null, null);
          return;
        }

        const value = JSON.parse(rows[0].data);
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          callback(new Error("Stored session data is invalid."));
          return;
        }
        callback(null, value);
      })
      .catch(callback);
  }

  set(sessionId, value, callback) {
    let serialized;
    let expires;
    try {
      serialized = JSON.stringify(value);
      expires = getExpiration(value);
    } catch (error) {
      complete(callback, error);
      return;
    }

    this.pool
      .execute(
        "INSERT INTO management_sessions (session_id, expires, data) VALUES (?, ?, ?) " +
          "ON DUPLICATE KEY UPDATE expires = VALUES(expires), data = VALUES(data)",
        [sessionId, expires, serialized],
      )
      .then(() => complete(callback))
      .catch((error) => complete(callback, error));
  }

  touch(sessionId, value, callback) {
    let expires;
    try {
      expires = getExpiration(value);
    } catch (error) {
      complete(callback, error);
      return;
    }

    this.pool
      .execute(
        "UPDATE management_sessions SET expires = ? WHERE session_id = ?",
        [expires, sessionId],
      )
      .then(() => complete(callback))
      .catch((error) => complete(callback, error));
  }

  destroy(sessionId, callback) {
    this.pool
      .execute("DELETE FROM management_sessions WHERE session_id = ?", [sessionId])
      .then(() => complete(callback))
      .catch((error) => complete(callback, error));
  }

  deleteUserSessions(userId, executor = this.pool) {
    return executor.execute(
      `DELETE FROM management_sessions
       WHERE JSON_VALID(data)
         AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.userId')) = ?`,
      [String(userId)],
    );
  }

  clearExpired(callback) {
    this.pool
      .execute("DELETE FROM management_sessions WHERE expires <= ?", [
        Math.floor(Date.now() / 1000),
      ])
      .then(() => complete(callback))
      .catch((error) => complete(callback, error));
  }

  close() {
    clearInterval(this.cleanupTimer);
  }
}

function getExpiration(value) {
  const expiresAt = value.cookie?.expires
    ? new Date(value.cookie.expires).getTime()
    : Date.now() + SESSION_LIFETIME_MS;

  if (!Number.isFinite(expiresAt)) {
    throw new Error("Session expiration is invalid.");
  }

  return Math.floor(expiresAt / 1000);
}

function complete(callback, error) {
  if (typeof callback === "function") {
    callback(error);
  } else if (error) {
    process.nextTick(() => {
      throw error;
    });
  }
}

module.exports = { MySQLSessionStore };
