const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { Runtime, secretAt } = require("../runtime.cjs");
const { backupData } = require("../backup.cjs");
const resources = path.resolve(__dirname, "../staged");
async function temp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "Albertelli test à "));
}
test("chiave locale stabile e privata", async () => {
  const dir = await temp();
  try {
    const file = path.join(dir, "desktop-key");
    const a = await secretAt(file);
    assert.match(a, /^[a-f0-9]{64}$/);
    assert.equal(await secretAt(file), a);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("backup consistente con hash e rifiuto destinazioni ricorsive", async () => {
  const dir = await temp();
  try {
    const data = path.join(dir, "data");
    await fs.mkdir(path.join(data, "assets"), { recursive: true });
    await fs.writeFile(path.join(data, "studio.db"), "demo-db");
    await fs.writeFile(path.join(data, "assets", "sample.png"), "image");
    await assert.rejects(backupData(data, data));
    const backup = await backupData(data, dir);
    const m = JSON.parse(
      await fs.readFile(path.join(backup, "backup-manifest.json"), "utf8"),
    );
    assert.equal(m.files.length, 2);
    for (const f of m.files) {
      const content = await fs.readFile(path.join(backup, f.path));
      assert.equal(
        crypto.createHash("sha256").update(content).digest("hex"),
        f.sha256,
      );
    }
    assert.equal(
      await fs.readFile(path.join(data, "studio.db"), "utf8"),
      "demo-db",
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("avvio fallito rilascia i componenti e mantiene i dati", async () => {
  const dir = await temp();
  const runtime = new Runtime({
    resources: path.join(dir, "missing"),
    dataDir: path.join(dir, "data"),
    logsDir: path.join(dir, "logs"),
  });
  try {
    await assert.rejects(runtime.start());
    assert.equal(runtime.children.length, 0);
    assert.match(
      await fs.readFile(path.join(dir, "data", "desktop-key"), "utf8"),
      /^[a-f0-9]{64}$/,
    );
  } finally {
    await runtime.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test(
  "payload reale: accesso locale, uscita/rientro, progetto, riavvio e backup ripristinabile",
  { timeout: 120000 },
  async (t) => {
    try {
      await fs.access(path.join(resources, "web", "server.js"));
    } catch (e) {
      if (process.env.STUDIO_REQUIRE_PAYLOAD === "1") throw e;
      t.skip(
        "Eseguire build API, build standalone e stage prima del test di integrazione",
      );
      return;
    }
    const dir = await temp();
    const runtime = new Runtime({
      resources,
      dataDir: path.join(dir, "Dati locali"),
      logsDir: path.join(dir, "logs"),
      ...(process.env.STUDIO_TEST_ELECTRON_NODE === "1"
        ? { nodePath: require("electron"), electronNode: true }
        : {}),
    });
    let restored;
    async function req(service, route, { method = "GET", data, cookie } = {}) {
      const headers = {
        "x-studio-desktop-ui": service.uiToken,
        "Content-Type": "application/json",
      };
      if (cookie) headers.Cookie = cookie;
      const r = await fetch(service.webUrl + route, {
        method,
        headers,
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      assert.ok(r.ok, await r.clone().text());
      return r;
    }
    async function session(service) {
      const r = await req(service, "/api/desktop-session", { method: "POST" });
      return r.headers.getSetCookie()[0].split(";")[0];
    }
    try {
      await runtime.start();
      assert.equal((await fetch(runtime.apiUrl + "/api/health")).status, 401);
      assert.equal((await fetch(runtime.webUrl + "/api/health")).status, 403);
      assert.equal(
        (
          await fetch(runtime.webUrl + "/api/health", {
            headers: {
              "x-studio-desktop-ui": runtime.uiToken,
              Origin: "https://example.invalid",
            },
          })
        ).status,
        403,
      );
      const cookie = await session(runtime);
      const scene = {
        schemaVersion: "1.0",
        units: "mm",
        height: 2700,
        walls: [
          { id: "a", x: 0, y: 0 },
          { id: "b", x: 4200, y: 0 },
          { id: "c", x: 4200, y: 3600 },
          { id: "d", x: 0, y: 3600 },
        ],
        openings: [],
        items: [],
        moodboards: [
          {
            id: "warm",
            title: "Caldo DEMO",
            palette: ["#ffffff", "#eeeeee", "#dddddd"],
            notes: "Demo",
            approved: false,
          },
          {
            id: "cool",
            title: "Freddo DEMO",
            palette: ["#ffffff", "#eeeeee", "#dddddd"],
            notes: "Demo",
            approved: false,
          },
        ],
      };
      const project = await (
        await req(runtime, "/api/projects", {
          method: "POST",
          cookie,
          data: {
            title: "Cucina desktop",
            brief: "Demo locale",
            expectedRevision: 0,
            scene,
          },
        })
      ).json();
      const brand = await (
        await req(runtime, "/api/catalog", {
          method: "POST",
          cookie,
          data: {
            expectedRevision: 0,
            entry: {
              kind: "manufacturer",
              name: "DEMO locale",
              code: "DEMO",
              isDemo: true,
              status: "approved",
              sourceReference: "Campione originale",
              license: "Demo",
            },
          },
        })
      ).json();
      const finish = await (
        await req(runtime, "/api/catalog", {
          method: "POST",
          cookie,
          data: {
            expectedRevision: 0,
            entry: {
              kind: "finish",
              name: "DEMO finitura",
              code: "F",
              manufacturerId: brand.id,
              isDemo: true,
            },
          },
        })
      ).json();
      const image = await fs.readFile(
        path.resolve(__dirname, "../../frontend/tests/fixtures/swatch.png"),
      );
      const upload = await fetch(
        runtime.webUrl + `/api/catalog/${finish.id}/swatch`,
        {
          method: "PUT",
          headers: {
            "x-studio-desktop-ui": runtime.uiToken,
            Cookie: cookie,
            "Content-Type": "image/png",
          },
          body: image,
        },
      );
      assert.equal(upload.status, 200, await upload.text());
      if (process.env.DESKTOP_BROWSER_TEST === "1") {
        const { chromium } = require("../../frontend/node_modules/playwright");
        const browser = await chromium.launch({
          executablePath: process.env.CHROMIUM_PATH || undefined,
        });
        try {
          const context = await browser.newContext({
            extraHTTPHeaders: { "x-studio-desktop-ui": runtime.uiToken },
            viewport: { width: 1500, height: 1000 },
          });
          await context.route("**/*", (route) =>
            new URL(route.request().url()).origin === runtime.webUrl
              ? route.continue()
              : route.abort(),
          );
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.goto(runtime.webUrl);
          await page
            .getByRole("button", { name: "Nuovo progetto cucina" })
            .click();
          await page.getByRole("button", { name: /＋ Base cucina/ }).click();
          await page.getByRole("button", { name: "Salva progetto" }).click();
          await page
            .getByRole("status")
            .filter({ hasText: "Salvata revisione 1" })
            .waitFor();
          await page.reload();
          await page
            .getByRole("button", { name: "Nuovo progetto cucina" })
            .waitFor();
          await page.getByRole("button", { name: "Esci", exact: true }).click();
          await page
            .getByRole("heading", { name: "Studio locale", exact: true })
            .waitFor();
          assert.equal(
            await page.getByLabel("Password", { exact: true }).count(),
            0,
          );
          assert.equal(
            await page
              .getByText("Password iniziale:", { exact: false })
              .count(),
            0,
          );
          await page
            .getByRole("button", { name: "Rientra nello studio", exact: false })
            .click();
          await page.getByRole("button", { name: /Cucina desktop/ }).waitFor();
          await fs.mkdir(path.resolve(__dirname, "../test-results"), {
            recursive: true,
          });
          await page.screenshot({
            path: path.resolve(
              __dirname,
              "../test-results/desktop-runtime.png",
            ),
            fullPage: true,
          });
          assert.deepEqual(errors, []);
        } finally {
          await browser.close();
        }
      }
      await runtime.stop();
      const backup = await backupData(runtime.dataDir, dir);
      await runtime.start();
      let c = await session(runtime);
      let saved = await (
        await req(runtime, "/api/projects/" + project.id, { cookie: c })
      ).json();
      assert.deepEqual(saved.scene, scene);
      await runtime.stop();
      restored = new Runtime({
        resources,
        dataDir: backup,
        logsDir: path.join(dir, "restored-logs"),
        nodePath: runtime.nodePath,
        electronNode: runtime.electronNode,
      });
      await restored.start();
      c = await session(restored);
      saved = await (
        await req(restored, "/api/projects/" + project.id, { cookie: c })
      ).json();
      assert.deepEqual(saved.scene, scene);
      const swatch = await req(restored, `/api/catalog/${finish.id}/swatch`, {
        cookie: c,
      });
      assert.equal(
        Buffer.from(await swatch.arrayBuffer())
          .subarray(1, 4)
          .toString(),
        "PNG",
      );
    } finally {
      await runtime.stop();
      if (restored) await restored.stop();
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);
