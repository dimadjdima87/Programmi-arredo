import { test, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";
const load = () =>
  import(pathToFileURL(path.resolve("public/cad/geometry.mjs")).href);
test("CAD: blocchi ruotati, archi di polilinea ed elementi non supportati", async () => {
  const { geometry } = await load();
  const db = {
    header: { INSUNITS: 4 },
    tables: {
      BLOCK_RECORD: {
        entries: [
          {
            name: "porta",
            basePoint: { x: 10, y: 20 },
            entities: [
              {
                type: "LINE",
                layer: "0",
                startPoint: { x: 10, y: 20 },
                endPoint: { x: 12, y: 20 },
              },
            ],
          },
        ],
      },
    },
    entities: [
      {
        type: "INSERT",
        layer: "Porte",
        name: "porta",
        insertionPoint: { x: 100, y: 200 },
        xScale: 2,
        yScale: 1,
        rotation: Math.PI / 2,
      },
      {
        type: "LWPOLYLINE",
        layer: "Archi",
        flag: 0,
        vertices: [
          { x: 0, y: 0, bulge: 1 },
          { x: 10, y: 0 },
        ],
      },
      { type: "TEXT", layer: "Testi" },
    ],
  };
  const result = geometry(db);
  expect(result.paths[0]).toEqual({
    layer: "Porte",
    points: [100, 200, 100, 204],
  });
  const arc = result.paths[1].points;
  expect(Math.min(...arc.filter((_: number, i: number) => i % 2))).toBeCloseTo(
    -5,
  );
  expect(result.warnings).toContain("TEXT: 1 elementi non importati");
  expect(() =>
    geometry({
      entities: [
        {
          type: "LINE",
          startPoint: { x: NaN, y: 0 },
          endPoint: { x: 1, y: 1 },
        },
      ],
    }),
  ).toThrow(/coordinate/);
});
