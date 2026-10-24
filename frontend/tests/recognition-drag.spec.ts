import { test, expect } from "@playwright/test";
import { moveWall, moveOpening, resizeWall } from "../app/recognition-drag";
import { openingPoints, type Recognition } from "../app/model";
function scene(): Recognition {
  return {
    engine: "cad-geometry-v1",
    referenceFingerprint: "a".repeat(64),
    reviewed: true,
    warnings: [],
    rooms: [],
    walls: [
      {
        id: "a",
        start: { x: 100, y: 100 },
        end: { x: 3100, y: 100 },
        thickness: 200,
        evidence: "test",
        certainty: "possible",
      },
      {
        id: "b",
        start: { x: 3500, y: 200 },
        end: { x: 3500, y: 3200 },
        thickness: 200,
        evidence: "test",
        certainty: "possible",
      },
    ],
    openings: [
      {
        id: "door",
        wallId: "a",
        kind: "door",
        offset: 400,
        width: 800,
        evidence: "test",
        certainty: "possible",
      },
      {
        id: "window",
        wallId: "b",
        kind: "window",
        offset: 100,
        width: 1000,
        evidence: "test",
        certainty: "possible",
      },
    ],
  };
}
test("muro trascinato entro la pianta e aperture al seguito, senza mutare la fonte", () => {
  const base = scene(),
    before = structuredClone(base),
    next = moveWall(
      base,
      "a",
      { x: 10000, y: -1000 },
      { width: 4000, height: 4000 },
    );
  expect(next.walls[0].start).toEqual({ x: 1000, y: 0 });
  expect(next.walls[0].end).toEqual({ x: 4000, y: 0 });
  expect(openingPoints(next.openings[0], next.walls)).toEqual([
    1400, 0, 2200, 0,
  ]);
  expect(next.reviewed).toBe(false);
  expect(base).toEqual(before);
});
test("apertura spostata su muro verticale, entro gli estremi e senza sovrapposizioni", () => {
  const base = scene(),
    next = moveOpening(base, "door", { x: 3500, y: 800 });
  const o = next.openings[0];
  expect(o.wallId).toBe("b");
  expect(o.offset).toBe(1100);
  expect(o.width).toBe(800);
  expect(openingPoints(o, next.walls)).toEqual([3500, 1300, 3500, 2100]);
  const last = moveOpening(base, "door", { x: 3500, y: 10000 }).openings[0];
  expect(last.offset).toBe(2200);
});
test("estremità del muro: aperture mantenute rispetto al lato fisso e accorciamento non valido rifiutato", () => {
  const base = scene(),
    next = resizeWall(
      base,
      "a",
      "start",
      { x: 0, y: 100 },
      { width: 4000, height: 4000 },
    );
  expect(next.openings[0].offset).toBe(500);
  expect(openingPoints(next.openings[0], next.walls)).toEqual([
    500, 100, 1300, 100,
  ]);
  expect(
    resizeWall(
      base,
      "a",
      "end",
      { x: 500, y: 100 },
      { width: 4000, height: 4000 },
    ),
  ).toBe(base);
  expect(
    resizeWall(
      base,
      "a",
      "start",
      { x: 100, y: 100 },
      { width: 4000, height: 4000 },
    ),
  ).toBe(base);
});
test("trascinamento su muro completamente occupato conserva l’apertura iniziale", () => {
  const base = scene();
  base.openings[1].offset = 0;
  base.openings[1].width = 3000;
  expect(moveOpening(base, "door", { x: 3500, y: 1000 })).toBe(base);
});

