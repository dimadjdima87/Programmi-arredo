import type {
  CadReference,
  PlanPoint,
  Recognition,
  RecognizedWall,
} from "./model";
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
const round = (n: number) => Math.round(n * 100) / 100;
const length = (w: RecognizedWall) =>
  Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
type Bounds = Pick<CadReference, "width" | "height">;

export function moveWall(
  base: Recognition,
  id: string,
  delta: PlanPoint,
  bounds: Bounds,
): Recognition {
  const w = base.walls.find((w) => w.id === id);
  if (!w || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return base;
  const minX = -Math.min(w.start.x, w.end.x),
    maxX = bounds.width - Math.max(w.start.x, w.end.x);
  const minY = -Math.min(w.start.y, w.end.y),
    maxY = bounds.height - Math.max(w.start.y, w.end.y);
  if (minX > maxX || minY > maxY) return base;
  const dx = clamp(Math.round(delta.x), minX, maxX),
    dy = clamp(Math.round(delta.y), minY, maxY);
  if (!dx && !dy) return base;
  const wall = {
    ...w,
    start: { x: round(w.start.x + dx), y: round(w.start.y + dy) },
    end: { x: round(w.end.x + dx), y: round(w.end.y + dy) },
    certainty: "manual" as const,
  };
  return {
    ...base,
    reviewed: false,
    walls: base.walls.map((other) => (other.id === id ? wall : other)),
  };
}

export function resizeWall(
  base: Recognition,
  id: string,
  end: "start" | "end",
  target: PlanPoint,
  bounds: Bounds,
): Recognition {
  const w = base.walls.find((w) => w.id === id);
  if (!w || !Number.isFinite(target.x) || !Number.isFinite(target.y))
    return base;
  const p = {
    x: round(clamp(target.x, 0, bounds.width)),
    y: round(clamp(target.y, 0, bounds.height)),
  };
  if (p.x === w[end].x && p.y === w[end].y) return base;
  const wall = { ...w, [end]: p, certainty: "manual" as const };
  const oldLength = length(w),
    newLength = length(wall);
  if (newLength < 100) return base;
  const shift = end === "start" ? newLength - oldLength : 0;
  const attached = base.openings.filter((o) => o.wallId === id);
  if (
    attached.some(
      (o) =>
        o.offset + shift < -0.01 ||
        o.offset + shift + o.width > newLength + 0.01,
    )
  )
    return base;
  return {
    ...base,
    reviewed: false,
    walls: base.walls.map((other) => (other.id === id ? wall : other)),
    openings: base.openings.map((o) =>
      o.wallId === id
        ? { ...o, offset: round(Math.max(0, o.offset + shift)) }
        : o,
    ),
  };
}

export function moveOpening(
  base: Recognition,
  id: string,
  center: PlanPoint,
): Recognition {
  const o = base.openings.find((o) => o.id === id);
  if (
    !o ||
    !Number.isFinite(center.x) ||
    !Number.isFinite(center.y) ||
    o.width < 100
  )
    return base;
  let nearest: {
    wall: RecognizedWall;
    distance: number;
    projected: number;
    length: number;
  } | null = null;
  for (const wall of base.walls) {
    const len = length(wall);
    if (len < o.width) continue;
    const dx = (wall.end.x - wall.start.x) / len,
      dy = (wall.end.y - wall.start.y) / len;
    const projected = clamp(
      (center.x - wall.start.x) * dx + (center.y - wall.start.y) * dy,
      o.width / 2,
      len - o.width / 2,
    );
    const distance = Math.hypot(
      center.x - wall.start.x - dx * projected,
      center.y - wall.start.y - dy * projected,
    );
    if (!nearest || distance < nearest.distance)
      nearest = { wall, distance, projected, length: len };
  }
  if (!nearest) return base;
  const { wall, projected, length: len } = nearest;
  const blocked = base.openings
    .filter((other) => other.id !== id && other.wallId === wall.id)
    .map((other) => [
      Math.max(0, other.offset),
      Math.min(len, other.offset + other.width),
    ])
    .sort((a, b) => a[0] - b[0]);
  const free: [number, number][] = [];
  let cursor = 0;
  for (const [a, b] of blocked) {
    if (a - cursor >= o.width) free.push([cursor, a - o.width]);
    cursor = Math.max(cursor, b);
  }
  if (len - cursor >= o.width) free.push([cursor, len - o.width]);
  if (!free.length) return base;
  const desired = projected - o.width / 2;
  const offset = free
    .map(([min, max]) => clamp(desired, min, max))
    .sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired))[0];
  if (o.wallId === wall.id && Math.abs(o.offset - offset) < 0.01) return base;
  return {
    ...base,
    reviewed: false,
    openings: base.openings.map((other) =>
      other.id === id
        ? { ...o, wallId: wall.id, offset: round(offset), certainty: "manual" }
        : other,
    ),
  };
}
