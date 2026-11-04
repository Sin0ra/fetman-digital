const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const { z } = require("zod");
const sharp = require("sharp");
const { requireDeveloper } = require("../middleware/auth");
const { requireCsrf } = require("../middleware/csrf");

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const httpUrlSchema = z.string().trim().url().max(500).refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "Only HTTP and HTTPS URLs are allowed.");
const projectSchema = z.object({
  title: z.string().trim().min(1).max(160), description: z.string().trim().min(1).max(5000),
  category: z.string().trim().min(1).max(80), imageAssetId: z.union([z.string().regex(/^\d+$/), z.null()]).default(null),
  imageUrl: httpUrlSchema.nullable().default(null), projectUrl: httpUrlSchema,
  published: z.boolean().default(false), displayOrder: z.number().int().min(0).max(100000).default(0),
}).strict();
const contentSchema = z.object({
  heroTitle: z.string().trim().min(1).max(220), heroDescription: z.string().trim().max(1000),
  aboutTitle: z.string().trim().min(1).max(220), aboutDescription: z.string().trim().max(5000),
  services: z.array(z.string().trim().min(1).max(1000)).length(5), primaryCta: z.string().trim().min(1).max(80), secondaryCta: z.string().trim().min(1).max(80),
  contactEmail: z.string().trim().email().max(254), contactWhatsapp: z.string().trim().max(40),
}).strict();

