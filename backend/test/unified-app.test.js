const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const session = require("express-session");
const { after, before, describe, it } = require("node:test");
const { createApp } = require("../src/app");

const config = {
  environment: "test",
  sessionSecret: "test-only-session-secret-with-more-than-32-characters",
  corsOrigins: ["http://localhost:3000"],
};
const state = { maintenanceMode: 0 };
const pool = {
  async execute() {
    return [[{ setting_value: String(state.maintenanceMode), updated_at: "2026-10-23T07:00:00.000Z" }], []];
  },
};
let rootDirectory;
let siteDirectory;
let frontendDirectory;
let server;
let baseUrl;

function requestWithHost(pathname, host, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port: server.address().port,
      path: pathname,
      headers: { ...headers, Host: host },
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response));
    });
    request.once("error", reject);
    request.end();
  });
}

before(async () => {
  rootDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fetman-unified-app-test-"));
  siteDirectory = path.join(rootDirectory, "site");
  frontendDirectory = path.join(rootDirectory, "frontend");
  await fs.mkdir(siteDirectory, { recursive: true });
  await fs.mkdir(path.join(frontendDirectory, "assets"), { recursive: true });
  await fs.writeFile(path.join(siteDirectory, "index.html"), "public home");
  await fs.writeFile(path.join(siteDirectory, "maintenance.html"), "public maintenance");
  await fs.writeFile(path.join(frontendDirectory, "index.html"), "management app");
  await fs.writeFile(path.join(frontendDirectory, "assets", "app.js"), "management asset");

  const app = createApp(config, {
    pool,
    sessionStore: new session.MemoryStore(),
    publicSiteDirectory: siteDirectory,
    managementFrontendDirectory: frontendDirectory,
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await fs.rm(rootDirectory, { recursive: true, force: true });
});

describe("single-server production routing", () => {
  it("sets noindex headers for non-production hosts across response types", async () => {
    const host = `staging.fetmandigital.com:${server.address().port}`;
    for (const path of ["/", "/login", "/assets/app.js", "/api/does-not-exist", "/does-not-exist"]) {
      const response = await requestWithHost(path, host);
      assert.equal(response.headers["x-robots-tag"], "noindex, nofollow, noarchive", path);
    }
  });

  it("keeps production hosts indexable and does not trust forwarded host overrides", async () => {
    for (const hostname of ["fetmandigital.com", "www.fetmandigital.com"]) {
      const productionHost = `${hostname}:${server.address().port}`;
      for (const path of ["/", "/login", "/assets/app.js", "/api/does-not-exist", "/does-not-exist"]) {
        const response = await requestWithHost(path, productionHost);
        assert.equal(Object.hasOwn(response.headers, "x-robots-tag"), false, `${hostname}${path}`);
      }
    }

    const forwardedHostResponse = await requestWithHost(
      "/",
      `fetmandigital.com:${server.address().port}`,
      { "X-Forwarded-Host": "staging.fetmandigital.com" },
    );
    assert.equal(Object.hasOwn(forwardedHostResponse.headers, "x-robots-tag"), false);
  });

  it("serves the management shell for direct portal navigation and refresh", async () => {
    for (const route of [
      "/login",
      "/set-password",
      "/developer",
      "/developer/maintenance",
    ]) {
      const response = await fetch(`${baseUrl}${route}`);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "management app");
    }
  });

  it("keeps API misses as JSON and serves frontend assets from the same origin", async () => {
    const apiResponse = await fetch(`${baseUrl}/api/does-not-exist`);
    assert.equal(apiResponse.status, 404);
    assert.deepEqual(await apiResponse.json(), { error: "Not found" });

    const assetResponse = await fetch(`${baseUrl}/assets/app.js`);
    assert.equal(assetResponse.status, 200);
    assert.equal(await assetResponse.text(), "management asset");
  });

  it("keeps public maintenance enforcement separate from the management shell", async () => {
    state.maintenanceMode = 1;
    const publicResponse = await fetch(`${baseUrl}/`);
    const portalResponse = await fetch(`${baseUrl}/login`);

    assert.equal(publicResponse.status, 503);
    assert.equal(await publicResponse.text(), "public maintenance");
    assert.equal(portalResponse.status, 200);
    assert.equal(await portalResponse.text(), "management app");
    state.maintenanceMode = 0;
  });
});
