const OWNER_EMAIL = "sinoworkguma@gmail.com";

function requireDeveloper(pool) {
  return async (request, response, next) => {
    if (!request.session.userId) return response.status(401).json({ error: "Authentication required." });
    try {
      const [rows] = await pool.execute("SELECT id, email FROM developer_account WHERE id = ? AND email = ? LIMIT 1", [request.session.userId, OWNER_EMAIL]);
      if (!rows[0]) return response.status(401).json({ error: "Authentication required." });
      request.developer = rows[0];
      return next();
    } catch (error) { return next(error); }
  };
}

module.exports = { OWNER_EMAIL, requireDeveloper };
