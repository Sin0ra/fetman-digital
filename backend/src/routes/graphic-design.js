const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const { z } = require("zod");
const { getAuthenticatedUser } = require("../middleware/auth");
const { requireCsrf } = require("../middleware/csrf");
const sharp = require("sharp");

const DEFAULT_ASSET_DIRECTORY = path.resolve(
  __dirname,
  "../../secure-uploads/design",
);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 12_000;
const MAX_IMAGE_PIXELS = 40_000_000;
const DEFAULT_WEBP_QUALITY = parseWebpQuality(
  process.env.GRAPHIC_DESIGN_WEBP_QUALITY,
);
const IMAGE_TYPES = new Map([
  ["image/jpeg", { signature: isJpeg }],
  ["image/png", { signature: isPng }],
  ["image/webp", { signature: isWebp }],
]);
const taskStatuses = ["Pending", "In Progress", "In Review", "Completed"];
const contentTypes = ["banner", "portfolio", "visual"];

const taskSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(5000).default(""),
    deadline: z.union([z.iso.date(), z.null()]).optional().default(null),
  })
  .strict();
const taskUpdateSchema = z
  .object({
    status: z.enum(taskStatuses),
  })
  .strict();
const noteSchema = z
  .object({
    note: z.string().trim().min(1).max(4000),
  })
  .strict();
const contentSchema = z
  .object({
    type: z.enum(contentTypes),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(5000).default(""),
    altText: z.string().trim().max(250).default(""),
    assetId: z.union([z.string().regex(/^\d+$/), z.null()]).default(null),
  })
  .strict();
