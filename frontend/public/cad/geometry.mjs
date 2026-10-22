// SPDX-License-Identifier: GPL-3.0-or-later
// CAD geometry only: no executable content or external references are loaded.
export function geometry(db, unknown = 0) {
  const paths = [],
    skipped = new Map();
  let coordinates = 0,
    visited = 0;
  const skip = (type) => skipped.set(type, (skipped.get(type) || 0) + 1);
  const identity = [1, 0, 0, 1, 0, 0];
  function point(p, m) {
    return [m[0] * p.x + m[2] * p.y + m[4], m[1] * p.x + m[3] * p.y + m[5]];
  }
  function add(vertices, layer, matrix) {
    if (vertices.length < 2) return;
    const points = vertices.flatMap((p) => point(p, matrix));
    if (!points.every(Number.isFinite))
      throw Error("Il disegno contiene coordinate non valide.");
    coordinates += points.length;
    if (paths.length >= 5000 || coordinates > 120000 || points.length > 20000)
      throw Error(
        "Disegno troppo dettagliato: esporta solo i livelli della planimetria.",
      );
    paths.push({ layer: String(layer || "0").slice(0, 100), points });
  }
  function curve(a, b, bulge) {
    if (!bulge) return [a, b];
    const dx = b.x - a.x,
      dy = b.y - a.y,
      chord = Math.hypot(dx, dy);
    if (!chord) return [a, b];
    const angle = 4 * Math.atan(bulge),
      h = (chord * (1 - bulge * bulge)) / (4 * bulge);
    const cx = (a.x + b.x) / 2 - (dy / chord) * h,
      cy = (a.y + b.y) / 2 + (dx / chord) * h;
    const r = Math.hypot(a.x - cx, a.y - cy),
      start = Math.atan2(a.y - cy, a.x - cx);
    const n = Math.max(2, Math.ceil(Math.abs(angle) / (Math.PI / 36)));
    return Array.from({ length: n + 1 }, (_, i) => ({
      x: cx + r * Math.cos(start + (angle * i) / n),
      y: cy + r * Math.sin(start + (angle * i) / n),
    }));
  }
  const blocks = new Map(
    (db.tables?.BLOCK_RECORD?.entries || []).map((b) => [b.name, b]),
  );
  function walk(entities, m = identity, inherited = "0", stack = []) {
    for (const e of entities) {
      if (++visited > 30000)
        throw Error("Disegno troppo complesso. Esporta solo la pianta 2D.");
      if (e.isInPaperSpace || e.isVisible === false) continue;
      const layer = e.layer === "0" ? inherited : e.layer;
      if (
        e.extrusionDirection &&
        (Math.abs(e.extrusionDirection.x || 0) > 1e-6 ||
          Math.abs(e.extrusionDirection.y || 0) > 1e-6 ||
          e.extrusionDirection.z < 0)
      ) {
        skip("Geometria con piano inclinato");
        continue;
      }
      if (e.type === "LINE") add([e.startPoint, e.endPoint], layer, m);
      else if (["LWPOLYLINE", "POLYLINE2D", "POLYLINE3D"].includes(e.type)) {
        const v = e.vertices || [];
        const out = [];
        for (let i = 0; i < v.length - 1 + (e.flag & 1); i++)
          out.push(
            ...curve(
              v[i % v.length],
              v[(i + 1) % v.length],
              v[i % v.length].bulge,
            ).slice(i ? 1 : 0),
          );
        add(out, layer, m);
      } else if (e.type === "ARC" || e.type === "CIRCLE") {
        const start = e.type === "CIRCLE" ? 0 : e.startAngle;
        let span = e.type === "CIRCLE" ? 2 * Math.PI : e.endAngle - start;
        while (span <= 0) span += 2 * Math.PI;
        if (!Number.isFinite(span) || span > 2 * Math.PI + 1e-5) {
          skip(e.type);
          continue;
        }
        const n = Math.max(4, Math.ceil(span / (Math.PI / 36)));
        add(
          Array.from({ length: n + 1 }, (_, i) => ({
            x: e.center.x + e.radius * Math.cos(start + (span * i) / n),
            y: e.center.y + e.radius * Math.sin(start + (span * i) / n),
          })),
          layer,
          m,
        );
      } else if (e.type === "INSERT") {
        const b = blocks.get(e.name);
        if (
          !b ||
          b.flags & 12 ||
          stack.includes(e.name) ||
          stack.length > 12 ||
          e.columnCount > 1 ||
          e.rowCount > 1
        ) {
          skip("Blocchi non risolti o matrici");
          continue;
        }
        const c = Math.cos(e.rotation || 0),
          s = Math.sin(e.rotation || 0),
          sx = e.xScale ?? 1,
          sy = e.yScale ?? 1;
        const a = c * sx,
          bb = s * sx,
          cc = -s * sy,
          d = c * sy;
        const tx = e.insertionPoint.x - a * b.basePoint.x - cc * b.basePoint.y,
          ty = e.insertionPoint.y - bb * b.basePoint.x - d * b.basePoint.y;
        walk(
          b.entities,
          [
            m[0] * a + m[2] * bb,
            m[1] * a + m[3] * bb,
            m[0] * cc + m[2] * d,
            m[1] * cc + m[3] * d,
            m[0] * tx + m[2] * ty + m[4],
            m[1] * tx + m[3] * ty + m[5],
          ],
          layer,
          [...stack, e.name],
        );
      } else skip(e.type);
    }
  }
  walk(db.entities || []);
  if (!paths.length)
    throw Error(
      "Nessuna linea 2D leggibile. Prova a esportare la pianta in DXF.",
    );
  const warnings = [...skipped]
    .slice(0, 40)
    .map(([type, n]) => `${type}: ${n} elementi non importati`);
  if (unknown)
    warnings.push(`Oggetti non riconosciuti dal lettore: ${unknown}`);
  return { paths, unit: db.header?.INSUNITS || 0, warnings };
}
