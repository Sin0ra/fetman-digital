const path = require("node:path");
const net = require("node:net");
const dotenv = require("dotenv");
const { z } = require("zod");

const corsOriginsSchema = z
  .string()
  .transform((value) => value.split(",").map((origin) => origin.trim()))
  .pipe(
    z
      .array(
        z.string().url().refine((origin) => {
          if (!URL.canParse(origin)) {
            return false;
          }

          const parsed = new URL(origin);
          return (
            (parsed.protocol === "http:" || parsed.protocol === "https:") &&
            parsed.origin === origin
          );
        }),
      )
      .min(1),
  );

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  CORS_ORIGINS: corsOriginsSchema,
  DB_HOST: z.string().trim().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_TLS_MODE: z.enum(["required", "loopback-plaintext"]).default("required"),
  DB_NAME: z.string().trim().min(1),
  DB_USER: z.string().trim().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_TLS_CA_PATH: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z
      .string()
      .trim()
      .min(1)
      .refine((value) => path.isAbsolute(value))
      .optional(),
  ),
  SESSION_SECRET: z.string().min(32),
});

function parseConfig(environment) {
  const result = configSchema.safeParse(environment);

  if (!result.success) {
    const invalidFields = [
      ...new Set(
        result.error.issues.map((issue) =>
          issue.path.length > 0 ? issue.path.join(".") : "environment",
        ),
      ),
    ];

    throw new Error(
      `Invalid environment configuration for: ${invalidFields.join(", ")}. ` +
        "Review backend/.env.example.",
    );
  }

  const isLoopbackPlaintext = result.data.DB_TLS_MODE === "loopback-plaintext";
  if (isLoopbackPlaintext && !isLoopbackHost(result.data.DB_HOST)) {
    throw new Error("Invalid environment configuration for: DB_TLS_MODE, DB_HOST.");
  }
  if (!isLoopbackPlaintext && !result.data.DB_TLS_CA_PATH) {
    throw new Error("Invalid environment configuration for: DB_TLS_CA_PATH.");
  }

  return {
    environment: result.data.NODE_ENV,
    port: result.data.PORT,
    host: result.data.HOST,
    corsOrigins: result.data.CORS_ORIGINS,
    database: {
      host: result.data.DB_HOST,
      port: result.data.DB_PORT,
      name: result.data.DB_NAME,
      user: result.data.DB_USER,
      password: result.data.DB_PASSWORD,
      tlsCaPath: result.data.DB_TLS_CA_PATH,
      tlsMode: result.data.DB_TLS_MODE,
    },
    sessionSecret: result.data.SESSION_SECRET,
  };
}

function isLoopbackHost(host) {
  const normalizedHost = host.trim().toLowerCase();
  return normalizedHost === "::1" ||
    (net.isIP(normalizedHost) === 4 && normalizedHost.startsWith("127."));
}

function loadConfig() {
  dotenv.config({ path: path.resolve(__dirname, "../../.env") });
  return parseConfig(process.env);
}

module.exports = { isLoopbackHost, loadConfig, parseConfig };
