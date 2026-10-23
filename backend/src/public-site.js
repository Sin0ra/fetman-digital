const path = require("node:path");
const express = require("express");
const { readMaintenanceMode, safeErrorCode } = require("./maintenance-mode");

const DEFAULT_SITE_DIRECTORY = path.resolve(__dirname, "../..");

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

  app.use(
    express.static(siteDirectory, {
      index: "index.html",
      setHeaders(response, filePath) {
        if (/\.(?:html?|js)$/i.test(filePath)) {
          response.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );
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
  response.set({
    "Cache-Control": "no-store",
    "Retry-After": "300",
    "X-Robots-Tag": "noindex, nofollow",
  });
  return response.status(503).sendFile(path.join(siteDirectory, "maintenance.html"));
}

module.exports = { createPublicSiteApp };
