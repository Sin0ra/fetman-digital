const argon2 = require("argon2");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { getAuthenticatedUser } = require("../middleware/auth");
const { requireCsrf } = require("../middleware/csrf");
const { validate } = require("../middleware/validate");

const roles = ["Developer", "Graphic Design"];
const roleSchema = z.enum(roles);
const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((email) => email.toLowerCase());
const createUserSchema = z
  .object({
    email: emailSchema,
    role: roleSchema,
    isActive: z.boolean().default(true),
    password: z.string().min(15).max(128),
  })
  .strict();
const updateUserSchema = z
  .object({
    email: emailSchema,
    role: roleSchema,
    isActive: z.boolean(),
  })
  .strict();
const resetPasswordSchema = z
  .object({
    newPassword: z.string().min(15).max(128),
    passwordConfirmation: z.string().min(15).max(128),
  })
  .strict()
  .refine((values) => values.newPassword === values.passwordConfirmation, {
    path: ["passwordConfirmation"],
    message: "The new passwords do not match.",
  });
const listUsersSchema = z.object({
  search: z.string().trim().max(254).optional(),
  role: z.union([roleSchema, z.literal("all")]).optional(),
  status: z.enum(["active", "inactive", "all"]).optional(),
});
const userIdSchema = z.object({
  userId: z.string().regex(/^[1-9]\d{0,19}$/),
});

