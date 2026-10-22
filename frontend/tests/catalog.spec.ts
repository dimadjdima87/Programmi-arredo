import { test, expect } from "@playwright/test";

test("catalogo: approvazione, CSV, campione, inserimento e finitura senza deriva", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const suffix = Date.now().toString();
  await page.goto("/");
  await page.getByRole("button", { name: "Entra nello studio" }).click();
  await page.getByRole("button", { name: "Nuovo progetto cucina" }).click();
  await page
    .getByRole("button", { name: "Catalogo e materiali", exact: true })
    .click();
  await page.getByLabel("Nome voce").fill("Produttore DEMO " + suffix);
  await page.getByLabel("Codice voce").fill("M-" + suffix);
  await page
    .getByLabel("Provenienza / documento fonte")
    .fill("Campioni procedurali di test");
  await page
    .getByLabel("Licenza / diritti d’uso")
    .fill("Creati per la demo, nessun marchio reale");
  const brandResponse = page.waitForResponse(
    (r) => r.url().endsWith("/api/catalog") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Salva bozza", exact: true }).click();
  const brand = await (await brandResponse).json();
  await expect(page.locator(".catalog-status")).toContainText("revisione 1");
  await page.getByRole("button", { name: "Approva voce", exact: true }).click();
  await expect(page.locator(".catalog-status")).toContainText("revisione 2");
  const sku = "P-" + suffix,
    name = "Base CSV DEMO " + suffix;
  const header =
    "kind,name,code,manufacturerId,family,width,depth,height,color,isDemo,sourceReference,license,compatibleCodes";
  const csv =
    header +
    `\nproduct,${name},${sku},${brand.id},Cucina,600,600,870,#abcdef,true,Documento demo,Campione originale,\n`;
  await page.getByLabel("Contenuto CSV").fill(csv);
  await page.getByRole("button", { name: "Verifica CSV", exact: true }).click();
  await expect(page.locator(".csv-report")).toContainText("1 righe valide");
  await page
    .getByRole("button", { name: "Importa bozze", exact: true })
    .click();
  await expect(page.locator(".csv-report")).toContainText("1 importate");
  await page
    .getByRole("button", { name: "Gestisci " + name, exact: true })
    .click();
  await page.getByRole("button", { name: "Approva voce", exact: true }).click();
  await expect(page.locator(".catalog-status")).toContainText("revisione 2");
  const card = page
    .locator(".catalog-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await card
    .getByRole("button", { name: "Inserisci in pianta", exact: true })
    .click();
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/projects") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Salva progetto" }).click();
  const project = await (await created).json();
  expect(project.scene.items[0].catalogProduct.code).toBe(sku);
  const geometry = project.scene.items.map((i: Record<string, unknown>) => ({
    id: i.id,
    x: i.x,
    y: i.y,
    width: i.width,
    depth: i.depth,
    height: i.height,
    rotation: i.rotation,
  }));
  await page
    .getByRole("button", { name: "Catalogo e materiali", exact: true })
    .click();
  await page.getByRole("button", { name: "Nuova voce", exact: true }).click();
  await page.getByLabel("Tipo voce").selectOption("finish");
  await page.getByLabel("Nome voce").fill("Finitura DEMO " + suffix);
  await page.getByLabel("Codice voce").fill("F-" + suffix);
  await page.getByLabel("Produttore della voce").selectOption(brand.id);
  await page.getByLabel("Codici prodotti compatibili").fill(sku);
  await page.getByLabel("Colore campione").fill("#112233");
  await page
    .getByLabel("Provenienza / documento fonte")
    .fill("Campione originale procedurale");
  await page.getByLabel("Licenza / diritti d’uso").fill("Demo di test");
  const finishResponse = page.waitForResponse(
    (r) => r.url().endsWith("/api/catalog") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Salva bozza", exact: true }).click();
  const finish = await (await finishResponse).json();
  await page
    .getByLabel("Carica campione PNG/JPEG")
    .setInputFiles("tests/fixtures/swatch.png");
  await expect(page.locator(".catalog-status")).toHaveText(
    "Campione salvato, metadati rimossi",
  );
  const uploaded = await page.request.get(`/api/catalog/${finish.id}/swatch`);
  expect(uploaded.status()).toBe(200);
  expect((await uploaded.body()).subarray(1, 4).toString()).toBe("PNG");
  await page.getByRole("button", { name: "Approva voce", exact: true }).click();
  await expect(page.locator(".catalog-status")).toContainText("revisione 3");
  await page
    .locator(".catalog-card")
    .filter({
      has: page.getByRole("heading", {
        name: "Finitura DEMO " + suffix,
        exact: true,
      }),
    })
    .getByRole("button", { name: "Applica finitura", exact: true })
    .click();
  await page.getByRole("button", { name: "Salva progetto" }).click();
  await expect(page.getByRole("status")).toHaveText("Salvata revisione 2");
  let saved = await (
    await page.request.get("/api/projects/" + project.id)
  ).json();
  expect(saved.scene.items[0].catalogFinish.id).toBe(finish.id);
  expect(saved.scene.items[0].finish).toBe("#112233");
  expect(
    saved.scene.items.map((i: Record<string, unknown>) => ({
      id: i.id,
      x: i.x,
      y: i.y,
      width: i.width,
      depth: i.depth,
      height: i.height,
      rotation: i.rotation,
    })),
  ).toEqual(geometry);
  await page.getByRole("button", { name: "Moodboard", exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Proponi dal catalogo · DEMO" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Proposte DEMO dal catalogo",
  );
  await expect(
    page.locator(".catalog-ref").filter({ hasText: sku }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Salva progetto" }).click();
  await expect(page.getByRole("status")).toHaveText("Salvata revisione 3");
  saved = await (await page.request.get("/api/projects/" + project.id)).json();
  expect(saved.scene.moodboards[0].provenance.provider).toBe("rules-demo");
  await page.screenshot({
    path: "test-results/catalog-moodboards.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Catalogo e materiali", exact: true })
    .click();
  await page.screenshot({ path: "test-results/catalog.png", fullPage: true });
  expect(errors).toEqual([]);
});
