const path = require("node:path");
const fs = require("node:fs/promises");
const { randomBytes } = require("node:crypto");
const express = require("express");
const { readMaintenanceMode, safeErrorCode } = require("./maintenance-mode");

const DEFAULT_SITE_DIRECTORY = path.resolve(__dirname, "../..");
const PUBLIC_FILES = new Set([
  "index.html",
  "maintenance.html",
  "public-portfolio.js",
  "Fetman Digital website background-optimized-1920.jpg",
  "Fetman Digital website background-optimized-960.jpg",
  "Fetman Digital website background.jpg",
  "fetman digital 2023 black.png",
]);

function createPublicSiteApp({ pool, siteDirectory = DEFAULT_SITE_DIRECTORY }) {
  const app = express();

  app.disable("x-powered-by");
  app.use((request, response, next) => {
    const decodedPath = decodeRequestPath(request.path);
    const firstSegment = decodedPath
      .split(/[\\/]+/)
      .filter(Boolean)[0]
      ?.toLowerCase();
    const requestedFile = path.resolve(siteDirectory, `.${decodedPath}`);
    const privateUploadDirectory = path.resolve(
      siteDirectory,
      "backend",
      "secure-uploads",
    );

    if (
      isWithinDirectory(privateUploadDirectory, requestedFile) ||
      (firstSegment &&
        (firstSegment.startsWith(".") ||
          ["backend", "management-frontend", "node_modules"].includes(
            firstSegment,
          )))
    ) {
      return response.status(404).send("Not found");
    }
    return next();
  });
  app.use(async (_request, response, next) => {
    let setting;
    try {
      setting = await readMaintenanceMode(pool);
    } catch (error) {
      console.error("Public site maintenance state is unavailable", {
        errorCode: safeErrorCode(error),
      });
      return sendMaintenancePage(response, siteDirectory);
    }

    if (setting.maintenanceMode) {
      return sendMaintenancePage(response, siteDirectory);
    }
    return next();
  });

  app.get("*splat", async (request, response, next) => {
    const requestedPath = decodeRequestPath(request.path).replace(/^\/+|\/+$/g, "");
    const fileName = requestedPath || "index.html";
    if (fileName.includes("/") || !PUBLIC_FILES.has(fileName)) return next();
    try {
      const contents = await fs.readFile(path.join(siteDirectory, fileName));
      if (/\.html?$/i.test(fileName)) {
        response.setHeader("Cache-Control", "no-cache");
        return response.type("html").send(addNonce(contents.toString(), response.locals.cspNonce));
      }
      if (/\.js$/i.test(fileName)) response.setHeader("Cache-Control", "no-cache");
      return response.sendFile(path.join(siteDirectory, fileName));
    } catch (error) {
      return next(error.code === "ENOENT" ? undefined : error);
    }
  });
  app.use((_request, response) => response.status(404).send("Not found"));

  return app;
}

function decodeRequestPath(requestPath) {
  let decodedPath = requestPath;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    try {
      const nextPath = decodeURIComponent(decodedPath);
      if (nextPath === decodedPath) {
        break;
      }
      decodedPath = nextPath;
    } catch {
      break;
    }
  }
  return decodedPath;
}

function isWithinDirectory(directory, target) {
  const relativePath = path.relative(directory, target);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

function sendMaintenancePage(response, siteDirectory) {
  response.set({ "Cache-Control": "no-store", "Retry-After": "300" });
  if (!response.getHeader("X-Robots-Tag")) response.setHeader("X-Robots-Tag", "noindex, nofollow");
  return fs.readFile(path.join(siteDirectory, "maintenance.html"))
    .then((contents) => response.status(503).type("html").send(addNonce(contents.toString(), response.locals.cspNonce)));
}

function addNonce(html, nonce = randomBytes(16).toString("base64")) {
  return html.replace(/<(script|style)(\s|>)/gi, `<$1 nonce="${nonce}"$2`);
}

module.exports = { createPublicSiteApp };
