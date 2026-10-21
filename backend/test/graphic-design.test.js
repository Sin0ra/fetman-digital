const assert = require("node:assert/strict");
const argon2 = require("argon2");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const session = require("express-session");
const { after, before, describe, it } = require("node:test");
const { createApp } = require("../src/app");

const testPassword = "test-only-password-for-graphic-design";
const config = {
  environment: "test",
  sessionSecret: "test-only-session-secret-with-more-than-32-characters",
  corsOrigins: ["http://localhost:5173"],
};
const database = {
  users: [],
  tasks: [],
  taskUpdates: [],
  assets: [],
  content: [],
  revisions: [],
  nextTaskId: 1,
  nextUpdateId: 1,
  nextAssetId: 1,
  failAssetInsert: false,
  nextContentId: 1,
  nextRevisionId: 1,
};
let server;
let baseUrl;
let assetDirectory;

function createPool() {
  return {
    async getConnection() {
      return {
        execute: this.execute.bind(this),
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
      };
    },
    async execute(sql, parameters = []) {
      const statement = sql.replace(/\s+/g, " ").trim();

      if (statement.includes("FROM management_users WHERE email = ?")) {
        return [
          database.users.filter((user) => user.email === parameters[0]),
          [],
        ];
      }
      if (statement.includes("FROM management_users WHERE id = ?")) {
        return [
          database.users.filter((user) => user.id === parameters[0]),
          [],
        ];
      }

      if (statement.startsWith("INSERT INTO graphic_design_tasks")) {
        const task = {
          id: database.nextTaskId++,
          assigned_user_id: parameters[0],
          title: parameters[1],
          description: parameters[2],
          deadline: parameters[3],
          status: "Pending",
        };
        database.tasks.push(task);
        return [{ insertId: task.id, affectedRows: 1 }, []];
      }
      if (statement.startsWith("UPDATE graphic_design_tasks SET status")) {
        const task = database.tasks.find(
          (item) =>
            String(item.id) === String(parameters[1]) &&
            item.assigned_user_id === parameters[2],
        );
        if (!task) return [{ affectedRows: 0 }, []];
        task.status = parameters[0];
        return [{ affectedRows: 1 }, []];
      }
      if (
        statement.includes("FROM graphic_design_tasks") &&
        statement.includes("WHERE assigned_user_id = ?") &&
        !statement.includes("WHERE id = ?")
      ) {
        return [
          database.tasks
            .filter((item) => item.assigned_user_id === parameters[0])
            .map((item) => ({ ...item })),
          [],
        ];
      }
      if (statement.startsWith("SELECT id, title, description, deadline, status")) {
        const task = database.tasks.find(
          (item) =>
            String(item.id) === String(parameters[0]) &&
            item.assigned_user_id === parameters[1],
        );
        return [task ? [{ ...task }] : [], []];
      }
      if (statement.startsWith("SELECT id FROM graphic_design_tasks")) {
        const task = database.tasks.find(
          (item) =>
            String(item.id) === String(parameters[0]) &&
            item.assigned_user_id === parameters[1],
        );
        return [task ? [{ id: task.id }] : [], []];
      }
      if (statement.startsWith("INSERT INTO graphic_design_task_updates")) {
        const update = {
          id: database.nextUpdateId++,
          task_id: parameters[0],
          user_id: parameters[1],
          status: parameters[2],
          note: parameters[3],
        };
        database.taskUpdates.push(update);
        return [{ insertId: update.id, affectedRows: 1 }, []];
      }
      if (statement.includes("FROM graphic_design_task_updates")) {
        return [
          database.taskUpdates
            .filter(
              (item) =>
                String(item.task_id) === String(parameters[0]) &&
                item.user_id === parameters[1],
            )
            .map((item) => ({ ...item })),
          [],
        ];
      }

      if (
        statement.includes("FROM graphic_design_assets") &&
        statement.includes("WHERE owner_user_id = ?")
      ) {
        return [
          database.assets
            .filter((item) => item.owner_user_id === parameters[0])
            .map((item) => ({ ...item })),
          [],
        ];
      }
      if (statement.startsWith("INSERT INTO graphic_design_assets")) {
        if (database.failAssetInsert) {
          throw new Error("test database insertion failure");
        }
        const asset = {
          id: database.nextAssetId++,
          owner_user_id: parameters[0],
          task_id: parameters[1],
          storage_name: parameters[2],
          original_name: parameters[3],
          media_type: parameters[4],
          byte_size: parameters[5],
        };
        database.assets.push(asset);
        return [{ insertId: asset.id, affectedRows: 1 }, []];
      }
      if (statement.includes("FROM graphic_design_assets") && statement.includes("WHERE id = ?")) {
        const asset = database.assets.find(
          (item) =>
            String(item.id) === String(parameters[0]) &&
            item.owner_user_id === parameters[1],
        );
        if (!asset) return [[], []];
        return [
          [
            statement.startsWith("SELECT id FROM")
              ? { id: asset.id }
              : { storage_name: asset.storage_name, media_type: asset.media_type },
          ],
          [],
        ];
      }

      if (statement.startsWith("INSERT INTO graphic_design_content_revisions")) {
        const revision = {
          id: database.nextRevisionId++,
          content_id: parameters[0],
          owner_user_id: parameters[1],
          action: parameters[2],
          snapshot: JSON.parse(parameters[3]),
        };
        database.revisions.push(revision);
        return [{ insertId: revision.id, affectedRows: 1 }, []];
      }
      if (statement.startsWith("INSERT INTO graphic_design_content")) {
        const item = {
          id: database.nextContentId++,
          owner_user_id: parameters[0],
          type: parameters[1],
          title: parameters[2],
          description: parameters[3],
          alt_text: parameters[4],
          asset_id: parameters[5],
          category: parameters[6],
          tags: JSON.parse(parameters[7]),
          display_order: parameters[8],
          publication_status: "draft",
          source_key: null,
          legacy_image_url: null,
          is_deleted: false,
        };
        database.content.push(item);
        return [{ insertId: item.id, affectedRows: 1 }, []];
      }
      if (statement.startsWith("SELECT COUNT(*) AS total FROM graphic_design_content")) {
        return [
          [{ total: database.content.filter((item) => item.type === "portfolio" && item.source_key).length }],
          [],
        ];
      }
      if (statement.includes("FROM graphic_design_content") && statement.includes("WHERE type = 'portfolio'")) {
        return [
          database.content
            .filter((item) => item.type === "portfolio" && item.publication_status === "published" && !item.is_deleted)
            .map((item) => ({ ...item })),
          [],
        ];
      }
      if (statement.includes("JOIN graphic_design_content c ON c.asset_id = a.id")) {
        const asset = database.assets.find((item) => String(item.id) === String(parameters[0]));
        const publishedReference = database.content.some(
          (item) => String(item.asset_id) === String(parameters[0]) && item.publication_status === "published" && !item.is_deleted,
        );
        return [asset && publishedReference ? [{ storage_name: asset.storage_name, media_type: asset.media_type }] : [], []];
      }
      if (statement.includes("FROM graphic_design_content") && statement.includes("WHERE is_deleted = 0 AND publication_status = 'published'")) {
        return [
          database.content
            .filter((item) => item.publication_status === "published" && !item.is_deleted)
            .map((item) => ({ ...item })),
          [],
        ];
      }
      if (statement.startsWith("UPDATE graphic_design_content SET is_deleted = 1")) {
        const item = database.content.find(
          (row) =>
            String(row.id) === String(parameters[0]) &&
            row.owner_user_id === parameters[1],
        );
        if (!item) return [{ affectedRows: 0 }, []];
        item.is_deleted = true;
        return [{ affectedRows: 1 }, []];
      }
      if (statement.startsWith("UPDATE graphic_design_content SET")) {
        const columns = statement.match(/^UPDATE graphic_design_content SET (.+) WHERE id/)[1]
          .split(", ")
          .map((assignment) => assignment.split(" = ")[0]);
        const item = database.content.find(
          (row) =>
            String(row.id) === String(parameters[columns.length]) &&
            row.owner_user_id === parameters[columns.length + 1] &&
            !row.is_deleted,
        );
        if (!item) return [{ affectedRows: 0 }, []];
        columns.forEach((column, index) => {
          const property = column === "asset_id" ? "asset_id" : column;
          item[property] = property === "tags" ? JSON.parse(parameters[index]) : parameters[index];
        });
        return [{ affectedRows: 1 }, []];
      }
      if (statement.includes("FROM graphic_design_content_revisions")) {
        return [
          database.revisions
            .filter(
              (item) =>
                String(item.content_id) === String(parameters[0]) &&
                item.owner_user_id === parameters[1],
            )
            .map((item) => ({ ...item })),
          [],
        ];
      }
      if (
        statement.includes("FROM graphic_design_content") &&
        statement.includes("owner_user_id = ? AND is_deleted = 0") &&
        !statement.includes("WHERE id = ?")
      ) {
        return [
          database.content
            .filter((item) => item.owner_user_id === parameters[0] && !item.is_deleted)
            .map((item) => ({ ...item })),
          [],
        ];
      }
      if (statement.includes("FROM graphic_design_content")) {
        const item = database.content.find(
          (row) =>
            String(row.id) === String(parameters[0]) &&
            row.owner_user_id === parameters[1] &&
            (statement.includes("is_deleted = 0") ? !row.is_deleted : true),
        );
        if (!item) return [[], []];
        if (statement.startsWith("SELECT id FROM")) {
          return [[{ id: item.id }], []];
        }
        return [
          [
            {
              id: item.id,
              type: item.type,
              title: item.title,
              description: item.description,
              alt_text: item.alt_text,
              asset_id: item.asset_id,
              category: item.category,
              tags: item.tags,
              display_order: item.display_order,
              publication_status: item.publication_status,
              source_key: item.source_key,
              legacy_image_url: item.legacy_image_url,
              is_deleted: item.is_deleted,
            },
          ],
          [],
        ];
      }
      throw new Error(`Unexpected test SQL: ${statement}`);
    },
  };
}

