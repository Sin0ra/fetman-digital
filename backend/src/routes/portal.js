const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const { z } = require("zod");
const sharp = require("sharp");
const { requireDeveloper } = require("../middleware/auth");
const { requireCsrf } = require("../middleware/csrf");

const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;
const TARGET_IMAGE_BYTES = 500 * 1024;
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const departments = ["Graphic Design", "IT"];
const httpUrlSchema = z.string().trim().url().max(500).refine((value) => {
  if (value === "") return true;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "Only HTTP and HTTPS URLs are allowed.");
const normalizeProjectUrl = (value) => value == null || typeof value === "string" && value.trim() === "" ? "" : value;
const projectUrlSchema = z.preprocess(normalizeProjectUrl, z.union([httpUrlSchema, z.literal("")]));
const optionalUpdateProjectUrlSchema = z.preprocess(
  (value) => value === undefined ? undefined : normalizeProjectUrl(value),
  z.union([httpUrlSchema, z.literal("")]).optional(),
);
const optionalHttpUrlSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  httpUrlSchema.nullable().default(null),
);
const optionalMediaIdSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.union([z.string().regex(/^[1-9]\d{0,19}$/), z.null()]).default(null),
);
const optionalUpdateHttpUrlSchema = z.preprocess(
  (value) => value === undefined ? undefined : typeof value === "string" && value.trim() === "" ? null : value,
  httpUrlSchema.nullable().optional(),
);
const optionalUpdateMediaIdSchema = z.preprocess(
  (value) => value === undefined ? undefined : typeof value === "string" && value.trim() === "" ? null : value,
  z.union([z.string().regex(/^[1-9]\d{0,19}$/), z.null()]).optional(),
);
const normalizeDescription = (value) => value == null || typeof value === "string" && value.trim() === "" ? "" : value;
const normalizeTitle = (value) => value == null || typeof value === "string" && value.trim() === "" ? null : value;
const descriptionSchema = z.preprocess(normalizeDescription, z.string().trim().max(5000));
const optionalUpdateDescriptionSchema = z.preprocess(
  (value) => value === undefined ? undefined : normalizeDescription(value),
  z.string().trim().max(5000).optional(),
);
const projectTitleSchema = z.preprocess(normalizeTitle, z.string().trim().max(160).nullable().default(null));
const optionalUpdateProjectTitleSchema = z.preprocess(
  (value) => value === undefined ? undefined : normalizeTitle(value),
  z.string().trim().max(160).nullable().optional(),
);
const projectSchema = z.object({
  title: projectTitleSchema, description: descriptionSchema,
  department: z.enum(departments), category: z.string().trim().min(1).max(80), imageAssetId: optionalMediaIdSchema,
  imageUrl: optionalHttpUrlSchema, projectUrl: projectUrlSchema,
  published: z.boolean().default(false), displayOrder: z.number().int().min(0).max(100000).default(0),
}).strict();
const projectUpdateSchema = z.object({
  title: optionalUpdateProjectTitleSchema, description: optionalUpdateDescriptionSchema,
  department: z.enum(departments), category: z.string().trim().min(1).max(80), imageAssetId: optionalUpdateMediaIdSchema,
  imageUrl: optionalUpdateHttpUrlSchema, projectUrl: optionalUpdateProjectUrlSchema,
  published: z.boolean().default(false), displayOrder: z.number().int().min(0).max(100000).default(0),
  id: z.string().regex(/^[1-9]\d{0,19}$/).optional(),
  imagePreviewUrl: z.string().max(500).optional(),
}).strict();
const departmentSchema = z.object({ department: z.enum(departments) }).strict();
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
      const requestedDepartment = typeof _request.query.department === "string" ? _request.query.department : null;
      const department = departments.includes(requestedDepartment) ? requestedDepartment : requestedDepartment === "unclassified" ? "unclassified" : null;
      const filter = department === "unclassified" ? "WHERE p.department IS NULL" : department ? "WHERE p.department = ?" : "";
      const [rows] = await pool.execute(`SELECT p.id, p.title, p.description, p.department, p.category, p.image_asset_id AS imageAssetId,
        p.image_url AS imageUrl, p.project_url AS projectUrl, p.published, p.display_order AS displayOrder,
        m.storage_name AS storageName FROM portfolio_projects p LEFT JOIN media_assets m ON m.id = p.image_asset_id
        ${filter} ORDER BY p.display_order, p.id`, department && department !== "unclassified" ? [department] : []);
      return response.json({ projects: rows.map((row) => ({ id: String(row.id), title: row.title, description: row.description, department: row.department, category: row.category, imageAssetId: row.imageAssetId ? String(row.imageAssetId) : null, published: Boolean(row.published), imageUrl: row.imageUrl || null, projectUrl: row.projectUrl, displayOrder: row.displayOrder, imagePreviewUrl: row.imageAssetId ? `/api/developer/media/${row.imageAssetId}` : row.imageUrl })) });
    } catch (error) { return next(error); }
  });
  router.post("/portfolio", requireCsrf, async (request, response, next) => saveProject(pool, request, response, next, null));
  router.put("/portfolio/:id", requireCsrf, async (request, response, next) => saveProject(pool, request, response, next, request.params.id));
  router.patch("/portfolio/:id/department", requireCsrf, async (request, response, next) => {
    const parsed = departmentSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Choose a valid department." });
    if (!/^[1-9]\d{0,19}$/.test(request.params.id)) return response.status(400).json({ error: "Invalid project id." });
    try {
      const [result] = await pool.execute("UPDATE portfolio_projects SET department = ? WHERE id = ? AND department IS NULL", [parsed.data.department, request.params.id]);
      return result.affectedRows ? response.json({ id: request.params.id, department: parsed.data.department }) : response.status(404).json({ error: "Only an unclassified project can be classified." });
    } catch (error) { return next(error); }
  });
  router.delete("/portfolio/:id", requireCsrf, async (request, response, next) => {
    if (!/^[1-9]\d{0,19}$/.test(request.params.id)) return response.status(400).json({ error: "Invalid project id." });
    try { const [result] = await pool.execute("DELETE FROM portfolio_projects WHERE id = ?", [request.params.id]); return result.affectedRows ? response.status(204).end() : response.status(404).json({ error: "Project not found." }); } catch (error) { return next(error); }
  });

  router.get("/media", async (_request, response, next) => {
    try { const [rows] = await pool.execute("SELECT id, original_name AS originalName, media_type AS mediaType, byte_size AS byteSize, created_at AS createdAt FROM media_assets ORDER BY id DESC"); return response.json({ media: rows.map((row) => ({ ...row, id: String(row.id), previewUrl: `/api/developer/media/${row.id}` })) }); } catch (error) { return next(error); }
  });
  router.post("/media", requireCsrf, express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: MAX_IMAGE_UPLOAD_BYTES }), async (request, response, next) => {
    if (!Buffer.isBuffer(request.body) || !request.body.length) return response.status(400).json({ error: "Upload a JPEG, PNG, or WebP image." });
    let filePath;
    try {
      const metadata = await sharp(request.body, { failOn: "error", limitInputPixels: MAX_IMAGE_PIXELS, sequentialRead: true }).metadata();
      if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format) || !metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS || (metadata.pages ?? 1) > 1) return response.status(415).json({ error: "The uploaded image is invalid or too large." });
      const converted = await processPortfolioImage(request.body);
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
      if (error.code === "IMAGE_OUTPUT_TOO_LARGE") return response.status(413).json({ error: error.message });
      if (typeof error.code === "string" && error.code.startsWith("ERR_")) return response.status(415).json({ error: "The uploaded image is invalid or unsupported." });
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
  const parsed = (id === null ? projectSchema : projectUpdateSchema).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Invalid portfolio project." });
  try {
    const value = parsed.data;
    if (value.imageAssetId) { const [assets] = await pool.execute("SELECT id FROM media_assets WHERE id = ?", [value.imageAssetId]); if (!assets[0]) return response.status(400).json({ error: "Selected media does not exist." }); }
    if (id === null) {
      const [result] = await pool.execute("INSERT INTO portfolio_projects (title, description, department, category, image_asset_id, image_url, project_url, published, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [value.title, value.description, value.department, value.category, value.imageAssetId, value.imageUrl, value.projectUrl, value.published ? 1 : 0, value.displayOrder]);
      return response.status(201).json({ id: String(result.insertId) });
    }
    if (!/^[1-9]\d{0,19}$/.test(id)) return response.status(400).json({ error: "Invalid project id." });
    const [existingRows] = await pool.execute("SELECT title, department, description, image_asset_id AS imageAssetId, image_url AS imageUrl, project_url AS projectUrl FROM portfolio_projects WHERE id = ? LIMIT 1", [id]);
    if (!existingRows[0]) return response.status(404).json({ error: "Project not found." });
    if (existingRows[0].department !== value.department) return response.status(409).json({ error: "A project's department cannot be changed during editing." });
    const title = value.title === undefined ? existingRows[0].title : value.title;
    const description = value.description === undefined ? existingRows[0].description : value.description;
    const imageAssetId = value.imageAssetId === undefined ? existingRows[0].imageAssetId : value.imageAssetId;
    const imageUrl = value.imageUrl === undefined ? existingRows[0].imageUrl : value.imageUrl;
    const projectUrl = value.projectUrl === undefined ? existingRows[0].projectUrl : value.projectUrl;
    const [result] = await pool.execute("UPDATE portfolio_projects SET title = ?, description = ?, category = ?, image_asset_id = ?, image_url = ?, project_url = ?, published = ?, display_order = ? WHERE id = ?", [title, description, value.category, imageAssetId, imageUrl, projectUrl, value.published ? 1 : 0, value.displayOrder, id]);
    return result.affectedRows ? response.json({ id }) : response.status(404).json({ error: "Project not found." });
  } catch (error) { return next(error); }
}
async function readSetting(pool, key) { const [rows] = await pool.execute("SELECT setting_value FROM site_settings WHERE setting_key = ?", [key]); if (!rows[0]) throw new Error("Setting missing"); return rows[0].setting_value; }

