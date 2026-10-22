"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CadReference } from "./model";
type Parsed = {
  paths: CadReference["paths"];
  unit: number;
  warnings: string[];
};
const units = [
  { name: "Millimetri", factor: 1, id: 4 },
  { name: "Centimetri", factor: 10, id: 5 },
  { name: "Metri", factor: 1000, id: 6 },
  { name: "Pollici", factor: 25.4, id: 1 },
  { name: "Piedi", factor: 304.8, id: 2 },
];
export default function CadImport({
  onImport,
  onClose,
}: {
  onImport: (plan: CadReference) => void;
  onClose: () => void;
}) {
  const [parsed, setParsed] = useState<Parsed | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [unit, setUnit] = useState(""),
    [file, setFile] = useState<{
      filename: string;
      sha256: string;
      format: "dwg" | "dxf";
    } | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const worker = useRef<Worker | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function stop() {
    worker.current?.terminate();
    worker.current = null;
    if (timer.current) clearTimeout(timer.current);
  }
  useEffect(() => () => stop(), []);
  const layers = useMemo(
    () => Array.from(new Set(parsed?.paths.map((p) => p.layer) || [])).sort(),
    [parsed],
  );
  const plan = useMemo(() => {
    if (!parsed || !file || !unit) return null;
    const factor = Number(unit),
      paths = parsed.paths.filter((p) => selected.includes(p.layer));
    if (!paths.length) return null;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const path of paths)
      for (let i = 0; i < path.points.length; i += 2) {
        minX = Math.min(minX, path.points[i]);
        maxX = Math.max(maxX, path.points[i]);
        minY = Math.min(minY, path.points[i + 1]);
        maxY = Math.max(maxY, path.points[i + 1]);
      }
    const width = (maxX - minX) * factor,
      height = (maxY - minY) * factor;
    return {
      ...file,
      sourceUnit: units.find((u) => u.factor === factor)!.name,
      millimetersPerUnit: factor,
      width,
      height,
      originX: minX,
      originY: maxY,
      warnings: parsed.warnings,
      paths: paths.map((p) => ({
        layer: p.layer,
        points: p.points.map(
          (v, i) =>
            Math.round((i % 2 ? maxY - v : v - minX) * factor * 1000) / 1000,
        ),
      })),
    };
  }, [parsed, file, unit, selected]);
  async function read(input: File | undefined) {
    if (!input) return;
    stop();
    setError("");
    setParsed(null);
    setConfirmed(false);
    const format = input.name.split(".").pop()?.toLowerCase();
    if (format !== "dwg" && format !== "dxf") {
      setError("Scegli un file DWG o DXF.");
      return;
    }
    if (!input.size || input.size > 30 * 1024 * 1024) {
      setError("Scegli un file fino a 30 MB.");
      return;
    }
    setBusy(true);
    try {
      const buffer = await input.arrayBuffer();
      if (
        format === "dwg" &&
        !/^AC10\d\d/.test(new TextDecoder().decode(buffer.slice(0, 6)))
      )
        throw Error("Il file non contiene un DWG valido.");
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      setFile({
        filename: input.name.slice(0, 255),
        format,
        sha256: Array.from(new Uint8Array(digest), (v) =>
          v.toString(16).padStart(2, "0"),
        ).join(""),
      });
      const w = new Worker("/cad/worker.js", { type: "module" });
      worker.current = w;
      const fail = (message: string) => {
        stop();
        setBusy(false);
        setError(message);
      };
      timer.current = setTimeout(
        () =>
          fail(
            "Lettura interrotta dopo 60 secondi. Esporta solo la pianta 2D in DXF.",
          ),
        60000,
      );
      w.onerror = () =>
        fail(
          "Lettore CAD non disponibile o file non supportato. Prova un DXF.",
        );
      w.onmessage = ({ data }) => {
        stop();
        setBusy(false);
        if (data.error) {
          setError(data.error);
          return;
        }
        const result = data.result as Parsed;
        setParsed(result);
        setSelected(Array.from(new Set(result.paths.map((p) => p.layer))));
        setUnit(String(units.find((u) => u.id === result.unit)?.factor || ""));
      };
      w.postMessage({ buffer, format }, [buffer]);
    } catch (e) {
      stop();
      setBusy(false);
      setError(e instanceof Error ? e.message : "File non leggibile.");
    }
  }
  const valid =
    plan &&
    plan.width > 0 &&
    plan.height > 0 &&
    plan.width <= 50000 &&
    plan.height <= 50000;
  return (
    <section className="cad-import" aria-label="Importazione planimetria">
      <div className="actions">
        <h2>Importa la planimetria</h2>
        <button onClick={onClose}>Chiudi</button>
      </div>
      <p>
        Scegli il DWG o DXF della pianta. Il file viene letto sul tuo computer,
        senza invii a servizi esterni.
      </p>
      <label>
        File della planimetria
        <input
          disabled={busy}
          type="file"
          accept=".dwg,.dxf"
          onChange={(e) => {
            void read(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {busy && <p role="status">Lettura della planimetria…</p>}
      {error && <p role="alert">{error}</p>}
      {parsed && (
        <>
          <label>
            Unità del disegno
            <select
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value);
                setConfirmed(false);
              }}
            >
              <option value="">Scegli le unità</option>
              {units.map((u) => (
                <option key={u.id} value={u.factor}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <details>
            <summary>
              Livelli da importare ({selected.length}/{layers.length})
            </summary>
            <div className="cad-layers">
              {layers.map((l) => (
                <label key={l}>
                  <input
                    type="checkbox"
                    checked={selected.includes(l)}
                    onChange={(e) => {
                      setSelected(
                        e.target.checked
                          ? [...selected, l]
                          : selected.filter((x) => x !== l),
                      );
                      setConfirmed(false);
                    }}
                  />
                  {l}
                </label>
              ))}
            </div>
          </details>
          {plan && (
            <>
              <p>
                Ingombro:{" "}
                <b>
                  {Math.round(plan.width)} × {Math.round(plan.height)} mm
                </b>{" "}
                · {plan.paths.length} tracciati
              </p>
              <svg
                aria-label="Anteprima della planimetria"
                viewBox={`-10 -10 ${plan.width + 20} ${plan.height + 20}`}
                width="100%"
                height="300"
                style={{ background: "#fffefa" }}
              >
                {plan.paths.map((p, i) => (
                  <polyline
                    key={i}
                    points={p.points.join(" ")}
                    fill="none"
                    stroke="#38564b"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
              {!valid && (
                <p role="alert">
                  Controlla le unità e i livelli: la pianta deve avere un
                  ingombro massimo di 50 × 50 metri e due dimensioni positive.
                </p>
              )}
            </>
          )}
          {!!parsed.warnings.length && (
            <details>
              <summary>Elementi non importati: controlla il disegno</summary>
              {parsed.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </details>
          )}
          <p>
            Importiamo la geometria 2D come base. Muri, porte e finestre non
            sono ancora riconosciuti automaticamente. La nuova pianta
            sostituisce muri, aperture e arredi del progetto; puoi annullare
            l’operazione.
          </p>
          <label className="cad-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Ho controllato anteprima, unità e dimensioni
          </label>
          <button
            className="primary"
            disabled={!valid || !confirmed || busy}
            onClick={() => {
              if (valid && plan) onImport(plan);
            }}
          >
            Usa questa planimetria
          </button>
        </>
      )}
    </section>
  );
}