function getCookie(response) {
  const value = response.headers.get("set-cookie");
  return value ? value.split(";", 1)[0] : undefined;
}

async function createCsrfToken(cookie) {
  const response = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  return {
    cookie: getCookie(response) ?? cookie,
    token: (await response.json()).csrfToken,
  };
}

async function signIn(email) {
  const csrf = await createCsrfToken();
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      Cookie: csrf.cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf.token,
    },
    body: JSON.stringify({ email, password: testPassword }),
  });
  return { response, cookie: getCookie(response) };
}

async function jsonRequest(cookie, csrfToken, endpoint, method, body) {
  return fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createImage(format, options = {}) {
  const image = sharp({
    create: {
      width: options.width ?? 32,
      height: options.height ?? 24,
      channels: options.transparent ? 4 : 3,
      background: options.transparent
        ? { r: 230, g: 35, b: 20, alpha: 0.5 }
        : { r: 230, g: 35, b: 20 },
    },
  });
  if (format === "jpeg") return image.jpeg().toBuffer();
  if (format === "png") return image.png().toBuffer();
  return image.webp().toBuffer();
}

async function uploadImage(cookie, csrfToken, image, mediaType, name) {
  return fetch(`${baseUrl}/api/graphic-design/assets`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "X-CSRF-Token": csrfToken,
      "Content-Type": mediaType,
      "X-File-Name": name,
    },
    body: image,
  });
}

