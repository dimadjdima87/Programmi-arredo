import { test, expect } from "@playwright/test";
test("sezione catalog chiusa", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Entra nello studio" }).click();
  await expect(
    page.getByRole("button", { name: "Albertelli Kitchen", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Catalogo e materiali", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Importa planimetria DWG / DXF",
      exact: true,
    }),
  ).toBeVisible();
});
