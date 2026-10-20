const express = require("express");

function createHealthRouter(pool) {
  const router = express.Router();

  router.get("/", async (_request, response) => {
    try {
      await pool.query("SELECT 1");
      return response.status(200).json({
        status: "ok",
        database: "connected",
      });
    } catch {
      return response.status(503).json({
        status: "unavailable",
        database: "unavailable",
      });
    }
  });

  return router;
}

module.exports = { createHealthRouter };