before(async () => {
  const hash = await argon2.hash(testPassword, { type: argon2.argon2id });
  database.users = [
    { id: 1, email: "developer@example.test", password_hash: hash, role: "Developer", is_active: 1 },
    { id: 2, email: "designer@example.test", password_hash: hash, role: "Graphic Design", is_active: 1 },
    { id: 3, email: "other@example.test", password_hash: hash, role: "Graphic Design", is_active: 1 },
  ];
  database.tasks = [
    { id: 90, assigned_user_id: 3, title: "Private other task", description: "", deadline: null, status: "Pending" },
  ];
  assetDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fetman-design-test-"));
  const app = createApp(config, {
    pool: createPool(),
    sessionStore: new session.MemoryStore(),
    designAssetDirectory: assetDirectory,
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  if (assetDirectory) {
    await fs.rm(assetDirectory, { recursive: true, force: true });
  }
});

describe("Graphic Design workspace", () => {
  it("authenticates a Graphic Designer and enforces department access and task ownership", async () => {
    const unauthenticatedResponse = await fetch(`${baseUrl}/api/graphic-design/tasks`);
    assert.equal(unauthenticatedResponse.status, 401);

    const { response: loginResponse, cookie } = await signIn("designer@example.test");
    assert.equal(loginResponse.status, 200);
    assert.deepEqual(await loginResponse.json(), {
      user: {
        id: "2",
        email: "designer@example.test",
        role: "Graphic Design",
        passwordChangeRequired: false,
      },
    });

    const tasksResponse = await fetch(`${baseUrl}/api/graphic-design/tasks`, {
      headers: { Cookie: cookie },
    });
    assert.equal(tasksResponse.status, 200);
    assert.deepEqual((await tasksResponse.json()).tasks, []);

    const developerResponse = await fetch(`${baseUrl}/api/developer/dashboard`, {
      headers: { Cookie: cookie },
    });
    assert.equal(developerResponse.status, 403);

    const csrf = await createCsrfToken(cookie);
    const taskResponse = await jsonRequest(
      csrf.cookie,
      csrf.token,
      "/api/graphic-design/tasks",
      "POST",
      { title: "Homepage campaign", description: "Create the summer banner.", deadline: "2026-11-01" },
    );
    assert.equal(taskResponse.status, 201);
    const task = (await taskResponse.json()).task;
    assert.equal(task.status, "Pending");
    assert.equal(task.title, "Homepage campaign");
    const assignedTasks = await fetch(`${baseUrl}/api/graphic-design/tasks`, {
      headers: { Cookie: csrf.cookie },
    });
    assert.deepEqual(
      (await assignedTasks.json()).tasks.map((item) => item.id),
      [task.id],
    );

    const statusResponse = await jsonRequest(
      csrf.cookie,
      csrf.token,
      `/api/graphic-design/tasks/${task.id}`,
      "PATCH",
      { status: "In Progress" },
    );
    assert.equal(statusResponse.status, 200);
    assert.equal((await statusResponse.json()).task.status, "In Progress");

    const noteResponse = await jsonRequest(
      csrf.cookie,
      csrf.token,
      `/api/graphic-design/tasks/${task.id}/updates`,
      "POST",
      { note: "First banner concept ready for review." },
    );
    assert.equal(noteResponse.status, 201);
    const updatesResponse = await fetch(
      `${baseUrl}/api/graphic-design/tasks/${task.id}/updates`,
      { headers: { Cookie: csrf.cookie } },
    );
    assert.equal((await updatesResponse.json()).updates.length, 2);

    const foreignTaskResponse = await jsonRequest(
      csrf.cookie,
      csrf.token,
      "/api/graphic-design/tasks/90",
      "PATCH",
      { status: "Completed" },
    );
    assert.equal(foreignTaskResponse.status, 404);

    const noCsrfResponse = await jsonRequest(
      csrf.cookie,
      undefined,
      "/api/graphic-design/tasks",
      "POST",
      { title: "Blocked task" },
    );
    assert.equal(noCsrfResponse.status, 403);
  });

  it("denies Developer accounts from Graphic Design endpoints", async () => {
    const { response: loginResponse, cookie } = await signIn("developer@example.test");
    assert.equal(loginResponse.status, 200);
    const response = await fetch(`${baseUrl}/api/graphic-design/content`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 403);
  });

  it("converts each supported image format to private WebP while preserving alpha", async () => {
    const designer = await signIn("designer@example.test");
    const csrf = await createCsrfToken(designer.cookie);
    const cases = [
      { input: "jpeg", mediaType: "image/jpeg", name: "photo.jpeg", transparent: false },
      { input: "png", mediaType: "image/png", name: "../alpha.png", transparent: true },
      { input: "webp", mediaType: "image/webp", name: "already.webp", transparent: false },
    ];
    let transparentOutput;

    for (const testCase of cases) {
      const input = await createImage(testCase.input, { transparent: testCase.transparent });
      const uploadResponse = await uploadImage(
        csrf.cookie,
        csrf.token,
        input,
        testCase.mediaType,
        testCase.name,
      );
      assert.equal(uploadResponse.status, 201);
      const resultAsset = (await uploadResponse.json()).asset;
      assert.equal(resultAsset.media_type, "image/webp");
      assert.equal(
        resultAsset.original_name,
        testCase.name.startsWith("../") ? "alpha.png" : testCase.name,
      );

      const storedAsset = database.assets.find(
        (asset) => String(asset.id) === String(resultAsset.id),
      );
      assert.match(storedAsset.storage_name, /^[0-9a-f-]{36}\.webp$/i);
      assert.equal(storedAsset.media_type, "image/webp");
      const storedFile = await fs.readFile(path.join(assetDirectory, storedAsset.storage_name));
      assert.equal(storedAsset.byte_size, storedFile.length);
      assert.equal(resultAsset.byte_size, storedFile.length);
      const metadata = await sharp(storedFile).metadata();
      assert.equal(metadata.format, "webp");

      const preview = await fetch(`${baseUrl}${resultAsset.previewUrl}`, {
        headers: { Cookie: designer.cookie },
      });
      assert.equal(preview.status, 200);
      assert.equal(preview.headers.get("content-type"), "image/webp");
      assert.equal(preview.headers.get("x-content-type-options"), "nosniff");
      assert.equal(preview.headers.get("cache-control"), "private, no-store");
      const previewBytes = Buffer.from(await preview.arrayBuffer());
      assert.equal((await sharp(previewBytes).metadata()).format, "webp");
      assert.deepEqual(previewBytes, storedFile);
      if (testCase.transparent) transparentOutput = previewBytes;
    }

    assert.equal((await sharp(transparentOutput).metadata()).hasAlpha, true);

    const other = await signIn("other@example.test");
    const foreignAsset = database.assets.at(-1);
    const deniedPreview = await fetch(
      `${baseUrl}/api/graphic-design/assets/${foreignAsset.id}/preview`,
      {
        headers: { Cookie: other.cookie },
      },
    );
    assert.equal(deniedPreview.status, 404);
  });

  it("rejects mismatched MIME/signatures, corrupt images, and excessive dimensions", async () => {
    const designer = await signIn("designer@example.test");
    const csrf = await createCsrfToken(designer.cookie);
    const png = await createImage("png");

    const mismatch = await uploadImage(
      csrf.cookie,
      csrf.token,
      png,
      "image/jpeg",
      "mismatch.jpg",
    );
    assert.equal(mismatch.status, 415);

    const corrupt = await uploadImage(
      csrf.cookie,
      csrf.token,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
      "image/png",
      "corrupt.png",
    );
    assert.equal(corrupt.status, 415);

    const huge = await createImage("png", { width: 7000, height: 6000 });
    const tooManyPixels = await uploadImage(
      csrf.cookie,
      csrf.token,
      huge,
      "image/png",
      "huge.png",
    );
    assert.equal(tooManyPixels.status, 413);

    const tooWide = await createImage("png", { width: 12_001, height: 1 });
    const excessiveDimension = await uploadImage(
      csrf.cookie,
      csrf.token,
      tooWide,
      "image/png",
      "wide.png",
    );
    assert.equal(excessiveDimension.status, 413);
  });

  it("rejects oversized uploads and removes converted files after database failure", async () => {
    const designer = await signIn("designer@example.test");
    const csrf = await createCsrfToken(designer.cookie);
    const oversizedUpload = await fetch(`${baseUrl}/api/graphic-design/assets`, {
      method: "POST",
      headers: {
        Cookie: csrf.cookie,
        "X-CSRF-Token": csrf.token,
        "Content-Type": "image/png",
      },
      body: Buffer.alloc(5 * 1024 * 1024 + 1),
    });
    assert.equal(oversizedUpload.status, 413);

    const input = await createImage("jpeg");
    const filesBefore = await fs.readdir(assetDirectory);
    database.failAssetInsert = true;
    const failedInsert = await uploadImage(
      csrf.cookie,
      csrf.token,
      input,
      "image/jpeg",
      "failed.jpg",
    );
    database.failAssetInsert = false;
    assert.equal(failedInsert.status, 500);
    assert.deepEqual(await fs.readdir(assetDirectory), filesBefore);
  });

  it("saves, previews, versions, and confirms removal of private content drafts", async () => {
    const { cookie } = await signIn("designer@example.test");
    const csrf = await createCsrfToken(cookie);
    const asset = database.assets[0];
    const createResponse = await jsonRequest(
      csrf.cookie,
      csrf.token,
      "/api/graphic-design/content",
      "POST",
      {
        type: "portfolio",
        title: '<script>alert("x")</script>',
        description: "Portfolio draft description.",
        altText: "Campaign artwork",
        assetId: String(asset.id),
      },
    );
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()).content;
    const draftsResponse = await fetch(`${baseUrl}/api/graphic-design/content`, {
      headers: { Cookie: cookie },
    });
    assert.equal((await draftsResponse.json()).content.length, 1);
    const otherDesigner = await signIn("other@example.test");
    const privateContentResponse = await fetch(
      `${baseUrl}/api/graphic-design/content/${created.id}/preview`,
      { headers: { Cookie: otherDesigner.cookie } },
    );
    assert.equal(privateContentResponse.status, 404);

    const preview = await fetch(
      `${baseUrl}/api/graphic-design/content/${created.id}/preview`,
      { headers: { Cookie: cookie } },
    );
    const html = await preview.text();
    assert.equal(preview.status, 200);
    assert.match(html, /Private draft preview/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>alert/);

    const updateResponse = await jsonRequest(
      csrf.cookie,
      csrf.token,
      `/api/graphic-design/content/${created.id}`,
      "PATCH",
      { title: "Updated campaign title" },
    );
    assert.equal(updateResponse.status, 200);
    const updatedContent = (await updateResponse.json()).content;
    assert.equal(updatedContent.title, "Updated campaign title");
    assert.equal(updatedContent.asset_id, String(asset.id));

    const noConfirmation = await jsonRequest(
      csrf.cookie,
      csrf.token,
      `/api/graphic-design/content/${created.id}`,
      "DELETE",
      { confirm: false },
    );
    assert.equal(noConfirmation.status, 400);
    const deleteResponse = await jsonRequest(
      csrf.cookie,
      csrf.token,
      `/api/graphic-design/content/${created.id}`,
      "DELETE",
      { confirm: true },
    );
    assert.equal(deleteResponse.status, 204);
    assert.deepEqual(
      database.revisions.map((revision) => revision.action),
      ["created", "updated", "deleted"],
    );

    const revisionsResponse = await fetch(
      `${baseUrl}/api/graphic-design/content/${created.id}/revisions`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(revisionsResponse.status, 200);
    assert.equal((await revisionsResponse.json()).revisions.length, 3);
    const deletedPreview = await fetch(
      `${baseUrl}/api/graphic-design/content/${created.id}/preview`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(deletedPreview.status, 404);
  });

  it("keeps drafts private and publishes or unpublishes only authorized content", async () => {
    const { cookie } = await signIn("designer@example.test");
    const csrf = await createCsrfToken(cookie);
    const createResponse = await jsonRequest(
      csrf.cookie,
      csrf.token,
      "/api/graphic-design/content",
      "POST",
      {
        type: "portfolio",
        title: "Test campaign",
        description: "A test portfolio project.",
        altText: "Campaign artwork",
        assetId: String(database.assets[0].id),
        category: "branding",
        tags: ["campaign", "test"],
        displayOrder: 25,
      },
    );
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()).content;

    const beforePublish = await fetch(`${baseUrl}/api/public/design-portfolio`);
    assert.equal(beforePublish.status, 200);
    assert.deepEqual((await beforePublish.json()).projects, []);

    const otherDesigner = await signIn("other@example.test");
    const forbiddenPublish = await jsonRequest(
      otherDesigner.cookie,
      (await createCsrfToken(otherDesigner.cookie)).token,
      `/api/graphic-design/content/${created.id}/publish`,
      "POST",
    );
    assert.equal(forbiddenPublish.status, 404);

    const published = await jsonRequest(
      csrf.cookie,
      csrf.token,
      `/api/graphic-design/content/${created.id}/publish`,
      "POST",
    );
    assert.equal(published.status, 200);
    assert.equal((await published.json()).content.publication_status, "published");
    const publicProjects = await (await fetch(`${baseUrl}/api/public/design-portfolio`)).json();
    assert.equal(publicProjects.projects.length, 1);
    assert.equal(publicProjects.projects[0].title, "Test campaign");
    assert.equal(publicProjects.projects[0].category, "branding");
    assert.deepEqual(publicProjects.projects[0].tags, ["campaign", "test"]);
    const publicDesignContent = await (await fetch(`${baseUrl}/api/public/design-content`)).json();
    assert.equal(publicDesignContent.content.length, 1);
    const publicImage = await fetch(`${baseUrl}/api/public/design-assets/${database.assets[0].id}`);
    assert.equal(publicImage.status, 200);
    assert.equal(publicImage.headers.get("content-type"), "image/webp");

    const unpublished = await jsonRequest(
      csrf.cookie,
      csrf.token,
      `/api/graphic-design/content/${created.id}/unpublish`,
      "POST",
    );
    assert.equal(unpublished.status, 200);
    assert.equal((await unpublished.json()).content.publication_status, "draft");
    assert.deepEqual(
      (await (await fetch(`${baseUrl}/api/public/design-portfolio`)).json()).projects,
      [],
    );
    assert.equal(
      (await fetch(`${baseUrl}/api/public/design-assets/${database.assets[0].id}`)).status,
      404,
    );
    assert.equal(database.content.find((item) => item.id === created.id).is_deleted, false);
  });
});
