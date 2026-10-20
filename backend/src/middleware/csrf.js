const { timingSafeEqual } = require("node:crypto");

function requireCsrf(request, response, next) {
  const expected = request.session.csrfToken;
  const provided = request.get("X-CSRF-Token");
  const expectedBytes = typeof expected === "string" ? Buffer.from(expected) : null;
  const providedBytes = typeof provided === "string" ? Buffer.from(provided) : null;

  if (
    !expectedBytes ||
    !providedBytes ||
    expectedBytes.length !== providedBytes.length ||
    !timingSafeEqual(expectedBytes, providedBytes)
  ) {
    return response.status(403).json({ error: "Invalid request token." });
  }

  return next();
}

module.exports = { requireCsrf };
