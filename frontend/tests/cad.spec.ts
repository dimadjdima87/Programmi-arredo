import { test, expect } from "@playwright/test";
import path from "node:path";
const room = [
  "0",
  "SECTION",
  "2",
  "HEADER",
  "9",
  "$INSUNITS",
  "70",
  "6",
  "0",
  "ENDSEC",
  "0",
  "SECTION",
  "2",
  "ENTITIES",
  "0",
  "LWPOLYLINE",
  "8",
  "Muri",
  "90",
  "4",
  "70",
  "1",
  "10",
  "-2",
  "20",
  "-1",
  "10",
  "2.2",
  "20",
  "-1",
  "10",
  "2.2",
  "20",
  "2.6",
  "10",
  "-2",
  "20",
  "2.6",
  "0",
  "ENDSEC",
  "0",
  "EOF",
].join("\n");
test("DWG reale: anteprima locale", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Entra nello studio" }).click();
  await page
    .getByRole("button", { name: "Importa planimetria DWG / DXF" })
    .click();
  await page
    .getByLabel("File della planimetria")
    .setInputFiles(path.resolve("tests/fixtures/plan-polyline.dwg"));
  await expect(page.getByLabel("Unità del disegno")).toBeVisible({
    timeout: 60000,
  });
  await page.getByLabel("Unità del disegno").selectOption("1");
  await expect(page.getByLabel("Anteprima della planimetria")).toBeVisible();
  expect(
    await page
      .locator('svg[aria-label="Anteprima della planimetria"] polyline')
      .count(),
  ).toBeGreaterThan(0);
  await expect(
    page.getByRole("button", { name: "Usa questa planimetria" }),
  ).toBeDisabled();
});
test("DXF: scala, salvataggio, riapertura e annullamento", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Entra nello studio" }).click();
  await page.getByRole("button", { name: "Nuovo progetto cucina" }).click();
  await page
    .getByRole("button", { name: "Importa DWG / DXF", exact: true })
    .click();
  await page
    .getByLabel("File della planimetria")
    .setInputFiles({
      name: "casa.dxf",
      mimeType: "application/dxf",
      buffer: Buffer.from(room),
    });
  await expect(page.getByText("4200 × 3600 mm", { exact: true })).toBeVisible();
  await page.getByLabel("Ho controllato anteprima, unità e dimensioni").check();
  await page.getByRole("button", { name: "Usa questa planimetria" }).click();
  await page.getByRole("button", { name: "Annulla", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "＋ Porta", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Ripristina", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "＋ Porta", exact: true }),
  ).toHaveCount(0);
  const title = "Pianta CAD " + Date.now();
  await page
    .getByRole("button", { name: "Brief e versioni", exact: true })
    .click();
  await page.getByLabel("Nome progetto").fill(title);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/projects") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Salva progetto", exact: true })
    .click();
  const saved = await (await response).json();
  expect(saved.scene.walls).toEqual([]);
  expect(saved.scene.reference.width).toBe(4200);
  expect(saved.scene.reference.height).toBe(3600);
  expect(saved.scene.reference.paths[0].points).toEqual([
    0, 3600, 4200, 3600, 4200, 0, 0, 0, 0, 3600,
  ]);
  await page.reload();
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await expect(page.locator(".cad-info")).toContainText("casa.dxf");
});
