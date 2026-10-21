const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");

const DEFAULT_ASSET_DIRECTORY = path.resolve(
  __dirname,
  "../../secure-uploads/design",
);

function createPublicDesignRouter({
  pool,
  assetDirectory = DEFAULT_ASSET_DIRECTORY,
}) {
  const router = express.Router();

  router.get("/design-content", async (_request, response) => {
    const [rows] = await pool.execute(
      `SELECT id, type, title, description, alt_text, asset_id, category,
              tags, display_order, source_key, legacy_image_url
       FROM graphic_design_content
       WHERE is_deleted = 0 AND publication_status = 'published'
       ORDER BY display_order, id`,
    );
    response.set("Cache-Control", "no-store");
    return response.status(200).json({
      content: rows.map(publicContent),
    });
  });

  router.get("/design-portfolio", async (_request, response) => {
    const [rows] = await pool.execute(
      `SELECT id, type, title, description, alt_text, asset_id, category,
              tags, display_order, source_key, legacy_image_url
       FROM graphic_design_content
       WHERE type = 'portfolio' AND is_deleted = 0
         AND publication_status = 'published'
       ORDER BY display_order, id`,
    );
    const [managedRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM graphic_design_content
       WHERE type = 'portfolio' AND source_key IS NOT NULL`,
    );
    response.set("Cache-Control", "no-store");
    return response.status(200).json({
      projects: rows.map(publicContent),
      legacyPortfolioManaged: Number(managedRows[0]?.total ?? 0) > 0,
    });
  });

  router.get("/design-assets/:assetId", async (request, response) => {
    const assetId = parseId(request.params.assetId);
    if (!assetId) {
      return response.status(400).json({ error: "Invalid asset id." });
    }
    const [rows] = await pool.execute(
      `SELECT a.storage_name, a.media_type
       FROM graphic_design_assets a
       JOIN graphic_design_content c ON c.asset_id = a.id
       WHERE a.id = ? AND c.is_deleted = 0
         AND c.publication_status = 'published'
       LIMIT 1`,
      [assetId],
    );
    const asset = rows[0];
    if (!asset) {
      return response.status(404).json({ error: "Asset not found." });
    }

    let filePath;
    try {
      filePath = path.join(assetDirectory, path.basename(asset.storage_name));
      await fs.access(filePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        return response.status(404).json({ error: "Asset not found." });
      }
      throw error;
    }

    response.set({
      "Content-Type": asset.media_type,
      "Content-Disposition": `inline; filename="design-${assetId}.webp"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
    return response.sendFile(filePath);
  });

  return router;
}

function publicContent(content) {
  return {
    id: content.id,
    type: content.type,
    title: content.title,
    description: content.description,
    alt_text: content.alt_text,
    asset_id: content.asset_id,
    category: content.category,
    tags: Array.isArray(content.tags) ? content.tags : [],
    display_order: content.display_order,
    source_key: content.source_key,
    legacy_image_url: content.legacy_image_url,
  };
}

function parseId(value) {
  return typeof value === "string" && /^[1-9]\d{0,19}$/.test(value)
    ? value
    : null;
}

module.exports = { createPublicDesignRouter };
