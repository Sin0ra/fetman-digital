const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");
const { createPublicSiteApp } = require("../src/public-site");

const state = { maintenanceMode: 0, unavailable: false };
const privateUploadDirectory = path.resolve(
  __dirname,
  "../secure-uploads/design",
);
const pool = {
  async execute() {
    if (state.unavailable) {
      throw new Error("database unavailable");
    }
    return [[{
      maintenance_mode: state.maintenanceMode,
      version: 0,
      updated_at: "2026-10-23T07:00:00.000Z",
    }], []];
  },
};

let server;
let baseUrl;

before(async () => {
  server = createPublicSiteApp({ pool }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("public site maintenance enforcement", () => {
  it("serves the normal homepage while maintenance mode is OFF", async () => {
    state.maintenanceMode = 0;
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Fetman Digital/);
    assert.match(html, /Our Work/);
  });

  it("serves only the branded maintenance page for every public path while ON", async () => {
    state.maintenanceMode = 1;
    const homepage = await fetch(`${baseUrl}/`);
    const assetPath = await fetch(`${baseUrl}/public-portfolio.js`);
    const html = await homepage.text();

    assert.equal(homepage.status, 503);
    assert.equal(homepage.headers.get("cache-control"), "no-store");
    assert.equal(homepage.headers.get("retry-after"), "300");
    assert.match(html, /We’re making/);
    assert.doesNotMatch(html, /Our Work|Kwenzekile Solutions/);
    assert.equal(assetPath.status, 503);
    assert.match(await assetPath.text(), /We’re making/);
  });

  it("does not expose management source paths through the public static server", async () => {
    state.maintenanceMode = 0;
    const source = await fetch(`${baseUrl}/backend/src/server.js`);
    const dependencies = await fetch(`${baseUrl}/management-frontend/package.json`);
    assert.equal(source.status, 404);
    assert.equal(dependencies.status, 404);
  });

  it("does not serve private design uploads through encoded or normalized paths", async () => {
    state.maintenanceMode = 0;
    const entries = await fs.readdir(privateUploadDirectory, {
      withFileTypes: true,
    });
    const upload = entries.find((entry) => entry.isFile());
    assert.ok(upload, "expected a private design upload for this regression test");

    for (const separator of ["%2F", "%5C"]) {
      const encodedPath =
        `/backend${separator}secure-uploads${separator}design${separator}` +
        encodeURIComponent(upload.name);
      const encodedResponse = await fetch(`${baseUrl}${encodedPath}`);
      assert.equal(encodedResponse.status, 404);
    }

    const normalizedPath = `/public/../backend/secure-uploads/design/${upload.name}`;
    const normalizedResponse = await new Promise((resolve, reject) => {
      const request = http.get(
        {
          hostname: "127.0.0.1",
          port: server.address().port,
          path: normalizedPath,
        },
        resolve,
      );
      request.once("error", reject);
    });
    normalizedResponse.resume();
    assert.equal(normalizedResponse.statusCode, 404);
  });

  it("fails closed with the public maintenance page when the saved state cannot be read", async () => {
    state.unavailable = true;
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      const response = await fetch(`${baseUrl}/`);
      assert.equal(response.status, 503);
      assert.match(await response.text(), /We’re making/);
    } finally {
      state.unavailable = false;
      state.maintenanceMode = 0;
      console.error = originalConsoleError;
    }
  });
});