function createDeveloperUsersRouter({ pool, sessionStore, passwordResetLimit = 5 }) {
  const router = express.Router();
  const resetPasswordRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: passwordResetLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many password reset attempts. Try again later." },
  });

  router.use(async (request, response, next) => {
    const user = await getAuthenticatedUser(pool, request, response);
    if (!user) {
      return;
    }
    if (user.role !== "Developer") {
      return response.status(403).json({ error: "Forbidden" });
    }

    request.managementUser = user;
    return next();
  });

  router.get("/", validate(listUsersSchema, "query"), async (request, response) => {
    const conditions = [];
    const parameters = [];

    if (request.query.search) {
      conditions.push("email LIKE ?");
      parameters.push(`%${request.query.search}%`);
    }
    if (request.query.role && request.query.role !== "all") {
      conditions.push("role = ?");
      parameters.push(request.query.role);
    }
    if (request.query.status && request.query.status !== "all") {
      conditions.push("is_active = ?");
      parameters.push(request.query.status === "active" ? 1 : 0);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await pool.execute(
      `SELECT id, email, role, is_active, created_at, updated_at
       FROM management_users ${whereClause}
       ORDER BY email, id`,
      parameters,
    );

    return response.status(200).json({ users: rows.map(serializeUser) });
  });

  router.post("/", requireCsrf, validate(createUserSchema), async (request, response) => {
    const passwordHash = await argon2.hash(request.body.password, {
      type: argon2.argon2id,
    });
    let result;

    try {
      [result] = await pool.execute(
        `INSERT INTO management_users
           (email, password_hash, role, is_active, password_change_required)
         VALUES (?, ?, ?, ?, 1)`,
        [
          request.body.email,
          passwordHash,
          request.body.role,
          request.body.isActive ? 1 : 0,
        ],
      );
    } catch (error) {
      if (isDuplicateEmailError(error)) {
        return response.status(409).json({ error: "An account with that email already exists." });
      }
      throw error;
    }

    const [rows] = await pool.execute(
      `SELECT id, email, role, is_active, created_at, updated_at
       FROM management_users WHERE id = ? LIMIT 1`,
      [result.insertId],
    );
    recordAction(request.managementUser.id, result.insertId, "created");
    return response.status(201).json({ user: serializeUser(rows[0]) });
  });

  router.put(
    "/:userId",
    requireCsrf,
    validate(userIdSchema, "params"),
    validate(updateUserSchema),
    async (request, response) => {
      const connection = await pool.getConnection();
      let transactionStarted = false;

      try {
        await connection.beginTransaction();
        transactionStarted = true;

        const [activeDevelopers] = await connection.execute(
          "SELECT id FROM management_users WHERE role = 'Developer' AND is_active = 1 FOR UPDATE",
        );
        const [users] = await connection.execute(
          `SELECT id, email, role, is_active
           FROM management_users WHERE id = ? FOR UPDATE`,
          [request.params.userId],
        );
        const currentUser = users[0];

        if (!currentUser) {
          throw new RouteError(404, "User not found.");
        }

        const remainsActiveDeveloper =
          request.body.role === "Developer" && request.body.isActive;
        const isRemovingActiveDeveloper =
          currentUser.role === "Developer" &&
          Boolean(currentUser.is_active) &&
          !remainsActiveDeveloper;

        if (isRemovingActiveDeveloper && activeDevelopers.length <= 1) {
          throw new RouteError(409, "The last active Developer account cannot be deactivated or demoted.");
        }
        if (
          String(currentUser.id) === String(request.managementUser.id) &&
          !remainsActiveDeveloper
        ) {
          throw new RouteError(409, "You cannot deactivate or demote your own account.");
        }

        await connection.execute(
          `UPDATE management_users
           SET email = ?, role = ?, is_active = ?
           WHERE id = ?`,
          [
            request.body.email,
            request.body.role,
            request.body.isActive ? 1 : 0,
            request.params.userId,
          ],
        );
        const [updatedUsers] = await connection.execute(
          `SELECT id, email, role, is_active, created_at, updated_at
           FROM management_users WHERE id = ? LIMIT 1`,
          [request.params.userId],
        );
        await connection.commit();
        transactionStarted = false;

        recordAction(
          request.managementUser.id,
          request.params.userId,
          "updated",
        );
        return response.status(200).json({ user: serializeUser(updatedUsers[0]) });
      } catch (error) {
        if (transactionStarted) {
          await connection.rollback();
          transactionStarted = false;
        }
        if (error instanceof RouteError) {
          return response.status(error.status).json({ error: error.message });
        }
        if (isDuplicateEmailError(error)) {
          return response.status(409).json({ error: "An account with that email already exists." });
        }
        throw error;
      } finally {
        connection.release();
      }
    },
  );

  router.post(
    "/:userId/password",
    resetPasswordRateLimiter,
    requireCsrf,
    validate(userIdSchema, "params"),
    validate(resetPasswordSchema),
    async (request, response) => {
      const actorId = request.managementUser.id;
      const targetId = request.params.userId;
      let transactionStarted = false;
      let connection;

      try {
        if (String(actorId) === String(targetId)) {
          throw new RouteError(409, "You cannot reset your own password here.");
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();
        transactionStarted = true;

        const [activeDevelopers] = await connection.execute(
          "SELECT id FROM management_users WHERE role = 'Developer' AND is_active = 1 FOR UPDATE",
        );
        const [users] = await connection.execute(
          `SELECT id, role, is_active
           FROM management_users WHERE id = ? FOR UPDATE`,
          [targetId],
        );
        const target = users[0];
        if (!target) {
          throw new RouteError(404, "User not found.");
        }
        if (
          target.role === "Developer" &&
          isActiveUser(target.is_active) &&
          activeDevelopers.length <= 1
        ) {
          throw new RouteError(409, "The last active Developer account cannot be reset.");
        }

        const passwordHash = await argon2.hash(request.body.newPassword, {
          type: argon2.argon2id,
        });
        await sessionStore.deleteUserSessions(target.id, connection);
        await connection.execute(
          `UPDATE management_users
           SET password_hash = ?, password_change_required = 1
           WHERE id = ?`,
          [passwordHash, target.id],
        );
        await connection.commit();
        transactionStarted = false;

        recordSecurityAudit(actorId, target.id, "password_reset", "success");
        return response.status(200).json({ message: "Password reset successfully." });
      } catch (error) {
        if (transactionStarted) {
          await connection.rollback();
          transactionStarted = false;
        }
        if (error instanceof RouteError) {
          recordSecurityAudit(actorId, targetId, "password_reset", `rejected_${error.status}`);
          return response.status(error.status).json({ error: error.message });
        }
        recordSecurityAudit(actorId, targetId, "password_reset", "failed");
        throw error;
      } finally {
        connection?.release();
      }
    },
  );

  return router;
}

function serializeUser(user) {
  return {
    id: String(user.id),
    email: user.email,
    role: user.role,
    isActive:
      user.is_active === true ||
      user.is_active === 1 ||
      user.is_active === "1",
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

function isDuplicateEmailError(error) {
  return error && (error.code === "ER_DUP_ENTRY" || error.errno === 1062);
}

function isActiveUser(value) {
  return value === true || value === 1 || value === "1";
}

function recordAction(actorId, targetId, action) {
  console.info("Developer user-management action", {
    actorId: String(actorId),
    targetId: String(targetId),
    action,
  });
}

function recordSecurityAudit(actorId, targetId, action, result) {
  console.info("Security audit event", {
    actorId: String(actorId),
    targetId: String(targetId),
    timestamp: new Date().toISOString(),
    action,
    result,
  });
}

class RouteError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { createDeveloperUsersRouter };
