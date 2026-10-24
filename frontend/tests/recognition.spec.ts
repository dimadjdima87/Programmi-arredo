import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("riconoscimento locale, correzioni, conferma, riapertura e nuova fonte", async ({
  page,
}) => {
  test.setTimeout(60000);
  const external: string[] = [];
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === "http://127.0.0.1:3000")
      return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Entra nello studio" }).click();
  await page
    .getByRole("button", { name: "Importa planimetria DWG / DXF" })
    .click();
  const name = "appartamento-" + Date.now();
  await page
    .getByLabel("File della planimetria")
    .setInputFiles({
      name: name + ".dxf",
      mimeType: "application/dxf",
      buffer: await readFile("tests/fixtures/apartment.dxf"),
    });
  await page.getByLabel("Ho controllato anteprima, unità e dimensioni").check();
  await page.getByRole("button", { name: "Usa questa planimetria" }).click();
  await page
    .getByRole("button", { name: "Riconosci muri e ambienti", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Riconoscimento della planimetria",
  });
  await dialog
    .getByRole("button", { name: "Avvia riconoscimento locale", exact: true })
    .click();
  await expect(dialog.locator(".recognition-legend")).toContainText("Muri: 4");
  await expect(dialog.locator(".recognition-legend")).toContainText("Porte: 1");
  await expect(dialog.locator(".recognition-legend")).toContainText(
    "Finestre: 1",
  );
  await expect(dialog.locator(".recognition-legend")).toContainText(
    "Ambienti: 1",
  );
  await expect(
    dialog.getByRole("button", { name: "Conferma nel progetto" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Aperture", exact: true }).click();
  await dialog.getByLabel("Elemento da correggere").selectOption({ index: 1 });
  const width = await dialog.getByLabel("Larghezza apertura (mm)").inputValue();
  await dialog.getByLabel("Larghezza apertura (mm)").fill("99999");
  await dialog
    .getByLabel(
      "Ho controllato gli elementi proposti e le misure sulla planimetria",
    )
    .check();
  await dialog.getByRole("button", { name: "Conferma nel progetto" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByLabel("Larghezza apertura (mm)").fill(width);
  await dialog.getByRole("button", { name: "Ambienti", exact: true }).click();
  await dialog.getByLabel("Elemento da correggere").selectOption({ index: 1 });
  await dialog.getByLabel("Nome ambiente", { exact: true }).fill("Cucina");
  await dialog.getByLabel("Destinazione ambiente").selectOption("kitchen");
  await expect(dialog.getByText(/12.16 m²/).last()).toBeVisible();
  await dialog
    .getByLabel(
      "Ho controllato gli elementi proposti e le misure sulla planimetria",
    )
    .check();
  await dialog.getByRole("button", { name: "Conferma nel progetto" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Annulla", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Riconosci muri e ambienti",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ripristina", exact: true }).click();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/api/projects") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Salva progetto", exact: true })
    .click();
  const project = await (await saved).json();
  expect(project.scene.recognition.reviewed).toBe(true);
  expect(project.scene.recognition.rooms[0].name).toBe("Cucina");
  expect(project.scene.recognition.rooms[0].kind).toBe("kitchen");
  expect(project.scene.recognition.walls).toHaveLength(4);
  await page.reload();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(page.locator(".recognized-summary")).toContainText("Cucina");
  await page
    .getByRole("button", { name: "Importa DWG / DXF", exact: true })
    .click();
  await page
    .getByLabel("File della planimetria")
    .setInputFiles("tests/fixtures/apartment.dxf");
  await page.getByLabel("Ho controllato anteprima, unità e dimensioni").check();
  await page.getByRole("button", { name: "Usa questa planimetria" }).click();
  await expect(page.locator(".recognized-summary")).toHaveCount(0);
  expect(external).toEqual([]);
});
