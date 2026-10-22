// SPDX-License-Identifier: GPL-3.0-or-later
import { LibreDwg } from "./vendor/dist/libredwg-web.js";
import "./vendor/dxf-parser.js";
import { geometry } from "./geometry.mjs";
function dxfDatabase(raw) {
  function entities(list) {
    return (list || []).map((e) => {
      const base = {
        ...e,
        isInPaperSpace: e.inPaperSpace,
        extrusionDirection: e.extrusionDirection,
      };
      if (e.type === "LINE")
        return { ...base, startPoint: e.vertices[0], endPoint: e.vertices[1] };
      if (e.type === "POLYLINE" || e.type === "LWPOLYLINE")
        return { ...base, type: "LWPOLYLINE", flag: e.shape ? 1 : 0 };
      if (e.type === "INSERT")
        return {
          ...base,
          insertionPoint: e.position,
          rotation: ((e.rotation || 0) * Math.PI) / 180,
        };
      return base;
    });
  }
  return {
    header: { INSUNITS: raw.header?.$INSUNITS },
    entities: entities(raw.entities),
    tables: {
      BLOCK_RECORD: {
        entries: Object.values(raw.blocks || {}).map((b) => ({
          ...b,
          flags: 0,
          basePoint: b.position || { x: 0, y: 0 },
          entities: entities(b.entities),
        })),
      },
    },
  };
}
self.onmessage = async ({ data }) => {
  try {
    if (data.format === "dxf") {
      const raw = new self.DxfParser().parseSync(
        new TextDecoder().decode(data.buffer),
      );
      if (!raw) throw Error("DXF non leggibile. Esporta un DXF di testo.");
      self.postMessage({ result: geometry(dxfDatabase(raw)) });
      return;
    }
    const reader = await LibreDwg.create(
      new URL("./vendor/wasm", self.location.href).href,
    );
    reader.FS.writeFile("plan.dwg", new Uint8Array(data.buffer));
    const decoded = reader.dwg_read_file("plan.dwg");
    reader.FS.unlink("plan.dwg");
    if (!decoded.data || decoded.error >= 128)
      throw Error(
        "DWG non leggibile o versione non supportata. Prova a salvarlo come DWG 2013 o DXF.",
      );
    try {
      const { database, stats } = reader.convertEx(decoded.data);
      const result = geometry(database, stats.unknownEntityCount);
      if (decoded.error)
        result.warnings.push(
          "Il lettore segnala anomalie nel DWG: confronta l’anteprima con il disegno originale.",
        );
      self.postMessage({ result });
    } finally {
      reader.dwg_free(decoded.data);
    }
  } catch (error) {
    self.postMessage({
      error: error.message || "Impossibile leggere la planimetria.",
    });
  }
};
