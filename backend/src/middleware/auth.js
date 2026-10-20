async function getAuthenticatedUser(pool, request, response) {
  const userId = request.session.userId;
  if (!userId) {
    response.status(401).json({ error: "Authentication required" });
    return null;
  }

  const [rows] = await pool.execute(
    `SELECT id, email, role, is_active, password_change_required
     FROM management_users WHERE id = ? LIMIT 1`,
    [userId],
  );
  const user = rows[0];

  if (!user || !user.is_active) {
    const secureCookie = request.session.cookie.secure;
    await new Promise((resolve, reject) => {
      request.session.destroy((error) => (error ? reject(error) : resolve()));
    });
    response.clearCookie("fetman.sid", {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "lax",
      path: "/",
    });
    response.status(401).json({ error: "Authentication required" });
    return null;
  }

  return user;
}

function requirePasswordChangeComplete(pool) {
  return async (request, response, next) => {
    if (!request.session.userId) {
      return next();
    }

    const [rows] = await pool.execute(
      "SELECT password_change_required FROM management_users WHERE id = ? LIMIT 1",
      [request.session.userId],
    );
    const isPending =
      rows[0]?.password_change_required === true ||
      rows[0]?.password_change_required === 1 ||
      rows[0]?.password_change_required === "1";

    if (isPending) {
      return response.status(403).json({
        error: "Change your password before continuing.",
        code: "PASSWORD_CHANGE_REQUIRED",
      });
    }

    return next();
  };
}

module.exports = { getAuthenticatedUser, requirePasswordChangeComplete };
