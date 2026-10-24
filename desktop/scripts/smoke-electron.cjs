const {
  _electron: electron,
} = require("../../frontend/node_modules/playwright");
const path = require("node:path");
(async () => {
  const executablePath =
    process.env.STUDIO_INSTALLED_EXE || require("electron");
  const app = await electron.launch({
    executablePath,
    args: [
      ...(process.env.STUDIO_INSTALLED_EXE
        ? []
        : [path.resolve(__dirname, "..")]),
      ...(process.platform === "linux" &&
      process.env.STUDIO_LINUX_HEADLESS_TEST === "1"
        ? ["--headless", "--ozone-platform=headless", "--no-sandbox"]
        : []),
    ],
  });
  try {
    const window = await app.firstWindow({ timeout: 90000 });
    window.on("pageerror", (error) =>
      console.error("Renderer:", error.message),
    );
    await window
      .getByRole("button", { name: "Nuovo progetto cucina" })
      .waitFor({ timeout: 60000 });
    await window.getByRole("button", { name: "Nuovo progetto cucina" }).click();
    await window.getByRole("button", { name: "Salva progetto" }).click();
    await window
      .getByRole("status")
      .filter({ hasText: "Salvata revisione 1" })
      .waitFor();
    await window.reload();
    await window
      .getByRole("button", { name: "Nuovo progetto cucina" })
      .waitFor();
    await window.getByRole("button", { name: "Esci", exact: true }).click();
    await window
      .getByRole("heading", { name: "Studio locale", exact: true })
      .waitFor();
    if (await window.getByLabel("Password", { exact: true }).count())
      throw new Error("La modalità locale non deve chiedere password");
    await window
      .getByRole("button", { name: "Rientra nello studio", exact: false })
      .click();
    await window
      .getByRole("button", { name: "Nuovo progetto cucina" })
      .waitFor();
    if (await window.evaluate(() => typeof require !== "undefined"))
      throw new Error("Node esposto nel renderer");
    await window
      .getByRole("button", { name: "Importa planimetria DWG / DXF" })
      .click();
    await window
      .getByRole("heading", { name: "Importa la planimetria" })
      .waitFor();
    await window
      .getByLabel("File della planimetria")
      .setInputFiles(
        path.resolve(
          __dirname,
          "../../frontend/tests/fixtures/plan-polyline.dwg",
        ),
      );
    await window.getByLabel("Unità del disegno").waitFor({ timeout: 60000 });
    await window.getByLabel("Unità del disegno").selectOption("1");
    await window
      .getByLabel("Ho controllato anteprima, unità e dimensioni")
      .check();
    await window
      .getByRole("button", { name: "Usa questa planimetria" })
      .click();
    await window
      .getByRole("status")
      .filter({ hasText: "Planimetria importata" })
      .waitFor();
    await window
      .getByRole("button", { name: "Salva progetto", exact: true })
      .click();
    await window
      .getByRole("status")
      .filter({ hasText: "Salvata revisione 1" })
      .waitFor();
    // Keep the real DWG import above; exercise editing on a dimensioned apartment.
    await window
      .getByRole("button", { name: "Importa DWG / DXF", exact: true })
      .click();
    await window
      .getByLabel("File della planimetria")
      .setInputFiles(
        path.resolve(__dirname, "../../frontend/tests/fixtures/apartment.dxf"),
      );
    await window
      .getByLabel("Ho controllato anteprima, unità e dimensioni")
      .check();
    await window
      .getByRole("button", { name: "Usa questa planimetria" })
      .click();
    await window
      .getByRole("button", { name: "Riconosci muri e ambienti", exact: true })
      .click();
    const recognition = window.getByRole("dialog", {
      name: "Riconoscimento della planimetria",
    });
    await recognition
      .getByRole("button", { name: "Avvia riconoscimento locale" })
      .click();
    await recognition.getByText("Muri:", { exact: false }).first().waitFor();
    const svg = recognition.getByLabel("Anteprima del riconoscimento");
    async function drag(from, to) {
      await svg.scrollIntoViewIfNeeded();
      const points = await svg.evaluate(
        (el, coords) =>
          coords.map((p) => {
            const q = new DOMPoint(p[0], p[1]).matrixTransform(
              el.getScreenCTM(),
            );
            return { x: q.x, y: q.y };
          }),
        [from, to],
      );
      await window.mouse.move(points[0].x, points[0].y);
      await window.mouse.down();
      await window.mouse.move(points[1].x, points[1].y, { steps: 8 });
      await window.mouse.up();
    }
    await recognition
      .getByRole("button", { name: "Aggiungi muro", exact: true })
      .click();
    await drag([1470, 360], [1470, 1000]);
    if (
      Math.abs(
        Number(await recognition.getByLabel("Inizio Y (mm)").inputValue()) -
          1000,
      ) > 5
    )
      throw Error("Trascinamento del muro non conservato");
    const wallId = await recognition
      .getByLabel("Elemento da correggere")
      .inputValue();
    await recognition
      .getByRole("button", { name: "Aperture", exact: true })
      .click();
    await recognition
      .getByRole("button", { name: "Aggiungi finestra", exact: true })
      .click();
    const openingId = await recognition
      .getByLabel("Elemento da correggere")
      .inputValue();
    const line = recognition
      .locator(`[data-opening-id="${openingId}"] line`)
      .first();
    const middle = await line.evaluate((el) => [
      (Number(el.getAttribute("x1")) + Number(el.getAttribute("x2"))) / 2,
      (Number(el.getAttribute("y1")) + Number(el.getAttribute("y2"))) / 2,
    ]);
    await drag(middle, [1470, 1000]);
    if (
      (await recognition.getByLabel("Muro associato").inputValue()) !== wallId
    )
      throw Error("La finestra non si aggancia al nuovo muro");
    await recognition
      .getByLabel(
        "Ho controllato gli elementi proposti e le misure sulla planimetria",
      )
      .check();
    await recognition
      .getByRole("button", { name: "Conferma nel progetto" })
      .click();
    await window
      .getByRole("button", { name: "Salva progetto", exact: true })
      .click();
    await window
      .getByRole("status")
      .filter({ hasText: "Salvata revisione 2" })
      .waitFor();
    const fs = require("node:fs/promises");
    await fs.mkdir(path.resolve(__dirname, "../test-results"), {
      recursive: true,
    });
    await window.screenshot({
      path: path.resolve(__dirname, "../test-results/electron-window.png"),
    });
    console.log(
      "Finestra Electron: avvio, sessione locale e salvataggio riusciti.",
    );
  } finally {
    // Test teardown must not wait on the native unsaved-changes dialog.
    // Production retains its normal protection; only this test instance is affected.
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.removeAllListeners("will-prevent-unload");
        window.webContents.on("will-prevent-unload", (event) =>
          event.preventDefault(),
        );
      }
    });
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  if (process.env.GITHUB_ACTIONS)
    console.log(
      "::error::" +
        String(e.message || e)
          .replaceAll("%", "%25")
          .replaceAll("\r", "%0D")
          .replaceAll("\n", "%0A"),
    );
  process.exitCode = 1;
});
