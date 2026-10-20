const { randomBytes } = require("node:crypto");
const argon2 = require("argon2");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { getAuthenticatedUser } = require("../middleware/auth");
const { requireCsrf } = require("../middleware/csrf");
const { validate } = require("../middleware/validate");

const loginSchema = z
  .object({
    email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128).optional(),
    newPassword: z.string().min(15).max(128),
    passwordConfirmation: z.string().min(15).max(128),
  })
  .strict()
  .refine((values) => values.newPassword === values.passwordConfirmation, {
    path: ["passwordConfirmation"],
    message: "The new passwords do not match.",
  });

function createAuthRouter({
  pool,
  sessionStore,
  loginLimit,
  passwordChangeLimit = 5,
}) {
  const router = express.Router();
  const loginRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: loginLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many login attempts. Try again later." },
  });
  const passwordChangeRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: passwordChangeLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many password change attempts. Try again later." },
  });

  router.get("/csrf", (request, response, next) => {
    if (!request.session.csrfToken) {
      request.session.csrfToken = randomBytes(32).toString("hex");
    }

    request.session.save((error) => {
      if (error) {
        return next(error);
      }

      return response.status(200).json({ csrfToken: request.session.csrfToken });
    });
  });

  router.post(
    "/login",
    loginRateLimiter,
    requireCsrf,
    validate(loginSchema),
    async (request, response) => {
      const [rows] = await pool.execute(
        `SELECT id, email, password_hash, role, is_active, password_change_required
         FROM management_users WHERE email = ? LIMIT 1`,
        [request.body.email],
      );
      const user = rows[0];
      const passwordMatches =
        user && (await argon2.verify(user.password_hash, request.body.password));

      if (!passwordMatches || !user.is_active) {
        return response.status(401).json({ error: "Invalid email or password." });
      }

      await regenerateSession(request);
      request.session.userId = user.id;
      request.session.csrfToken = randomBytes(32).toString("hex");
      await saveSession(request);

      return response.status(200).json({
        user: {
          id: String(user.id),
          email: user.email,
          role: user.role,
          passwordChangeRequired: isPasswordChangeRequired(user.password_change_required),
        },
      });
    },
  );

  router.get("/me", async (request, response) => {
    const user = await getAuthenticatedUser(pool, request, response);
    if (!user) {
      return;
    }

    return response.status(200).json({
      user: {
        id: String(user.id),
        email: user.email,
        role: user.role,
        passwordChangeRequired: isPasswordChangeRequired(user.password_change_required),
      },
    });
  });

  router.post(
    "/change-password",
    passwordChangeRateLimiter,
    requireCsrf,
    validate(changePasswordSchema),
    async (request, response, next) => {
      const user = await getAuthenticatedUser(pool, request, response);
      if (!user) {
        return;
      }

      const connection = await pool.getConnection();
      let transactionStarted = false;
      try {
        await connection.beginTransaction();
        transactionStarted = true;
        const [rows] = await connection.execute(
          `SELECT id, password_hash, password_change_required
           FROM management_users WHERE id = ? AND is_active = 1 FOR UPDATE`,
          [user.id],
        );
        const currentUser = rows[0];
        const passwordChangeRequired = isPasswordChangeRequired(
          currentUser?.password_change_required,
        );
        if (!currentUser) {
          throw new RouteError(401, "Authentication required.");
        }
        if (
          !passwordChangeRequired &&
          (!request.body.currentPassword ||
            !(await argon2.verify(currentUser.password_hash, request.body.currentPassword)))
        ) {
          throw new RouteError(400, "The current password is incorrect.");
        }
        if (await argon2.verify(currentUser.password_hash, request.body.newPassword)) {
          throw new RouteError(
            400,
            passwordChangeRequired
              ? "Choose a password different from your temporary password."
              : "Choose a password different from your current password.",
          );
        }

        const passwordHash = await argon2.hash(request.body.newPassword, {
          type: argon2.argon2id,
        });
        await sessionStore.deleteUserSessions(user.id, connection);
        await connection.execute(
          `UPDATE management_users
           SET password_hash = ?, password_change_required = 0
           WHERE id = ?`,
          [passwordHash, user.id],
        );
        await connection.commit();
        transactionStarted = false;

        await regenerateSession(request);
        request.session.userId = user.id;
        request.session.csrfToken = randomBytes(32).toString("hex");
        await saveSession(request);

        return response.status(200).json({
          message: "Password changed. Other active sessions have been signed out.",
        });
      } catch (error) {
        if (transactionStarted) {
          await connection.rollback();
        }
        if (error instanceof RouteError) {
          return response.status(error.status).json({ error: error.message });
        }
        return next(error);
      } finally {
        connection.release();
      }
    },
  );

  router.post("/logout", requireCsrf, async (request, response, next) => {
    const secureCookie = request.session.cookie.secure;
    request.session.destroy((error) => {
      if (error) {
        return next(error);
      }

      response.clearCookie("fetman.sid", {
        httpOnly: true,
        secure: secureCookie,
        sameSite: "lax",
        path: "/",
      });
      return response.status(204).end();
    });
  });

  return router;
}

class RouteError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function regenerateSession(request) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function saveSession(request) {
  return new Promise((resolve, reject) => {
    request.session.save((error) => (error ? reject(error) : resolve()));
  });
}

module.exports = { createAuthRouter };

function isPasswordChangeRequired(value) {
  return value === true || value === 1 || value === "1";
}
