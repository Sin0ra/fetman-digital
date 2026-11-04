const express = require("express");
const path = require("node:path");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { sendEnquiry } = require("../smtp");

const enquirySchema = z.object({ fullName: z.string().trim().min(2).max(160), email: z.string().trim().email().max(254), service: z.string().trim().min(1).max(120), message: z.string().trim().min(10).max(5000), website: z.string().max(0).optional().default("") }).strict();

function createPublicRouter({ pool, smtp, recipient, mediaDirectory }) {
  const router = express.Router();
  const enquiryLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many enquiries. Please try again later." } });
  router.get("/site-content", async (_request, response, next) => { try { const [rows] = await pool.execute("SELECT setting_value FROM site_settings WHERE setting_key = 'site_content' LIMIT 1"); return response.json({ content: JSON.parse(rows[0]?.setting_value || "{}") }); } catch (error) { return next(error); } });
  router.get("/portfolio", async (request, response, next) => { try { const requestedDepartment = typeof request.query.department === "string" ? request.query.department : null; const departmentFilter = requestedDepartment === "Graphic Design" || requestedDepartment === "IT" ? " AND p.department = ?" : requestedDepartment === "unclassified" ? " AND p.department IS NULL" : ""; const values = departmentFilter === " AND p.department = ?" ? [requestedDepartment] : []; const [rows] = await pool.execute(`SELECT p.id, p.title, p.description, p.department, p.category, p.image_url AS imageUrl, p.project_url AS projectUrl, m.id AS imageAssetId FROM portfolio_projects p LEFT JOIN media_assets m ON m.id = p.image_asset_id WHERE p.published = 1${departmentFilter} ORDER BY p.display_order, p.id`, values); return response.json({ projects: rows.map((row) => ({ id: String(row.id), title: row.title, description: row.description, department: row.department, category: row.category, imageUrl: row.imageAssetId ? `/api/public/media/${row.imageAssetId}` : safeHttpUrl(row.imageUrl), projectUrl: safeHttpUrl(row.projectUrl) })) }); } catch (error) { return next(error); } });
  router.get("/media/:id", async (request, response, next) => { if (!/^\d+$/.test(request.params.id)) return response.status(400).end(); try { const [rows] = await pool.execute("SELECT m.storage_name AS storageName FROM media_assets m JOIN portfolio_projects p ON p.image_asset_id = m.id WHERE m.id = ? AND p.published = 1 LIMIT 1", [request.params.id]); if (!rows[0]) return response.status(404).end(); response.set({ "Content-Type": "image/webp", "Content-Disposition": 'inline; filename="project.webp"', "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" }); return response.sendFile(path.join(mediaDirectory, path.basename(rows[0].storageName))); } catch (error) { return next(error); } });
  router.post("/enquiries", enquiryLimit, async (request, response, next) => {
    const parsed = enquirySchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Please complete all enquiry fields correctly." });
    if (parsed.data.website) return response.status(400).json({ error: "Unable to send enquiry." });
    try {
      await pool.execute("INSERT INTO enquiries (full_name, email, service, message) VALUES (?, ?, ?, ?)", [parsed.data.fullName, parsed.data.email, parsed.data.service, parsed.data.message]);
      if (!smtp.host) return response.status(503).json({ error: "Enquiry saved, but email delivery is not configured yet." });
      await sendEnquiry(smtp, recipient, parsed.data);
      return response.status(202).json({ message: "Your enquiry was sent successfully." });
    } catch (error) { return next(error); }
  });
  return router;
}
function safeHttpUrl(value) { try { const parsed = new URL(value); return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null; } catch { return null; } }
module.exports = { createPublicRouter };
