import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { demo, finishOnly } from "../app/model";
test("finitura isolata e lock", () => {
  const p = demo();
  p.scene.items.push({
    id: "base",
    label: "DEMO",
    x: 600,
    y: 600,
    width: 600,
    depth: 600,
    height: 870,
    rotation: 0,
    finish: "#abcdef",
    locked: false,
    verification: "DEMO",
  });
  const next = finishOnly(p.scene, "base", "#112233");
  expect(next.items[0].finish).toBe("#112233");
  expect({ ...next.items[0], finish: "#abcdef" }).toEqual(p.scene.items[0]);
  expect(next.walls).toEqual(p.scene.walls);
  expect(next.openings).toEqual(p.scene.openings);
  expect(next.items.length).toBe(p.scene.items.length);
  p.scene.items[0].locked = true;
  expect(finishOnly(p.scene, "base", "#112233")).toEqual(p.scene);
});
test("cucina, aperture, undo/redo, versioni, moodboard ed esportazioni", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Entra nello studio" }).click();
  await page.getByRole("button", { name: "Nuovo progetto cucina" }).click();
  await page.getByRole("button", { name: "＋ Porta", exact: true }).click();
  await page.getByRole("button", { name: "＋ Finestra", exact: true }).click();
  await page.getByRole("button", { name: /＋ Base cucina/ }).click();
  await expect(
    page.getByRole("heading", { name: "Elemento selezionato" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Annulla", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Elemento selezionato" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Ripristina", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Elemento selezionato" }),
  ).toBeVisible();
  await page.getByLabel("X", { exact: true }).last().fill("750");
  await page.getByRole("button", { name: "Annulla", exact: true }).click();
  await expect(page.getByLabel("X", { exact: true }).last()).toHaveValue("600");
  await page.getByRole("button", { name: "Ripristina", exact: true }).click();
  await expect(page.getByLabel("X", { exact: true }).last()).toHaveValue("750");
  await page.getByLabel("Rotazione °").fill("90");
  await page.getByRole("button", { name: "Annulla", exact: true }).click();
  await expect(page.getByLabel("Rotazione °")).toHaveValue("0");
  await page.getByRole("button", { name: "Ripristina", exact: true }).click();
  await expect(page.getByLabel("Rotazione °")).toHaveValue("90");
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/projects") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Salva progetto" }).click();
  const { id } = await (await created).json();
  await expect(page.getByRole("status")).toHaveText("Salvata revisione 1");
  let saved = await (await page.request.get("/api/projects/" + id)).json();
  expect(saved.scene.walls[1].x).toBe(4200);
  expect(saved.scene.walls[2].y).toBe(3600);
  expect(saved.scene.items[0].x).toBe(750);
  expect(saved.scene.openings).toHaveLength(2);
  await page.getByRole("button", { name: "Moodboard", exact: true }).click();
  await expect(page.locator(".board")).toHaveCount(2);
  await page.getByLabel("Palette 1 colore 1").fill("#112233");
  await page
    .getByRole("button", { name: "Approva concept", exact: true })
    .first()
    .click();
  const png = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Esporta PNG", exact: true })
    .first()
    .click();
  const boardDownload = await png;
  expect(boardDownload.suggestedFilename()).toContain(".png");
  const boardBytes = await readFile((await boardDownload.path())!);
  expect(boardBytes.subarray(1, 4).toString()).toBe("PNG");
  expect(boardBytes.readUInt32BE(16)).toBe(1400);
  await page.getByRole("button", { name: "Salva progetto" }).click();
  await expect(page.getByRole("status")).toHaveText("Salvata revisione 2");
  await page
    .getByRole("button", { name: "Brief e versioni", exact: true })
    .click();
  await page.getByRole("button", { name: "Ricarica dal database" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Progetto ricaricato dal database",
  );
  saved = await (await page.request.get("/api/projects/" + id)).json();
  expect(saved.scene.moodboards[0].palette[0]).toBe("#112233");
  expect(saved.scene.moodboards[0].approved).toBe(true);
  const json = page.waitForEvent("download");
  await page.getByRole("button", { name: "Esporta progetto JSON" }).click();
  const projectDownload = await json;
  expect(projectDownload.suggestedFilename()).toContain(".json");
  const exported = JSON.parse(
    await readFile((await projectDownload.path())!, "utf8"),
  );
  expect(exported.scene).toEqual(saved.scene);
  expect(exported.revision).toBe(2);
  await page
    .getByRole("button", { name: "Ripristina versione 1", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "Versione ripristinata come revisione 3",
  );
  saved = await (await page.request.get("/api/projects/" + id)).json();
  expect(saved.revision).toBe(3);
  expect(saved.scene.moodboards[0].palette[0]).toBe("#C5A77C");
  expect(saved.scene.items[0].x).toBe(750);
  await page.getByRole("button", { name: "Pianta 2D", exact: true }).click();
  const plan = page.waitForEvent("download");
  await page.getByRole("button", { name: "Esporta PNG", exact: true }).click();
  const planDownload = await plan;
  expect(planDownload.suggestedFilename()).toContain("pianta");
  const planBytes = await readFile((await planDownload.path())!);
  expect(planBytes.subarray(1, 4).toString()).toBe("PNG");
  expect(planBytes.readUInt32BE(16)).toBeGreaterThan(700);
  await page.screenshot({ path: "test-results/studio.png", fullPage: true });
  expect(errors).toEqual([]);
});