function createPortalRouter({ pool, mediaDirectory }) {
  const router = express.Router();
  router.use(requireDeveloper(pool));

  router.get("/overview", async (_request, response, next) => {
    try {
      const [[projectCount], [publishedCount], [mediaCount]] = await Promise.all([
        pool.execute("SELECT COUNT(*) AS count FROM portfolio_projects"),
        pool.execute("SELECT COUNT(*) AS count FROM portfolio_projects WHERE published = 1"),
        pool.execute("SELECT COUNT(*) AS count FROM media_assets"),
      ]);
      return response.json({ projects: Number(projectCount[0].count), published: Number(publishedCount[0].count), media: Number(mediaCount[0].count) });
    } catch (error) { return next(error); }
  });

  router.get("/content", async (_request, response, next) => {
    try {
      const [rows] = await pool.execute("SELECT setting_value FROM site_settings WHERE setting_key = 'site_content' LIMIT 1");
      let content = {};
      try { content = JSON.parse(rows[0]?.setting_value || "{}"); } catch { return response.status(503).json({ error: "Site content is invalid." }); }
      return response.json({ content });
    } catch (error) { return next(error); }
  });
  router.put("/content", requireCsrf, async (request, response, next) => {
    const parsed = contentSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid website content." });
    try {
      await pool.execute("UPDATE site_settings SET setting_value = ? WHERE setting_key = 'site_content'", [JSON.stringify(parsed.data)]);
      return response.json({ content: parsed.data });
    } catch (error) { return next(error); }
  });

  router.get("/portfolio", async (_request, response, next) => {
    try {
      const [rows] = await pool.execute(`SELECT p.id, p.title, p.description, p.category, p.image_asset_id AS imageAssetId,
        p.image_url AS imageUrl, p.project_url AS projectUrl, p.published, p.display_order AS displayOrder,
        m.storage_name AS storageName FROM portfolio_projects p LEFT JOIN media_assets m ON m.id = p.image_asset_id
        ORDER BY p.display_order, p.id`);
      return response.json({ projects: rows.map((row) => ({ id: String(row.id), title: row.title, description: row.description, category: row.category, imageAssetId: row.imageAssetId ? String(row.imageAssetId) : null, published: Boolean(row.published), imageUrl: row.imageUrl || null, projectUrl: row.projectUrl, displayOrder: row.displayOrder, imagePreviewUrl: row.imageAssetId ? `/api/developer/media/${row.imageAssetId}` : row.imageUrl })) });
    } catch (error) { return next(error); }
  });
  router.post("/portfolio", requireCsrf, async (request, response, next) => saveProject(pool, request, response, next, null));
  router.put("/portfolio/:id", requireCsrf, async (request, response, next) => saveProject(pool, request, response, next, request.params.id));
  router.delete("/portfolio/:id", requireCsrf, async (request, response, next) => {
    if (!/^[1-9]\d{0,19}$/.test(request.params.id)) return response.status(400).json({ error: "Invalid project id." });
    try { const [result] = await pool.execute("DELETE FROM portfolio_projects WHERE id = ?", [request.params.id]); return result.affectedRows ? response.status(204).end() : response.status(404).json({ error: "Project not found." }); } catch (error) { return next(error); }
  });

  router.get("/media", async (_request, response, next) => {
    try { const [rows] = await pool.execute("SELECT id, original_name AS originalName, media_type AS mediaType, byte_size AS byteSize, created_at AS createdAt FROM media_assets ORDER BY id DESC"); return response.json({ media: rows.map((row) => ({ ...row, id: String(row.id), previewUrl: `/api/developer/media/${row.id}` })) }); } catch (error) { return next(error); }
  });
  router.post("/media", requireCsrf, express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: MAX_IMAGE_BYTES }), async (request, response, next) => {
    if (!Buffer.isBuffer(request.body) || !request.body.length) return response.status(400).json({ error: "Upload a JPEG, PNG, or WebP image." });
    let filePath;
    try {
      const metadata = await sharp(request.body).metadata();
      if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format) || !metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000) return response.status(415).json({ error: "The uploaded image is invalid or too large." });
      const converted = await sharp(request.body).webp({ quality: 84 }).toBuffer();
      const storageName = `${randomUUID()}.webp`;
      await fs.mkdir(mediaDirectory, { recursive: true, mode: 0o700 });
      filePath = path.join(mediaDirectory, storageName);
      const file = await fs.open(filePath, "wx", 0o600);
      try { await file.writeFile(converted); } finally { await file.close(); }
      const originalName = (request.get("X-File-Name") || "upload").replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 160) || "upload";
      const [result] = await pool.execute("INSERT INTO media_assets (storage_name, original_name, media_type, byte_size) VALUES (?, ?, 'image/webp', ?)", [storageName, originalName, converted.length]);
      return response.status(201).json({ media: { id: String(result.insertId), originalName, mediaType: "image/webp", byteSize: converted.length, previewUrl: `/api/developer/media/${result.insertId}` } });
    } catch (error) {
      if (filePath) {
        try { await fs.unlink(filePath); } catch (cleanupError) { if (cleanupError.code !== "ENOENT") console.error("Failed to clean up media upload.", { errorCode: cleanupError.code }); }
      }
      if (["EACCES", "ENOENT", "EROFS"].includes(error.code)) return response.status(503).json({ error: "Persistent media storage is unavailable." });
      return next(error);
    }
  });
  router.get("/media/:id", async (request, response, next) => {
    if (!/^[1-9]\d{0,19}$/.test(request.params.id)) return response.status(400).json({ error: "Invalid media id." });
    try { const [rows] = await pool.execute("SELECT storage_name AS storageName FROM media_assets WHERE id = ? LIMIT 1", [request.params.id]); if (!rows[0]) return response.status(404).end(); response.set({ "Content-Type": "image/webp", "Content-Disposition": 'inline; filename="media.webp"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }); return response.sendFile(path.join(mediaDirectory, path.basename(rows[0].storageName))); } catch (error) { return next(error); }
  });

  router.get("/maintenance", async (_request, response, next) => { try { return response.json({ maintenanceMode: await readSetting(pool, "maintenance_mode") === "1" }); } catch (error) { return next(error); } });
  router.put("/maintenance", requireCsrf, async (request, response, next) => { const parsed = z.object({ enabled: z.boolean() }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: "Invalid maintenance setting." }); try { await pool.execute("UPDATE site_settings SET setting_value = ? WHERE setting_key = 'maintenance_mode'", [parsed.data.enabled ? "1" : "0"]); return response.json({ enabled: parsed.data.enabled }); } catch (error) { return next(error); } });
  return router;
}

async function saveProject(pool, request, response, next, id) {
  const parsed = projectSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Invalid portfolio project." });
  try {
    const value = parsed.data;
    if (value.imageAssetId) { const [assets] = await pool.execute("SELECT id FROM media_assets WHERE id = ?", [value.imageAssetId]); if (!assets[0]) return response.status(400).json({ error: "Selected media does not exist." }); }
    if (id === null) {
      const [result] = await pool.execute("INSERT INTO portfolio_projects (title, description, category, image_asset_id, image_url, project_url, published, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [value.title, value.description, value.category, value.imageAssetId, value.imageUrl, value.projectUrl, value.published ? 1 : 0, value.displayOrder]);
      return response.status(201).json({ id: String(result.insertId) });
    }
    if (!/^[1-9]\d{0,19}$/.test(id)) return response.status(400).json({ error: "Invalid project id." });
    const [result] = await pool.execute("UPDATE portfolio_projects SET title = ?, description = ?, category = ?, image_asset_id = ?, image_url = ?, project_url = ?, published = ?, display_order = ? WHERE id = ?", [value.title, value.description, value.category, value.imageAssetId, value.imageUrl, value.projectUrl, value.published ? 1 : 0, value.displayOrder, id]);
    return result.affectedRows ? response.json({ id }) : response.status(404).json({ error: "Project not found." });
  } catch (error) { return next(error); }
}
async function readSetting(pool, key) { const [rows] = await pool.execute("SELECT setting_value FROM site_settings WHERE setting_key = ?", [key]); if (!rows[0]) throw new Error("Setting missing"); return rows[0].setting_value; }

module.exports = { createPortalRouter };