const contentPatchSchema = z
  .object({
    type: z.enum(contentTypes).optional(),
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(5000).optional(),
    altText: z.string().trim().max(250).optional(),
    assetId: z.union([z.string().regex(/^\d+$/), z.null()]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

function createGraphicDesignRouter({
  pool,
  assetDirectory = DEFAULT_ASSET_DIRECTORY,
  webpQuality = DEFAULT_WEBP_QUALITY,
}) {
  if (!Number.isInteger(webpQuality) || webpQuality < 1 || webpQuality > 100) {
    throw new Error("Graphic Design WebP quality must be an integer from 1 to 100.");
  }

  const router = express.Router();

  router.use(async (request, response, next) => {
    const user = await getAuthenticatedUser(pool, request, response);
    if (!user) {
      return;
    }
    if (user.role !== "Graphic Design") {
      return response.status(403).json({ error: "Forbidden" });
    }

    request.managementUser = user;
    return next();
  });

  router.get("/tasks", async (request, response) => {
    const [rows] = await pool.execute(
      `SELECT id, title, description, deadline, status, created_at, updated_at
       FROM graphic_design_tasks
       WHERE assigned_user_id = ?
       ORDER BY deadline IS NULL, deadline, created_at DESC`,
      [request.managementUser.id],
    );
    return response.status(200).json({ tasks: rows });
  });

  router.post("/tasks", requireCsrf, async (request, response) => {
    const parsed = taskSchema.safeParse(request.body);
    if (!parsed.success) {
      return invalidData(response, parsed.error);
    }

    const [result] = await pool.execute(
      `INSERT INTO graphic_design_tasks
       (assigned_user_id, title, description, deadline, status)
       VALUES (?, ?, ?, ?, 'Pending')`,
      [
        request.managementUser.id,
        parsed.data.title,
        parsed.data.description,
        parsed.data.deadline,
      ],
    );
    const [rows] = await pool.execute(
      `SELECT id, title, description, deadline, status, created_at, updated_at
       FROM graphic_design_tasks
       WHERE id = ? AND assigned_user_id = ?`,
      [result.insertId, request.managementUser.id],
    );
    return response.status(201).json({ task: rows[0] });
  });

  router.patch("/tasks/:taskId", requireCsrf, async (request, response) => {
    const parsed = taskUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return invalidData(response, parsed.error);
    }
    const taskId = parseId(request.params.taskId);
    if (!taskId) {
      return response.status(400).json({ error: "Invalid task id." });
    }
    if (!(await ownsTask(pool, taskId, request.managementUser.id))) {
      return response.status(404).json({ error: "Task not found." });
    }

    await pool.execute(
      `UPDATE graphic_design_tasks
       SET status = ?
       WHERE id = ? AND assigned_user_id = ?`,
      [parsed.data.status, taskId, request.managementUser.id],
    );

    await pool.execute(
      `INSERT INTO graphic_design_task_updates
       (task_id, user_id, status, note)
       VALUES (?, ?, ?, '')`,
      [taskId, request.managementUser.id, parsed.data.status],
    );
    const [rows] = await pool.execute(
      `SELECT id, title, description, deadline, status, created_at, updated_at
       FROM graphic_design_tasks
       WHERE id = ? AND assigned_user_id = ?`,
      [taskId, request.managementUser.id],
    );
    return response.status(200).json({ task: rows[0] });
  });

  router.get("/tasks/:taskId/updates", async (request, response) => {
    const taskId = parseId(request.params.taskId);
    if (!taskId) {
      return response.status(400).json({ error: "Invalid task id." });
    }
    if (!(await ownsTask(pool, taskId, request.managementUser.id))) {
      return response.status(404).json({ error: "Task not found." });
    }

    const [rows] = await pool.execute(
      `SELECT id, status, note, created_at
       FROM graphic_design_task_updates
       WHERE task_id = ? AND user_id = ?
       ORDER BY created_at DESC, id DESC`,
      [taskId, request.managementUser.id],
    );
    return response.status(200).json({ updates: rows });
  });

  router.post("/tasks/:taskId/updates", requireCsrf, async (request, response) => {
    const parsed = noteSchema.safeParse(request.body);
    if (!parsed.success) {
      return invalidData(response, parsed.error);
    }
    const taskId = parseId(request.params.taskId);
    if (!taskId) {
      return response.status(400).json({ error: "Invalid task id." });
    }
    if (!(await ownsTask(pool, taskId, request.managementUser.id))) {
      return response.status(404).json({ error: "Task not found." });
    }

    const [result] = await pool.execute(
      `INSERT INTO graphic_design_task_updates (task_id, user_id, status, note)
       VALUES (?, ?, NULL, ?)`,
      [taskId, request.managementUser.id, parsed.data.note],
    );
    return response.status(201).json({
      update: {
        id: result.insertId,
        status: null,
        note: parsed.data.note,
      },
    });
  });

  router.get("/assets", async (request, response) => {
    const [rows] = await pool.execute(
      `SELECT id, task_id, original_name, media_type, byte_size, created_at
       FROM graphic_design_assets
       WHERE owner_user_id = ?
       ORDER BY created_at DESC, id DESC`,
      [request.managementUser.id],
    );
    return response.status(200).json({ assets: rows });
  });

  router.post(
    "/assets",
    requireCsrf,
    express.raw({
      type: ["image/jpeg", "image/png", "image/webp"],
      limit: MAX_IMAGE_BYTES,
    }),
    async (request, response) => {
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        return response.status(400).json({ error: "Upload a JPEG, PNG, or WebP image." });
      }

      const mediaType = request.get("Content-Type")?.split(";")[0].trim().toLowerCase();
      const imageType = IMAGE_TYPES.get(mediaType);
      if (!imageType || !imageType.signature(request.body)) {
        return response.status(415).json({ error: "The uploaded image type is not supported." });
      }

      const taskId = request.query.taskId ? parseId(request.query.taskId) : null;
      if (request.query.taskId && !taskId) {
        return response.status(400).json({ error: "Invalid task id." });
      }
      if (
        taskId &&
        !(await ownsTask(pool, taskId, request.managementUser.id))
      ) {
        return response.status(404).json({ error: "Task not found." });
      }

      let converted;
      try {
        converted = await convertToWebp(request.body, webpQuality);
      } catch (error) {
        if (
          error instanceof ImageLimitError ||
          (error instanceof Error && /pixel limit/i.test(error.message))
        ) {
          return response.status(413).json({
            error: "The image dimensions exceed the supported limits.",
          });
        }
        console.warn("Rejected an invalid Graphic Design image upload.", {
          code: typeof error?.code === "string" ? error.code : "IMAGE_DECODE_ERROR",
        });
        return response.status(415).json({ error: "The uploaded image is invalid or unsupported." });
      }

      const storageName = `${randomUUID()}.webp`;
      const filePath = path.join(assetDirectory, storageName);
      const originalName = safeOriginalFilename(request.get("X-File-Name"));

      let fileCreated = false;
      let result;
      try {
        await fs.mkdir(assetDirectory, { recursive: true, mode: 0o700 });
        const file = await fs.open(filePath, "wx", 0o600);
        fileCreated = true;
        try {
          await file.writeFile(converted.data);
        } finally {
          await file.close();
        }
        [result] = await pool.execute(
          `INSERT INTO graphic_design_assets
           (owner_user_id, task_id, storage_name, original_name, media_type, byte_size)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            request.managementUser.id,
            taskId,
            storageName,
            originalName,
            "image/webp",
            converted.data.length,
          ],
        );
      } catch (error) {
        if (fileCreated) {
          try {
            await fs.unlink(filePath);
          } catch (cleanupError) {
            if (cleanupError.code !== "ENOENT") {
              console.error("Failed to remove an unregistered design upload.", {
                code:
                  typeof cleanupError.code === "string"
                    ? cleanupError.code
                    : "CLEANUP_ERROR",
              });
            }
          }
        }
        throw error;
      }

      return response.status(201).json({
        asset: {
          id: result.insertId,
          task_id: taskId,
          original_name: originalName,
          media_type: "image/webp",
          byte_size: converted.data.length,
          previewUrl: `/api/graphic-design/assets/${result.insertId}/preview`,
        },
      });
    },
  );

  router.get("/assets/:assetId/preview", async (request, response) => {
    const assetId = parseId(request.params.assetId);
    if (!assetId) {
      return response.status(400).json({ error: "Invalid asset id." });
    }
    const [rows] = await pool.execute(
      `SELECT storage_name, media_type
       FROM graphic_design_assets
       WHERE id = ? AND owner_user_id = ?
       LIMIT 1`,
      [assetId, request.managementUser.id],
    );
    const asset = rows[0];
    if (!asset) {
      return response.status(404).json({ error: "Asset not found." });
    }

    response.set({
      "Content-Type": asset.media_type,
      "Content-Disposition": `inline; filename="design-${assetId}.${extensionFor(asset.media_type)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
    return response.sendFile(path.join(assetDirectory, asset.storage_name));
  });

  router.get("/content", async (request, response) => {
    const [rows] = await pool.execute(
      `SELECT id, type, title, description, alt_text, asset_id, created_at, updated_at
       FROM graphic_design_content
       WHERE owner_user_id = ? AND is_deleted = 0
       ORDER BY updated_at DESC, id DESC`,
      [request.managementUser.id],
    );
    return response.status(200).json({ content: rows });
  });

  router.post("/content", requireCsrf, async (request, response) => {
    const parsed = contentSchema.safeParse(request.body);
    if (!parsed.success) {
      return invalidData(response, parsed.error);
    }
    if (
      parsed.data.assetId &&
      !(await ownsAsset(pool, parsed.data.assetId, request.managementUser.id))
    ) {
      return response.status(404).json({ error: "Asset not found." });
    }

    const [result] = await pool.execute(
      `INSERT INTO graphic_design_content
       (owner_user_id, type, title, description, alt_text, asset_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        request.managementUser.id,
        parsed.data.type,
        parsed.data.title,
        parsed.data.description,
        parsed.data.altText,
        parsed.data.assetId,
      ],
    );
    const [rows] = await pool.execute(
      `SELECT id, type, title, description, alt_text, asset_id, created_at, updated_at
       FROM graphic_design_content
       WHERE id = ? AND owner_user_id = ?`,
      [result.insertId, request.managementUser.id],
    );
    const content = rows[0];
    await saveContentRevision(pool, content, request.managementUser.id, "created");
    return response.status(201).json({ content });
  });

  router.get("/content/:contentId/preview", async (request, response) => {
    const contentId = parseId(request.params.contentId);
    if (!contentId) {
      return response.status(400).json({ error: "Invalid content id." });
    }
    const [rows] = await pool.execute(
      `SELECT id, type, title, description, alt_text, asset_id
       FROM graphic_design_content
       WHERE id = ? AND owner_user_id = ? AND is_deleted = 0
       LIMIT 1`,
      [contentId, request.managementUser.id],
    );
    const content = rows[0];
    if (!content) {
      return response.status(404).json({ error: "Draft not found." });
    }

    let image = "";
    if (content.asset_id) {
      const [assets] = await pool.execute(
        `SELECT id FROM graphic_design_assets
         WHERE id = ? AND owner_user_id = ? LIMIT 1`,
        [content.asset_id, request.managementUser.id],
      );
      if (assets[0]) {
        image = `<img src="/api/graphic-design/assets/${escapeHtml(assets[0].id)}/preview" alt="${escapeHtml(content.alt_text)}">`;
      }
    }
    response.type("html");
    response.set("Cache-Control", "private, no-store");
    return response.send(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.title)} — Draft preview</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#18251f}aside{padding:1rem;background:#fff4d6;border:1px solid #e4ca78;border-radius:.5rem}img{display:block;max-width:100%;height:auto;margin:1.5rem auto}h1{text-align:center}</style><aside><strong>Private draft preview</strong><br>This is not published and does not change the public website.</aside><main><h1>${escapeHtml(content.title)}</h1>${image}<p>${escapeHtml(content.description)}</p></main></html>`,
    );
  });

  router.get("/content/:contentId/revisions", async (request, response) => {
    const contentId = parseId(request.params.contentId);
    if (!contentId) {
      return response.status(400).json({ error: "Invalid content id." });
    }
    const [contentRows] = await pool.execute(
      `SELECT id FROM graphic_design_content
       WHERE id = ? AND owner_user_id = ? LIMIT 1`,
      [contentId, request.managementUser.id],
    );
    if (!contentRows[0]) {
      return response.status(404).json({ error: "Draft not found." });
    }
    const [rows] = await pool.execute(
      `SELECT id, action, snapshot, created_at
       FROM graphic_design_content_revisions
       WHERE content_id = ? AND owner_user_id = ?
       ORDER BY created_at DESC, id DESC`,
      [contentId, request.managementUser.id],
    );
    return response.status(200).json({ revisions: rows });
  });

  router.patch("/content/:contentId", requireCsrf, async (request, response) => {
    const parsed = contentPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return invalidData(response, parsed.error);
    }
    const contentId = parseId(request.params.contentId);
    if (!contentId) {
      return response.status(400).json({ error: "Invalid content id." });
    }
    const [existingRows] = await pool.execute(
      `SELECT id FROM graphic_design_content
       WHERE id = ? AND owner_user_id = ? AND is_deleted = 0 LIMIT 1`,
      [contentId, request.managementUser.id],
    );
    if (!existingRows[0]) {
      return response.status(404).json({ error: "Draft not found." });
    }
    if (
      parsed.data.assetId &&
      !(await ownsAsset(pool, parsed.data.assetId, request.managementUser.id))
    ) {
      return response.status(404).json({ error: "Asset not found." });
    }

    const columns = {
      type: "type",
      title: "title",
      description: "description",
      altText: "alt_text",
      assetId: "asset_id",
    };
    const assignments = [];
    const values = [];
    for (const [key, value] of Object.entries(parsed.data)) {
      assignments.push(`${columns[key]} = ?`);
      values.push(value);
    }
    values.push(contentId, request.managementUser.id);
    await pool.execute(
      `UPDATE graphic_design_content
       SET ${assignments.join(", ")}
       WHERE id = ? AND owner_user_id = ? AND is_deleted = 0`,
      values,
    );
    const [updatedRows] = await pool.execute(
      `SELECT id, type, title, description, alt_text, asset_id, created_at, updated_at
       FROM graphic_design_content
       WHERE id = ? AND owner_user_id = ?`,
      [contentId, request.managementUser.id],
    );
    const content = updatedRows[0];
    await saveContentRevision(pool, content, request.managementUser.id, "updated");
    return response.status(200).json({ content });
  });

  router.delete("/content/:contentId", requireCsrf, async (request, response) => {
    if (request.body?.confirm !== true) {
      return response.status(400).json({
        error: "Set confirm to true to remove this draft.",
      });
    }
    const contentId = parseId(request.params.contentId);
    if (!contentId) {
      return response.status(400).json({ error: "Invalid content id." });
    }
    const [rows] = await pool.execute(
      `SELECT id, type, title, description, alt_text, asset_id
       FROM graphic_design_content
       WHERE id = ? AND owner_user_id = ? AND is_deleted = 0 LIMIT 1`,
      [contentId, request.managementUser.id],
    );
    const content = rows[0];
    if (!content) {
      return response.status(404).json({ error: "Draft not found." });
    }
    await pool.execute(
      `UPDATE graphic_design_content
       SET is_deleted = 1
       WHERE id = ? AND owner_user_id = ?`,
      [contentId, request.managementUser.id],
    );
    await saveContentRevision(
      pool,
      { ...content, is_deleted: true },
      request.managementUser.id,
      "deleted",
    );
    return response.status(204).end();
  });

  return router;
}

function parseId(value) {
  return typeof value === "string" && /^[1-9]\d{0,19}$/.test(value)
    ? value
    : null;
}

async function ownsTask(pool, taskId, userId) {
  const [rows] = await pool.execute(
    `SELECT id FROM graphic_design_tasks
     WHERE id = ? AND assigned_user_id = ? LIMIT 1`,
    [taskId, userId],
  );
  return Boolean(rows[0]);
}

async function ownsAsset(pool, assetId, userId) {
  const [rows] = await pool.execute(
    `SELECT id FROM graphic_design_assets
     WHERE id = ? AND owner_user_id = ? LIMIT 1`,
    [assetId, userId],
  );
  return Boolean(rows[0]);
}

async function saveContentRevision(pool, content, userId, action) {
  const snapshot = {
    id: content.id,
    type: content.type,
    title: content.title,
    description: content.description,
    alt_text: content.alt_text,
    asset_id: content.asset_id,
    is_deleted: Boolean(content.is_deleted),
  };
  await pool.execute(
    `INSERT INTO graphic_design_content_revisions
     (content_id, owner_user_id, action, snapshot)
     VALUES (?, ?, ?, ?)`,
    [content.id, userId, action, JSON.stringify(snapshot)],
  );
}

function safeOriginalFilename(value) {
  const name = typeof value === "string" ? path.basename(value.replace(/\\/g, "/")) : "";
  const safe = name
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return safe || "design-image";
}

function isJpeg(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isPng(buffer) {
  return (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  );
}

function isWebp(buffer) {
  return (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  );
}

function extensionFor(mediaType) {
  return mediaType === "image/webp" ? "webp" : "bin";
}

async function convertToWebp(input, quality) {
  const image = sharp(input, {
    failOn: "error",
    limitInputPixels: MAX_IMAGE_PIXELS,
    sequentialRead: true,
  });
  const metadata = await image.metadata();
  const { width, height } = metadata;

  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS ||
    (metadata.pages ?? 1) > 1
  ) {
    throw new ImageLimitError("The image dimensions exceed the supported limits.");
  }

  return image
    .rotate()
    .webp({ quality, effort: 4, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });
}

function parseWebpQuality(value) {
  if (value === undefined) {
    return 80;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error("GRAPHIC_DESIGN_WEBP_QUALITY must be an integer from 1 to 100.");
  }
  const quality = Number(value);
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new Error("GRAPHIC_DESIGN_WEBP_QUALITY must be an integer from 1 to 100.");
  }
  return quality;
}

class ImageLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImageLimitError";
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function invalidData(response, error) {
  return response.status(400).json({
    error: "Invalid request data",
    issues: error.issues.map((issue) => ({
      path: issue.path,
      message: issue.message,
    })),
  });
}

module.exports = {
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  createGraphicDesignRouter,
  safeOriginalFilename,
};
