const path = require("node:path");
const net = require("node:net");
const dotenv = require("dotenv");
const { z } = require("zod");

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  DB_HOST: z.string().trim().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_NAME: z.string().trim().min(1),
  DB_USER: z.string().trim().min(1),
  DB_PASSWORD: z.string(),
  DB_TLS_MODE: z.enum(["required", "loopback-plaintext"]).default("required"),
  DB_TLS_CA_PATH: z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().min(1).refine((value) => path.isAbsolute(value)).optional()),
  SESSION_SECRET: z.string().min(32),
  MEDIA_DIRECTORY: z.string().trim().default("./backend/secure-uploads/media"),
  CONTACT_RECIPIENT_EMAIL: z.string().trim().email().default("info@fetmandigital.com"),
  SMTP_HOST: z.string().trim().default(""),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.preprocess((value) => value === true || value === "true" || value === "1", z.boolean()).default(false),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  SMTP_FROM: z.string().trim().email().optional(),
});

function parseConfig(environment) {
  const result = configSchema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || "environment"))];
    throw new Error(`Invalid environment configuration for: ${fields.join(", ")}. Review backend/.env.example.`);
  }
  const value = result.data;
  if (value.DB_TLS_MODE === "loopback-plaintext" && !isLoopbackHost(value.DB_HOST)) {
    throw new Error("Invalid environment configuration for: DB_TLS_MODE, DB_HOST.");
  }
  if (value.SMTP_HOST && (!value.SMTP_USER || !value.SMTP_PASSWORD)) {
    throw new Error("Invalid environment configuration for: SMTP_USER, SMTP_PASSWORD.");
  }
  const mediaDirectory = path.resolve(process.cwd(), value.MEDIA_DIRECTORY);
  if (value.NODE_ENV === "production" && (!path.isAbsolute(value.MEDIA_DIRECTORY) || isWithinDirectory(process.cwd(), mediaDirectory))) {
    throw new Error("Invalid environment configuration for: MEDIA_DIRECTORY. Production media must be outside the release directory.");
  }
  return {
    environment: value.NODE_ENV, port: value.PORT, host: value.HOST,
    database: { host: value.DB_HOST, port: value.DB_PORT, name: value.DB_NAME, user: value.DB_USER,
      password: value.DB_PASSWORD, tlsMode: value.DB_TLS_MODE, tlsCaPath: value.DB_TLS_CA_PATH },
    sessionSecret: value.SESSION_SECRET,
    mediaDirectory,
    contactRecipient: value.CONTACT_RECIPIENT_EMAIL,
    smtp: { host: value.SMTP_HOST, port: value.SMTP_PORT, secure: value.SMTP_SECURE,
      user: value.SMTP_USER, password: value.SMTP_PASSWORD,
      from: value.SMTP_FROM || value.SMTP_USER || value.CONTACT_RECIPIENT_EMAIL },
  };
}

function isLoopbackHost(host) {
  const normalized = host.trim().toLowerCase();
  return normalized === "localhost" || normalized === "::1" || (net.isIP(normalized) === 4 && normalized.startsWith("127."));
}

function isWithinDirectory(directory, target) {
  const relativePath = path.relative(path.resolve(directory), path.resolve(target));
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath));
}

function loadConfig() {
  dotenv.config({ path: path.resolve(__dirname, "../../.env") });
  return parseConfig(process.env);
}

module.exports = { isLoopbackHost, loadConfig, parseConfig };
