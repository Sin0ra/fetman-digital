const express = require("express");
const { z } = require("zod");
const { getAuthenticatedUser } = require("../middleware/auth");
const { requireCsrf } = require("../middleware/csrf");
const { validate } = require("../middleware/validate");
const { readMaintenanceMode } = require("../maintenance-mode");

const maintenanceUpdateSchema = z.object({
  maintenanceMode: z.boolean(),
  version: z.number().int().min(0).max(4294967294),
}).strict();

function createDeveloperRouter({ pool, environment }) {
  const router = express.Router();

  router.use(async (request, response, next) => {
    const user = await getAuthenticatedUser(pool, request, response);
    if (!user) return;
    if (user.role !== "Developer") {
      return response.status(403).json({ error: "Forbidden" });
    }
    request.developerUser = user;
    return next();
  });

  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  router.get("/dashboard", (request, response) => {
    return response.status(200).json({
      user: {
        email: request.developerUser.email,
        role: request.developerUser.role,
      },
      status: "authenticated",
    });
  });

  router.get("/maintenance-mode", async (_request, response) => {
    try {
      const setting = await readMaintenanceMode(pool);
      return response.status(200).json(setting);
    } catch (error) {
      console.error("Developer maintenance state is unavailable", {
        errorCode: safeErrorCode(error),
      });
      return response.status(503).json({
        error: "Maintenance mode state is temporarily unavailable.",
      });
    }
  });

  router.put(
    "/maintenance-mode",
    requireCsrf,
    validate(maintenanceUpdateSchema),
    async (request, response) => {
      try {
        const result = await pool.execute(
          `UPDATE site_maintenance_settings
           SET maintenance_mode = ?, version = version + 1
           WHERE id = 1 AND version = ?`,
          [request.body.maintenanceMode ? 1 : 0, request.body.version],
        );
        if (result[0].affectedRows !== 1) {
          const current = await readMaintenanceMode(pool);
          return response.status(409).json({
            error: "Maintenance mode changed in another session. The current saved state is shown.",
            ...current,
          });
        }

        const setting = await readMaintenanceMode(pool);
        return response.status(200).json(setting);
      } catch (error) {
        console.error("Developer maintenance state could not be updated", {
          errorCode: safeErrorCode(error),
        });
        return response.status(503).json({
          error: "Maintenance mode could not be updated. Check the database connection and retry.",
        });
      }
    },
  );

  router.get("/overview", async (_request, response) => {
    try {
      const [metricRows] = await pool.execute(
        `SELECT
           COUNT(*) AS total_portfolio_projects,
           COALESCE(SUM(publication_status = 'published'), 0) AS published_projects,
           COALESCE(SUM(publication_status = 'draft'), 0) AS draft_projects
         FROM graphic_design_content
         WHERE type = 'portfolio' AND is_deleted = 0`,
      );
      const [assetRows] = await pool.execute(
        "SELECT COUNT(*) AS design_assets FROM graphic_design_assets",
      );
      const [taskRows] = await pool.execute(
        "SELECT COUNT(*) AS pending_tasks FROM graphic_design_tasks WHERE status = 'Pending'",
      );
      const [recentChanges] = await pool.execute(
        `SELECT r.action, c.title, r.created_at
         FROM graphic_design_content_revisions r
         JOIN graphic_design_content c ON c.id = r.content_id
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT 5`,
      );

      const metrics = metricRows[0];
      if (!metrics || !assetRows[0] || !taskRows[0]) {
        throw new Error("Developer overview data is incomplete.");
      }
      return response.status(200).json({
        metrics: {
          totalPortfolioProjects: toCount(metrics.total_portfolio_projects),
          publishedProjects: toCount(metrics.published_projects),
          draftProjects: toCount(metrics.draft_projects),
          designAssets: toCount(assetRows[0].design_assets),
          pendingTasks: toCount(taskRows[0].pending_tasks),
        },
        recentChanges: recentChanges.map((change) => ({
          action: change.action,
          title: change.title,
          createdAt: change.created_at,
        })),
      });
    } catch (error) {
      console.error("Developer overview data is unavailable", {
        errorCode: safeErrorCode(error),
      });
      return response.status(503).json({
        error: "Developer overview data is temporarily unavailable.",
      });
    }
  });

  router.get("/diagnostics", async (_request, response) => {
    let database = "healthy";
    try {
      await pool.query("SELECT 1");
    } catch (error) {
      database = "unavailable";
      console.error("Developer database diagnostic failed", {
        errorCode: safeErrorCode(error),
      });
    }

    const checkedAt = new Date().toISOString();
    return response.status(200).json({
      status: database === "healthy" ? "healthy" : "degraded",
      backend: "healthy",
      database,
      environment: ["development", "test", "production"].includes(environment)
        ? environment
        : "unknown",
      uptimeSeconds: Math.floor(process.uptime()),
      checkedAt,
    });
  });

  return router;
}

function toCount(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Developer overview count is invalid.");
  }
  return count;
}

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
    ? error.code
    : "INTERNAL_ERROR";
}

module.exports = { createDeveloperRouter };
