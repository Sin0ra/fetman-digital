const { timingSafeEqual } = require("node:crypto");
const argon2 = require("argon2");
const { loadConfig } = require("../config/env");
const { createPool } = require("../db/pool");

const INITIAL_DEVELOPER_EMAIL = "sinoworkguma@gmail.com";
const BOOTSTRAP_LOCK_NAME = "fetman_management_initial_developer";
const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};

async function bootstrapDeveloper(pool, password) {
  const connection = await pool.getConnection();
  let lockAcquired = false;

  try {
    const [lockRows] = await connection.query("SELECT GET_LOCK(?, 10) AS acquired", [
      BOOTSTRAP_LOCK_NAME,
    ]);
    if (lockRows[0]?.acquired !== 1) {
      throw new Error("Could not acquire the initial account setup lock.");
    }
    lockAcquired = true;

    const [existingRows] = await connection.execute(
      "SELECT id FROM management_users WHERE role = ? OR email = ? LIMIT 1",
      ["Developer", INITIAL_DEVELOPER_EMAIL],
    );
    if (existingRows.length > 0) {
      throw new Error("A Developer or matching account already exists; setup was not changed.");
    }

    const passwordHash = await argon2.hash(password, passwordOptions);
    const [result] = await connection.execute(
      `INSERT INTO management_users
         (email, password_hash, role, is_active, password_change_required)
       VALUES (?, ?, ?, 1, 1)`,
      [INITIAL_DEVELOPER_EMAIL, passwordHash, "Developer"],
    );
    return result.insertId;
  } finally {
    try {
      if (lockAcquired) {
        await connection.query("SELECT RELEASE_LOCK(?)", [BOOTSTRAP_LOCK_NAME]);
      }
    } finally {
      connection.release();
    }
  }
}

function readHidden(promptText) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(
      new Error("Run this setup command in an interactive Windows PowerShell terminal."),
    );
  }

  process.stdout.write(promptText);
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve, reject) => {
    let value = "";

    function finish(error) {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    }

    function onData(chunk) {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          finish(new Error("Password entry was cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " ") {
          value += character;
        }
      }
    }

    input.on("data", onData);
  });
}

function validatePassword(password) {
  if (password.length < 15 || password.length > 128) {
    throw new Error("Choose a password between 15 and 128 characters.");
  }
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config);

  try {
    const [rows] = await pool.execute(
      "SELECT id FROM management_users WHERE role = ? OR email = ? LIMIT 1",
      ["Developer", INITIAL_DEVELOPER_EMAIL],
    );
    if (rows.length > 0) {
      throw new Error("A Developer or matching account already exists; setup was not changed.");
    }

    console.log(`Initial Developer account: ${INITIAL_DEVELOPER_EMAIL}`);
    const password = await readHidden("Password (input hidden): ");
    const confirmation = await readHidden("Confirm password (input hidden): ");
    validatePassword(password);
    const passwordBytes = Buffer.from(password);
    const confirmationBytes = Buffer.from(confirmation);
    if (
      passwordBytes.length !== confirmationBytes.length ||
      !timingSafeEqual(passwordBytes, confirmationBytes)
    ) {
      throw new Error("The passwords do not match.");
    }

    await bootstrapDeveloper(pool, password);
    console.log("Initial Developer account created successfully.");
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "";
    const permittedMessage =
      /^(Invalid environment configuration for: [A-Z0-9_,. ]+\. Review backend\/\.env\.example\.|Run this setup command in an interactive Windows PowerShell terminal\.|Password entry was cancelled\.|Choose a password between 15 and 128 characters\.|The passwords do not match\.|Could not acquire the initial account setup lock\.|A Developer or matching account already exists; setup was not changed\.)$/.test(
        message,
      );
    console.error(
      permittedMessage
        ? message
        : "Developer setup failed. Check backend configuration, MySQL connectivity, and the approved authentication schema.",
    );
    process.exitCode = 1;
  });
}

module.exports = {
  INITIAL_DEVELOPER_EMAIL,
  bootstrapDeveloper,
  readHidden,
  validatePassword,
};
