import type { CatalogSnapshot } from "./catalog";
export type Wall = { id: string; x: number; y: number };
export type Opening = {
  id: string;
  wallId: string;
  kind: "door" | "window";
  offset: number;
  width: number;
  height: number;
  sill: number;
  swing: "left" | "right";
};
export type Item = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
  rotation: number;
  finish: string;
  locked: boolean;
  verification: "DEMO" | "verified";
  catalogProduct?: CatalogSnapshot;
  catalogFinish?: CatalogSnapshot;
};
export type Board = {
  id: string;
  title: string;
  palette: string[];
  notes: string;
  approved: boolean;
  catalogReferences?: CatalogSnapshot[];
  provenance?: Record<string, unknown>;
};
export type Scene = {
  schemaVersion: "1.0";
  units: "mm";
  height: number;
  walls: Wall[];
  openings: Opening[];
  items: Item[];
  moodboards: Board[];
};
export type Project = {
  id?: string;
  title: string;
  brief: string;
  revision: number;
  scene: Scene;
};
export function demo(): Project {
  return {
    title: "Demo cucina contemporanea",
    brief: "Una cucina luminosa, funzionale e accogliente.",
    revision: 0,
    scene: {
      schemaVersion: "1.0",
      units: "mm",
      height: 2700,
      walls: [
        { id: crypto.randomUUID(), x: 0, y: 0 },
        { id: crypto.randomUUID(), x: 4200, y: 0 },
        { id: crypto.randomUUID(), x: 4200, y: 3600 },
        { id: crypto.randomUUID(), x: 0, y: 3600 },
      ],
      openings: [],
      items: [],
      moodboards: [
        {
          id: crypto.randomUUID(),
          title: "Calore naturale · DEMO",
          palette: ["#C5A77C", "#EEE7DB", "#69745D", "#413F39"],
          notes:
            "Rovere concettuale, toni sabbia e accenti salvia. Materiali indicativi, senza prodotti commerciali associati.",
          approved: false,
        },
        {
          id: crypto.randomUUID(),
          title: "Equilibrio minerale · DEMO",
          palette: ["#A6B8BF", "#E6E8E4", "#676C73", "#BDAA98"],
          notes:
            "Grigi chiari e blu polvere con contrasti grafite. Ispirazione generica, disponibilità e prezzi sconosciuti.",
          approved: false,
        },
      ],
    },
  };
}
export function finishOnly(scene: Scene, id: string, finish: string): Scene {
  return {
    ...scene,
    items: scene.items.map((i) =>
      i.id === id && !i.locked ? { ...i, finish, catalogFinish: undefined } : i,
    ),
  };
}
