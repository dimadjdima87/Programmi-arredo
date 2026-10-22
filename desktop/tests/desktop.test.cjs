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
      // The genuine catalog stays private and is supplied only for local
      // acceptance testing. Public CI never receives the studio's data.
      let kitchenPick;
      if (process.env.STUDIO_KITCHEN_PACKAGE) {
        const packageBytes = await fs.readFile(process.env.STUDIO_KITCHEN_PACKAGE);
        for (const commit of [false, true]) {
          const imported = await fetch(runtime.webUrl + "/api/kitchen/import?commit=" + commit, {
            method: "POST", headers: { "x-studio-desktop-ui": runtime.uiToken, Cookie: cookie,
              "Content-Type": "application/zip" }, body: packageBytes,
          });
          assert.equal(imported.status, 200, await imported.clone().text());
          assert.equal((await imported.json()).articleOccurrences, 8870);
        }
        const found = await (await req(runtime, "/api/kitchen/items?q=21008", { cookie })).json();
        assert.equal(found.items[0].code, "21008");
        assert.equal(found.items[0].cells[0].points, "1006");
        assert.equal(found.items[0].cells[7].available, false);
        const sourcePage = await (await req(runtime, "/api/kitchen/pages/295", { cookie })).json();
        assert.match(sourcePage.display_text, /100 mm/);
        assert.doesNotMatch(sourcePage.display_text, /nobilia/i);
        kitchenPick = await (await req(runtime, "/api/kitchen/picks", { cookie,
          method: "POST", data: { occurrenceId: found.items[0].id, projectId: project.id } })).json();
        await req(runtime, "/api/kitchen/picks/" + kitchenPick.id, { cookie, method: "PUT",
          data: { expectedRevision: 1, quantity: 3, note: "Verifica finitura" } });
      }
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
          await page.locator(".sidebar").getByRole("button", { name: "Albertelli Kitchen", exact: true }).click();
          if (process.env.STUDIO_KITCHEN_PACKAGE) {
            await page.getByLabel("Pacchetto catalogo Albertelli Kitchen").setInputFiles(process.env.STUDIO_KITCHEN_PACKAGE);
            await page.getByRole("button", { name: "Conferma caricamento" }).click();
            await page.getByRole("status").filter({ hasText: "Catalogo Albertelli Kitchen caricato" }).waitFor();
            await page.getByLabel("Cerca nel catalogo").fill("21008");
            await page.getByRole("button", { name: /CODICE 21008/ }).first().click();
            await page.locator(".k-detail table").waitFor();
            assert.match(await page.locator(".k-detail table").innerText(), /1\.?006/);
            await page.getByRole("button", { name: "Salva nei preferiti", exact: true }).click();
            await page.getByRole("status").filter({ hasText: "Articolo salvato nei preferiti" }).waitFor();
            await page.getByRole("button", { name: "Preferiti", exact: true }).click();
            await page.locator(".k-pick").first().waitFor();
            await page.locator(".k-pick .k-link").first().click();
            await page.locator(".k-detail table").waitFor();
            assert.match(await page.locator(".k-detail table").innerText(), /1\.?006/);
          } else {
            await page.getByRole("heading", { name: "Tutto il catalogo cucina in un solo spazio." }).waitFor();
          }
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
      if (kitchenPick) {
        const state = await (await req(runtime, "/api/kitchen/status", { cookie: c })).json();
        assert.equal(state.articleOccurrences, 8870);
      }
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
      if (kitchenPick) {
        const choices = await (await req(restored, "/api/kitchen/picks?projectId=" + project.id, { cookie: c })).json();
        assert.equal(choices[0].quantity, 3);
        assert.equal(choices[0].note, "Verifica finitura");
        assert.equal(choices[0].snapshot.cells[0].points, "1006");
        const found = await (await req(restored, "/api/kitchen/items?q=21008", { cookie: c })).json();
        assert.equal(found.items[0].code, "21008");
      }
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
