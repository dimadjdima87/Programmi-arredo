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
    await window.locator(".sidebar").getByRole("button", { name: "Albertelli Kitchen", exact: true }).click();
    await window.getByRole("heading", { name: "Albertelli Kitchen", exact: true }).waitFor();
    await window.getByLabel("Pacchetto catalogo Albertelli Kitchen").setInputFiles({
      name: "catalogo-non-valido.zip", mimeType: "application/zip", buffer: Buffer.from("not a catalog"),
    });
    await window.locator(".k-message").filter({ hasText: "Pacchetto di catalogo non valido" }).waitFor();
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
