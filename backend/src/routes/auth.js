const { randomBytes, timingSafeEqual } = require("node:crypto");
const argon2 = require("argon2");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { requireCsrf } = require("../middleware/csrf");

const OWNER_EMAIL = "sinoworkguma@gmail.com";
const loginSchema = z.object({ email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()), password: z.string().min(1) }).strict();
const passwordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8), passwordConfirmation: z.string().min(8) }).strict().refine((value) => value.newPassword === value.passwordConfirmation, { path: ["passwordConfirmation"], message: "Passwords do not match." });

function createAuthRouter({ pool, sessionStore, loginLimit = 8 }) {
  const router = express.Router();
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: loginLimit, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many login attempts. Try again later." } });

  router.get("/setup-status", async (_request, response, next) => {
    try {
      const [rows] = await pool.execute("SELECT id FROM developer_account WHERE email = ? LIMIT 1", [OWNER_EMAIL]);
      return response.json({ setupRequired: rows.length === 0, email: OWNER_EMAIL });
    } catch (error) { return next(error); }
  });

  router.get("/csrf", (request, response, next) => {
    if (!request.session.csrfToken) request.session.csrfToken = randomBytes(32).toString("hex");
    request.session.save((error) => error ? next(error) : response.json({ csrfToken: request.session.csrfToken }));
  });

  router.post("/login", loginLimiter, requireCsrf, async (request, response, next) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid login details." });
    try {
      const [rows] = await pool.execute("SELECT id, email, password_hash FROM developer_account WHERE email = ? LIMIT 1", [parsed.data.email]);
      const account = rows[0];
      const matches = account ? await argon2.verify(account.password_hash, parsed.data.password) : false;
      if (!account || account.email !== OWNER_EMAIL || !matches) return response.status(401).json({ error: "Invalid email or password." });
      await regenerateSession(request);
      request.session.userId = String(account.id);
      request.session.csrfToken = randomBytes(32).toString("hex");
      await saveSession(request);
      return response.json({ user: { id: String(account.id), email: account.email } });
    } catch (error) { return next(error); }
  });

  router.get("/me", async (request, response, next) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: "Authentication required." });
      const [rows] = await pool.execute("SELECT id, email FROM developer_account WHERE id = ? AND email = ? LIMIT 1", [request.session.userId, OWNER_EMAIL]);
      if (!rows[0]) return response.status(401).json({ error: "Authentication required." });
      return response.json({ user: { id: String(rows[0].id), email: rows[0].email } });
    } catch (error) { return next(error); }
  });

  router.post("/change-password", requireCsrf, async (request, response, next) => {
    const parsed = passwordSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Choose a password of at least 8 characters and confirm it." });
    try {
      const [rows] = await pool.execute("SELECT id, password_hash FROM developer_account WHERE id = ? AND email = ? LIMIT 1", [request.session.userId, OWNER_EMAIL]);
      if (!rows[0] || !(await argon2.verify(rows[0].password_hash, parsed.data.currentPassword))) return response.status(400).json({ error: "The current password is incorrect." });
      const hash = await argon2.hash(parsed.data.newPassword, { type: argon2.argon2id });
      await pool.execute("UPDATE developer_account SET password_hash = ? WHERE id = ?", [hash, rows[0].id]);
      await regenerateSession(request);
      request.session.userId = String(rows[0].id);
      request.session.csrfToken = randomBytes(32).toString("hex");
      await saveSession(request);
      return response.json({ message: "Password updated." });
    } catch (error) { return next(error); }
  });

  router.post("/logout", requireCsrf, (request, response, next) => {
    request.session.destroy((error) => {
      if (error) return next(error);
      response.clearCookie("fetman.sid", { httpOnly: true, secure: request.secure, sameSite: "lax", path: "/" });
      return response.status(204).end();
    });
  });
  return router;
}

function regenerateSession(request) {
  return new Promise((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()));
}
function saveSession(request) {
  return new Promise((resolve, reject) => request.session.save((error) => error ? reject(error) : resolve()));
}
function constantTimeStringMatch(left, right) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

module.exports = { OWNER_EMAIL, createAuthRouter, constantTimeStringMatch };