module.exports = {
  createPortalRouter,
  departments,
  projectSchema,
  projectUpdateSchema,
  departmentSchema,
  MAX_IMAGE_UPLOAD_BYTES,
  TARGET_IMAGE_BYTES,
  MAX_IMAGE_BYTES,
  processPortfolioImage,
};

async function processPortfolioImage(input) {
  const attempts = [
    [2000, 84], [2000, 76], [2000, 68], [2000, 60], [2000, 52],
    [1800, 50], [1600, 48], [1400, 46], [1200, 44], [1000, 42], [800, 40],
  ];
  let bestUnderLimit;
  for (const [dimension, quality] of attempts) {
    const output = await sharp(input, { failOn: "error", limitInputPixels: MAX_IMAGE_PIXELS, sequentialRead: true })
      .rotate()
      .resize({ width: dimension, height: dimension, fit: "inside", withoutEnlargement: true })
      .webp({ quality, effort: 5, smartSubsample: true })
      .toBuffer();
    if (output.length <= TARGET_IMAGE_BYTES) return output;
    if (output.length <= MAX_IMAGE_BYTES && (!bestUnderLimit || output.length < bestUnderLimit.length)) bestUnderLimit = output;
  }
  if (bestUnderLimit) return bestUnderLimit;
  const error = new Error("The processed image is too large after compression.");
  error.code = "IMAGE_OUTPUT_TOO_LARGE";
  throw error;
}
