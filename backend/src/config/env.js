const path = require("node:path");
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
  CORS_ORIGINS: corsOriginsSchema,
  DB_HOST: z.string().trim().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_NAME: z.string().trim().min(1),
  DB_USER: z.string().trim().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_TLS_CA_PATH: z
    .string()
    .trim()
    .min(1)
    .refine((value) => path.isAbsolute(value)),
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

  return {
    environment: result.data.NODE_ENV,
    port: result.data.PORT,
    corsOrigins: result.data.CORS_ORIGINS,
    database: {
      host: result.data.DB_HOST,
      port: result.data.DB_PORT,
      name: result.data.DB_NAME,
      user: result.data.DB_USER,
      password: result.data.DB_PASSWORD,
      tlsCaPath: result.data.DB_TLS_CA_PATH,
    },
    sessionSecret: result.data.SESSION_SECRET,
  };
}

function loadConfig() {
  dotenv.config({ path: path.resolve(__dirname, "../../.env") });
  return parseConfig(process.env);
}

module.exports = { loadConfig, parseConfig };