test("muro, porta e finestra trascinati, annullamento del gesto e riapertura", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("/");
  await page.getByRole("button", { name: "Entra nello studio" }).click();
  await expect(
    page.getByRole("button", { name: "Nuovo progetto cucina" }),
  ).toBeVisible();
  const reference = {
    filename: "drag.dxf",
    sha256: "b".repeat(64),
    format: "dxf",
    sourceUnit: "Millimetri",
    millimetersPerUnit: 1,
    width: 4200,
    height: 3600,
    originX: 0,
    originY: 3600,
    paths: [
      { layer: "MURI", points: [0, 0, 4200, 0, 4200, 3600, 0, 3600, 0, 0] },
    ],
    warnings: [],
  };
  const analysisResponse = await page.request.post("/api/plan/recognize", {
    data: { reference },
  });
  expect(analysisResponse.ok(), await analysisResponse.text()).toBe(true);
  const recognition = await analysisResponse.json();
  recognition.reviewed = true;
  const { demo } = await import("../app/model");
  const p = demo();
  const title = "Trascinamento " + Date.now();
  p.title = title;
  p.scene.reference = reference as typeof p.scene.reference;
  p.scene.recognition = recognition;
  p.scene.walls = [];
  const createResponse = await page.request.post("/api/projects", {
    data: { title, brief: "Test", scene: p.scene, expectedRevision: 0 },
  });
  expect(createResponse.ok(), await createResponse.text()).toBe(true);
  const created = await createResponse.json();
  await page.reload();
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await page.getByRole("button", { name: "Rivedi muri e ambienti" }).click();
  const dialog = page.getByRole("dialog", {
      name: "Riconoscimento della planimetria",
    }),
    svg = dialog.getByLabel("Anteprima del riconoscimento");
  async function screen(x: number, y: number) {
    await svg.scrollIntoViewIfNeeded();
    return svg.evaluate(
      (el, p) => {
        const q = new DOMPoint(p.x, p.y).matrixTransform(
          (el as SVGSVGElement).getScreenCTM()!,
        );
        return { x: q.x, y: q.y };
      },
      { x, y },
    );
  }
  async function drag(from: number[], to: number[]) {
    const a = await screen(from[0], from[1]),
      b = await screen(to[0], to[1]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
  }
  await dialog
    .getByRole("button", { name: "Aggiungi muro", exact: true })
    .click();
  const wallId = await dialog.getByLabel("Elemento da correggere").inputValue();
  await drag([1470, 360], [1470, 1100]);
  expect(
    Number(await dialog.getByLabel("Inizio Y (mm)").inputValue()),
  ).toBeCloseTo(1100, -1);
  await dialog.getByRole("button", { name: "Annulla correzione" }).click();
  expect(Number(await dialog.getByLabel("Inizio Y (mm)").inputValue())).toBe(
    360,
  );
  const a = await screen(1470, 360),
    b = await screen(1470, 900);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  expect(Number(await dialog.getByLabel("Inizio Y (mm)").inputValue())).toBe(
    360,
  );
  await drag([1470, 360], [1470, 1100]);
  await dialog.getByRole("button", { name: "Aperture", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Aggiungi finestra", exact: true })
    .click();
  await drag([400, 0], [4200, 1800]);
  const right = recognition.walls.find(
    (w: { start: { x: number }; end: { x: number } }) =>
      w.start.x === 4200 && w.end.x === 4200,
  );
  await expect(dialog.getByLabel("Muro associato")).toHaveValue(right.id);
  expect(
    Number(
      await dialog
        .getByLabel("Distanza dall’inizio del muro (mm)")
        .inputValue(),
    ),
  ).toBeCloseTo(1400, -1);
  await dialog
    .getByRole("button", { name: "Aggiungi porta", exact: true })
    .click();
  await drag([400, 0], [1470, 1100]);
  await expect(dialog.getByLabel("Muro associato")).toHaveValue(wallId);
  await dialog.getByRole("button", { name: "Muri", exact: true }).click();
  await dialog.getByLabel("Elemento da correggere").selectOption(wallId);
  await drag([700, 1100], [900, 1300]);
  expect(
    Number(await dialog.getByLabel("Inizio X (mm)").inputValue()),
  ).toBeCloseTo(620, -1);
  expect(
    Number(await dialog.getByLabel("Inizio Y (mm)").inputValue()),
  ).toBeCloseTo(1300, -1);
  await drag([2720, 1300], [2920, 1500]);
  expect(
    Number(await dialog.getByLabel("Fine X (mm)").inputValue()),
  ).toBeCloseTo(2920, -1);
  expect(
    Number(await dialog.getByLabel("Fine Y (mm)").inputValue()),
  ).toBeCloseTo(1500, -1);
  await dialog
    .getByLabel(
      "Ho controllato gli elementi proposti e le misure sulla planimetria",
    )
    .check();
  await dialog.getByRole("button", { name: "Conferma nel progetto" }).click();
  await expect(dialog).not.toBeVisible();
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/projects/" + created.id) &&
      r.request().method() === "PUT",
  );
  await page
    .getByRole("button", { name: "Salva progetto", exact: true })
    .click();
  const updated = await (await saved).json(),
    result = updated.scene.recognition;
  expect(
    result.openings.find((o: { kind: string }) => o.kind === "door").wallId,
  ).toBe(wallId);
  expect(
    result.openings.find((o: { kind: string }) => o.kind === "window").wallId,
  ).toBe(right.id);
  expect(
    result.walls.find((w: { id: string }) => w.id === wallId).end.y,
  ).toBeCloseTo(1500, -1);
  await page.reload();
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await page.getByRole("button", { name: "Rivedi muri e ambienti" }).click();
  await dialog.getByLabel("Elemento da correggere").selectOption(wallId);
  expect(
    Number(await dialog.getByLabel("Fine Y (mm)").inputValue()),
  ).toBeCloseTo(1500, -1);
});
