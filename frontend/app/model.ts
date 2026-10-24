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
export type CadReference = {
  filename: string;
  sha256: string;
  format: "dwg" | "dxf";
  sourceUnit: string;
  millimetersPerUnit: number;
  width: number;
  height: number;
  originX: number;
  originY: number;
  paths: { layer: string; points: number[] }[];
  warnings: string[];
};
export type PlanPoint = { x: number; y: number };
export type RecognizedWall = {
  id: string;
  start: PlanPoint;
  end: PlanPoint;
  thickness: number;
  evidence: string;
  certainty: "strong" | "possible" | "manual";
};
export type RecognizedOpening = {
  id: string;
  wallId: string;
  kind: "door" | "window" | "unknown";
  offset: number;
  width: number;
  evidence: string;
  certainty: "strong" | "possible" | "manual";
};
export type RecognizedRoom = {
  id: string;
  name: string;
  kind:
    | "unknown"
    | "kitchen"
    | "living"
    | "bedroom"
    | "bathroom"
    | "circulation"
    | "other";
  points: PlanPoint[];
  evidence: string;
};
export type Recognition = {
  engine: "cad-geometry-v1";
  referenceFingerprint: string;
  reviewed: boolean;
  walls: RecognizedWall[];
  openings: RecognizedOpening[];
  rooms: RecognizedRoom[];
  warnings: string[];
};
export function openingPoints(
  o: RecognizedOpening,
  walls: RecognizedWall[],
): number[] {
  const w = walls.find((w) => w.id === o.wallId);
  if (!w) return [];
  const length = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
  if (!length) return [];
  const dx = (w.end.x - w.start.x) / length,
    dy = (w.end.y - w.start.y) / length;
  return [
    w.start.x + dx * o.offset,
    w.start.y + dy * o.offset,
    w.start.x + dx * (o.offset + o.width),
    w.start.y + dy * (o.offset + o.width),
  ];
}
export function roomArea(room: RecognizedRoom): number {
  return (
    Math.abs(
      room.points.reduce((n, p, i) => {
        const q = room.points[(i + 1) % room.points.length];
        return n + p.x * q.y - q.x * p.y;
      }, 0),
    ) / 2000000
  );
}
export type Scene = {
  schemaVersion: "1.0";
  units: "mm";
  height: number;
  reference?: CadReference;
  recognition?: Recognition;
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
