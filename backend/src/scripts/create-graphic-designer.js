const { timingSafeEqual } = require("node:crypto");
const argon2 = require("argon2");
const { createInterface } = require("node:readline/promises");
const { loadConfig } = require("../config/env");
const { createPool } = require("../db/pool");

const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};

function readHidden(promptText) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(
      new Error("Run this setup command in an interactive Windows PowerShell terminal."),
    );
  }

  async function readEmail() {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await prompt.question("Authorised staff email address: ");
    } finally {
      prompt.close();
    }
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
      if (error) reject(error);
      else resolve(value);
    }
    function onData(chunk) {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          finish(new Error("Account setup was cancelled."));
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
        if (character >= " ") value += character;
      }
    }
    input.on("data", onData);
  });
}

function validateCredentials(email, password) {
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("Enter a valid email address (maximum 254 characters).");
  }
  if (password.length < 15 || password.length > 128) {
    throw new Error("Choose a password between 15 and 128 characters.");
  }
}

async function readEmail() {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return await prompt.question("Authorised staff email address: ");
  } finally {
    prompt.close();
  }
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config);
  try {
    const email = (await readEmail()).trim().toLowerCase();
    const password = await readHidden("Password (input hidden): ");
    const confirmation = await readHidden("Confirm password (input hidden): ");
    validateCredentials(email, password);
    const passwordBytes = Buffer.from(password);
    const confirmationBytes = Buffer.from(confirmation);
    if (
      passwordBytes.length !== confirmationBytes.length ||
      !timingSafeEqual(passwordBytes, confirmationBytes)
    ) {
      throw new Error("The passwords do not match.");
    }

    const passwordHash = await argon2.hash(password, passwordOptions);
    await pool.execute(
      `INSERT INTO management_users
         (email, password_hash, role, is_active, password_change_required)
       VALUES (?, ?, 'Graphic Design', 1, 1)`,
      [email, passwordHash],
    );
    console.log("Graphic Design account created. The account is active.");
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "";

    const permittedMessage =
      /^(Invalid environment configuration for: [A-Z0-9_,. ]+\. Review backend\/\.env\.example\.|Account setup was cancelled\.|Enter a valid email address \(maximum 254 characters\)\.|Choose a password between 15 and 128 characters\.|The passwords do not match\.)$/.test(
        message,
      );

    if (permittedMessage) {
      console.error(message);
    } else {
      console.error("Graphic Design account setup failed.");
      console.error("Error type:", error?.name || "UnknownError");
      console.error("Error message:", error?.message || "No message provided");
      console.error("Database error code:", error?.code || "Not provided");
      console.error("Database error number:", error?.errno || "Not provided");
      console.error("SQL state:", error?.sqlState || "Not provided");
    }

    process.exitCode = 1;
  });
}