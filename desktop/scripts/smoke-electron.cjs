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
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
