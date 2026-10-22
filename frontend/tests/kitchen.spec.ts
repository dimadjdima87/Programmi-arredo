import { test, expect } from "@playwright/test";

test("biblioteca cucina: importazione, ricerca, preferiti e articoli per progetto", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  let installed = false;
  const selected: { id: string; projectId: string; revision: number; quantity: number; note: string; snapshot: object }[] = [];
  const item = {
    id: "sample-1", code: "00123", rowLabel: "Base campione di collaudo", page: 200,
    reference: "M 3.6", section: "Basi", category: "bases", numericStatus: "cross_checked",
    groupKind: "price_group", cells: [
      { group: "1", raw: "100", points: "100", available: true, crossChecked: true },
      { group: "2", raw: "—", points: null, available: false, crossChecked: true },
    ],
  };
  // UI state contract uses neutral fixtures. The real ZIP is tested privately
  // against the frozen payload; it is never published as CI fixture material.
  await page.route("**/api/kitchen/**", async route => {
    const url = new URL(route.request().url()), method = route.request().method();
    const path = url.pathname.slice("/api/kitchen".length);
    let body: unknown;
    if (path === "/status") body = { installed, datasetHash: installed ? "fixture" : undefined,
      edition: "2026", articleOccurrences: 1, kitchenPages: 1,
      categories: [{ id: "bases", label: "Basi", count: 1 }], sections: [{ category: "bases", section: "Basi" }] };
    else if (path === "/import") {
      installed = url.searchParams.get("commit") === "true" || installed;
      body = { imported: installed, datasetHash: "fixture", currentDatasetHash: "", edition: "2026", articleOccurrences: 1, kitchenPages: 1 };
    } else if (path === "/items") body = { total: 1, items: [item] };
    else if (path === "/items/sample-1") body = item;
    else if (path === "/pages") body = { total: 1, items: [{ page: 200, reference: "M 3.6", section: "Basi" }] };
    else if (path === "/pages/200") body = { page: 200, reference: "M 3.6", section: "Basi", display_text: "Manuale campione. Regole per il gruppo prezzi e condizioni." };
    else if (path === "/picks" && method === "GET") body = selected.filter(p => p.projectId === (url.searchParams.get("projectId") || ""));
    else if (path === "/picks" && method === "POST") {
      const data = route.request().postDataJSON();
      const pick = { id: String(selected.length + 1), projectId: data.projectId, revision: 1, quantity: 1, note: "", snapshot: item };
      selected.push(pick); body = { id: pick.id, alreadyPresent: false };
    } else if (path.endsWith("/reference") && method === "GET") {
      const pick = selected.find(p => p.id === path.split("/")[2])!;
      body = { item: pick.snapshot, page: { page: 200, reference: "M 3.6", section: "Basi", display_text: "Pagina conservata della scelta" } };
    } else if (path.startsWith("/picks/") && method === "PUT") {
      const data = route.request().postDataJSON(), pick = selected.find(p => p.id === path.split("/").pop())!;
      Object.assign(pick, data, { revision: pick.revision + 1 }); body = { revision: pick.revision };
    } else if (path.startsWith("/picks/") && method === "DELETE") {
      selected.splice(selected.findIndex(p => p.id === path.split("/").pop()), 1); body = { removed: true };
    } else throw new Error("Richiesta inattesa: " + method + " " + path);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Entra nello studio" }).click();
  await page.getByRole("button", { name: "Nuovo progetto cucina" }).click();
  const created = page.waitForResponse(r => r.url().endsWith("/api/projects") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Salva progetto" }).click();
  const project = await (await created).json();
  await page.locator(".sidebar").getByRole("button", { name: "Albertelli Kitchen", exact: true }).click();
  const k = page.getByRole("region", { name: "Catalogo Albertelli Kitchen" });
  await expect(k.getByText("Tutto il catalogo cucina in un solo spazio.")).toBeVisible();
  await k.getByLabel("Pacchetto catalogo Albertelli Kitchen").setInputFiles({ name: "catalogo.zip", mimeType: "application/zip", buffer: Buffer.from("neutral UI fixture") });
  await k.getByRole("button", { name: "Conferma caricamento" }).click();
  await k.getByLabel("Cerca nel catalogo").fill("00123");
  await k.getByRole("button", { name: /CODICE 00123/ }).click();
  await expect(k.locator("table")).toContainText("Non disponibile");
  await k.getByRole("button", { name: "Salva nei preferiti" }).click();
  await expect(k.locator(".k-message")).toContainText("preferiti");
  await k.getByRole("button", { name: "Aggiungi agli articoli del progetto" }).click();
  await expect(k.locator(".k-message")).toContainText("elenco del progetto");
  await k.getByRole("button", { name: "Articoli del progetto", exact: true }).click();
  await k.getByLabel("Quantità", { exact: true }).fill("3");
  await k.getByLabel("Note per questo articolo").fill("Finitura da confermare");
  await k.getByRole("button", { name: "Salva note e quantità" }).click();
  await expect(k.locator(".k-message")).toHaveText("Elenco aggiornato");
  const download = page.waitForEvent("download");
  await k.getByRole("button", { name: "Esporta elenco" }).click();
  expect((await download).suggestedFilename()).toBe("Albertelli-Kitchen-Elenco.json");
  await k.getByRole("button", { name: "Preferiti", exact: true }).click();
  await expect(k.getByLabel("Quantità", { exact: true })).toHaveValue("1");
  await k.locator(".k-pick .k-link").first().click();
  await expect(k.locator("table")).toContainText("100");
  await k.getByRole("button", { name: "Rimuovi dall’elenco" }).click();
  await expect(k.locator(".k-pick")).toHaveCount(0);
  await k.getByRole("button", { name: "Manuale e note", exact: true }).click();
  await k.getByLabel("Cerca nel catalogo").fill("regole");
  await k.getByRole("button", { name: /PAGINA 200/ }).click();
  await expect(k.locator("pre")).toContainText("condizioni");
  const unchanged = await page.request.get("/api/projects/" + project.id);
  expect((await unchanged.json()).scene).toEqual(project.scene);
  expect(errors).toEqual([]);
});
