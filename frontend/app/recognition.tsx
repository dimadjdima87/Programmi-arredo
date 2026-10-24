"use client";
import { useEffect, useRef, useState } from "react";
import {
  type CadReference,
  type Recognition,
  type RecognizedRoom,
  openingPoints,
  roomArea,
} from "./model";
const colors = {
  wall: "#2851a3",
  door: "#287a42",
  window: "#007f96",
  unknown: "#9b6600",
  room: "#b36329",
};
const kinds = [
  ["unknown", "Da assegnare"],
  ["kitchen", "Cucina"],
  ["living", "Living"],
  ["bedroom", "Zona notte"],
  ["bathroom", "Bagno"],
  ["circulation", "Ingresso / disimpegno"],
  ["other", "Altro"],
];
async function request(path: string, body: unknown, signal?: AbortSignal) {
  const response = await fetch("/api/plan/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(
      typeof data.detail === "string"
        ? data.detail
        : Array.isArray(data.detail)
          ? data.detail
              .map((e: { msg: string }) => e.msg.replace("Value error, ", ""))
              .join(" · ")
          : "Operazione non riuscita.",
    );
  return data as Recognition;
}
function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        step="1"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}
export default function RecognizePlan({
  reference,
  current,
  onAccept,
  onClose,
}: {
  reference: CadReference;
  current?: Recognition;
  onAccept: (result: Recognition) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Recognition | null>(
      current ? structuredClone(current) : null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [checked, setChecked] = useState(false),
    [selected, setSelected] = useState(""),
    [section, setSection] = useState("walls"),
    [wallLayers, setWallLayers] = useState<string[]>([]),
    [past, setPast] = useState<Recognition[]>([]);
  const abort = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  function close() {
    if (
      past.length &&
      !window.confirm("Scartare le correzioni non confermate?")
    )
      return;
    onClose();
  }
  useEffect(() => () => abort.current?.abort(), []);
  const layers = Array.from(
    new Set(reference.paths.map((p) => p.layer)),
  ).sort();
  function edit(change: (q: Recognition) => void) {
    if (!draft) return;
    const q = structuredClone(draft);
    change(q);
    q.reviewed = false;
    setPast((p) => [...p, draft].slice(-30));
    setDraft(q);
    setChecked(false);
    setError("");
  }
  async function run(path: string) {
    if (
      path === "rooms" &&
      draft?.rooms.length &&
      !window.confirm(
        "Ricalcolare gli ambienti? I contorni e i nomi attuali verranno sostituiti. Puoi annullare la correzione.",
      )
    )
      return;
    if (
      path === "recognize" &&
      draft &&
      !window.confirm("Sostituire la bozza con una nuova analisi locale?")
    )
      return;
    setBusy(true);
    setError("");
    setChecked(false);
    abort.current = new AbortController();
    try {
      const result = await request(
        path,
        path === "recognize"
          ? { reference, wallLayers }
          : { reference, recognition: { ...draft, rooms: [] } },
        abort.current.signal,
      );
      if (!abort.current.signal.aborted) {
        if (draft) setPast((p) => [...p, draft].slice(-30));
        setDraft(result);
        setSelected("");
      }
    } catch (e) {
      if (!abort.current.signal.aborted)
        setError(e instanceof Error ? e.message : "Analisi non riuscita.");
    } finally {
      if (!abort.current.signal.aborted) setBusy(false);
    }
  }
  async function confirm() {
    if (!draft) return;
    setBusy(true);
    setError("");
    abort.current = new AbortController();
    try {
      const result = await request(
        "validate",
        { reference, recognition: { ...draft, reviewed: true } },
        abort.current.signal,
      );
      if (!abort.current.signal.aborted) onAccept(result);
    } catch (e) {
      if (!abort.current.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Correggi il riconoscimento.",
        );
    } finally {
      if (!abort.current.signal.aborted) setBusy(false);
    }
  }
  const wall = draft?.walls.find((x) => x.id === selected),
    opening = draft?.openings.find((x) => x.id === selected),
    room = draft?.rooms.find((x) => x.id === selected);
  function add() {
    edit((q) => {
      const id = crypto.randomUUID(),
        w = reference.width,
        h = reference.height;
      if (section === "walls")
        q.walls.push({
          id,
          start: { x: w * 0.1, y: h * 0.1 },
          end: { x: w * 0.6, y: h * 0.1 },
          thickness: 200,
          evidence: "Muro aggiunto manualmente.",
          certainty: "manual",
        });
      else if (section === "openings") {
        const host = q.walls.find((w) => w.id === selected) || q.walls[0];
        if (!host) return;
        q.openings.push({
          id,
          wallId: host.id,
          kind: "unknown",
          offset: 0,
          width: Math.min(
            800,
            Math.hypot(host.end.x - host.start.x, host.end.y - host.start.y),
          ),
          certainty: "manual",
          evidence: "Apertura aggiunta manualmente.",
        });
      } else
        q.rooms.push({
          id,
          name: "Nuovo ambiente",
          kind: "unknown",
          evidence: "Contorno aggiunto manualmente: correggere i vertici.",
          points: [
            { x: w * 0.2, y: h * 0.2 },
            { x: w * 0.7, y: h * 0.2 },
            { x: w * 0.7, y: h * 0.7 },
            { x: w * 0.2, y: h * 0.7 },
          ],
        });
      setSelected(id);
    });
  }
  function remove() {
    edit((q) => {
      q.walls = q.walls.filter((w) => w.id !== selected);
      q.openings = q.openings.filter(
        (o) => o.id !== selected && o.wallId !== selected,
      );
      q.rooms = q.rooms.filter((r) => r.id !== selected);
    });
    setSelected("");
  }
  const margin = Math.max(reference.width, reference.height) * 0.02;
  return (
    <dialog
      ref={dialog}
      className="recognition"
      aria-label="Riconoscimento della planimetria"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="actions">
        <div>
          <span className="eyebrow">SUL TUO COMPUTER · SENZA COSTI API</span>
          <h2>Riconosci muri e ambienti</h2>
        </div>
        <button onClick={close}>Chiudi revisione</button>
      </div>
      <p>
        Analisi geometrica del CAD, senza modelli generativi né invio a servizi IA esterni.
        Controlla le proposte sul disegno: gli elementi mancanti possono essere
        aggiunti o corretti.
      </p>
      <details>
        <summary>Livelli dei muri · scelta facoltativa</summary>
        <p>
          Lascia vuoto per la ricerca automatica. Seleziona i livelli che
          contengono i muri per escludere arredi e quote.
        </p>
        <div className="cad-layers">
          {layers.map((l) => (
            <label key={l}>
              <input
                type="checkbox"
                checked={wallLayers.includes(l)}
                disabled={busy}
                onChange={(e) =>
                  setWallLayers(
                    e.target.checked
                      ? [...wallLayers, l]
                      : wallLayers.filter((x) => x !== l),
                  )
                }
              />
              {l}
            </label>
          ))}
        </div>
      </details>
      <div className="actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() => void run("recognize")}
        >
          {draft
            ? "Ripeti riconoscimento locale"
            : "Avvia riconoscimento locale"}
        </button>
        {draft && (
          <>
            <button
              disabled={busy || !past.length}
              onClick={() => {
                setDraft(past[past.length - 1]);
                setPast(past.slice(0, -1));
                setChecked(false);
              }}
            >
              Annulla correzione
            </button>
            <button disabled={busy} onClick={() => void run("rooms")}>
              Ricalcola ambienti dai muri
            </button>
          </>
        )}
      </div>
      {busy && <p role="status">Elaborazione locale…</p>}
      {error && (
        <p role="alert" className="recognition-error">
          {error}
        </p>
      )}
      {draft && (
        <>
          <p className="recognition-legend">
            <span style={{ color: colors.wall }}>
              Muri: {draft.walls.length}
            </span>{" "}
            ·{" "}
            <span style={{ color: colors.door }}>
              Porte: {draft.openings.filter((o) => o.kind === "door").length}
            </span>{" "}
            ·{" "}
            <span style={{ color: colors.window }}>
              Finestre:{" "}
              {draft.openings.filter((o) => o.kind === "window").length}
            </span>{" "}
            · Aperture da classificare:{" "}
            {draft.openings.filter((o) => o.kind === "unknown").length} ·
            Ambienti: {draft.rooms.length}
          </p>
          <div className="recognition-grid">
            <svg
              aria-label="Anteprima del riconoscimento"
              viewBox={`${-margin} ${-margin} ${reference.width + 2 * margin} ${reference.height + 2 * margin}`}
            >
              {reference.paths.map((p, i) => (
                <polyline
                  key={"cad" + i}
                  points={p.points.join(" ")}
                  fill="none"
                  stroke="#9aa39c"
                  strokeOpacity=".5"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {draft.rooms.map((r) => (
                <polygon
                  key={r.id}
                  points={r.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill={colors.room}
                  fillOpacity={selected === r.id ? ".3" : ".12"}
                  stroke={colors.room}
                  strokeWidth={selected === r.id ? "3" : "1"}
                  vectorEffect="non-scaling-stroke"
                  onClick={() => {
                    setSelected(r.id);
                    setSection("rooms");
                  }}
                />
              ))}
              {draft.walls.map((w) => (
                <line
                  key={w.id}
                  x1={w.start.x}
                  y1={w.start.y}
                  x2={w.end.x}
                  y2={w.end.y}
                  stroke={selected === w.id ? "#f29233" : colors.wall}
                  strokeOpacity=".65"
                  strokeWidth={w.thickness}
                  onClick={() => {
                    setSelected(w.id);
                    setSection("walls");
                  }}
                />
              ))}
              {draft.openings.map((o) => {
                const p = openingPoints(o, draft.walls);
                if (!p.length) return null;
                const host = draft.walls.find((w) => w.id === o.wallId)!;
                return (
                  <g
                    key={o.id}
                    onClick={() => {
                      setSelected(o.id);
                      setSection("openings");
                    }}
                  >
                    <line
                      x1={p[0]}
                      y1={p[1]}
                      x2={p[2]}
                      y2={p[3]}
                      stroke="white"
                      strokeWidth={host.thickness + 10}
                    />
                    <line
                      x1={p[0]}
                      y1={p[1]}
                      x2={p[2]}
                      y2={p[3]}
                      stroke={selected === o.id ? "#f29233" : colors[o.kind]}
                      strokeWidth="5"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })}
            </svg>
            <div className="recognition-edit" inert={busy}>
              <div className="tabs">
                {[
                  ["walls", "Muri"],
                  ["openings", "Aperture"],
                  ["rooms", "Ambienti"],
                ].map(([s, l]) => (
                  <button
                    key={s}
                    className={section === s ? "chosen" : ""}
                    onClick={() => {
                      setSection(s);
                      setSelected("");
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <label>
                Elemento da correggere
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Seleziona dal disegno o dall’elenco</option>
                  {section === "walls"
                    ? draft.walls.map((w, i) => (
                        <option key={w.id} value={w.id}>
                          Muro {i + 1} ·{" "}
                          {Math.round(
                            Math.hypot(
                              w.end.x - w.start.x,
                              w.end.y - w.start.y,
                            ),
                          )}{" "}
                          mm
                        </option>
                      ))
                    : section === "openings"
                      ? draft.openings.map((o, i) => (
                          <option key={o.id} value={o.id}>
                            {o.kind === "door"
                              ? "Porta"
                              : o.kind === "window"
                                ? "Finestra"
                                : "Apertura da classificare"}{" "}
                            {i + 1}
                          </option>
                        ))
                      : draft.rooms.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} · {roomArea(r).toFixed(2)} m²
                          </option>
                        ))}
                </select>
              </label>
              <button
                disabled={section === "openings" && !draft.walls.length}
                onClick={add}
              >
                Aggiungi{" "}
                {section === "walls"
                  ? "muro"
                  : section === "openings"
                    ? "apertura"
                    : "ambiente"}
              </button>
              {wall && (
                <>
                  <h3>Muro selezionato</h3>
                  <p>
                    {wall.certainty === "manual"
                      ? "Muro corretto manualmente dall’operatore."
                      : wall.evidence}
                  </p>
                  {(["start", "end"] as const).map((key, i) => (
                    <div className="pair" key={key}>
                      {(["x", "y"] as const).map((axis) => (
                        <NumberField
                          key={axis}
                          label={`${i ? "Fine" : "Inizio"} ${axis.toUpperCase()} (mm)`}
                          value={wall[key][axis]}
                          onChange={(v) =>
                            edit((q) => {
                              const w = q.walls.find((w) => w.id === wall.id)!;
                              w[key][axis] = v;
                              w.certainty = "manual";
                            })
                          }
                        />
                      ))}
                    </div>
                  ))}
                  <NumberField
                    label="Spessore muro (mm)"
                    value={wall.thickness}
                    onChange={(v) =>
                      edit((q) => {
                        const w = q.walls.find((w) => w.id === wall.id)!;
                        w.thickness = v;
                        w.certainty = "manual";
                      })
                    }
                  />
                  <p className="hint">
                    Dopo le correzioni dei muri ricalcola gli ambienti: i
                    contorni e i nomi verranno sostituiti.
                  </p>
                </>
              )}
              {opening && (
                <>
                  <h3>Apertura selezionata</h3>
                  <p>
                    {opening.certainty === "manual"
                      ? "Apertura corretta manualmente dall’operatore."
                      : opening.evidence}
                  </p>
                  <label>
                    Tipo apertura
                    <select
                      value={opening.kind}
                      onChange={(e) =>
                        edit((q) => {
                          const o = q.openings.find(
                            (o) => o.id === opening.id,
                          )!;
                          o.kind = e.target.value as typeof o.kind;
                          o.certainty = "manual";
                        })
                      }
                    >
                      <option value="unknown">Da classificare</option>
                      <option value="door">Porta</option>
                      <option value="window">Finestra</option>
                    </select>
                  </label>
                  <label>
                    Muro associato
                    <select
                      value={opening.wallId}
                      onChange={(e) =>
                        edit((q) => {
                          const o = q.openings.find(
                            (o) => o.id === opening.id,
                          )!;
                          o.wallId = e.target.value;
                          o.offset = 0;
                          o.certainty = "manual";
                        })
                      }
                    >
                      {draft.walls.map((w, i) => (
                        <option key={w.id} value={w.id}>
                          Muro {i + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <NumberField
                    label="Distanza dall’inizio del muro (mm)"
                    value={opening.offset}
                    onChange={(v) =>
                      edit((q) => {
                        const o = q.openings.find((o) => o.id === opening.id)!;
                        o.offset = v;
                        o.certainty = "manual";
                      })
                    }
                  />
                  <NumberField
                    label="Larghezza apertura (mm)"
                    value={opening.width}
                    onChange={(v) =>
                      edit((q) => {
                        const o = q.openings.find((o) => o.id === opening.id)!;
                        o.width = v;
                        o.certainty = "manual";
                      })
                    }
                  />
                </>
              )}
              {room && (
                <>
                  <h3>Ambiente selezionato</h3>
                  <label>
                    Nome ambiente
                    <input
                      maxLength={100}
                      value={room.name}
                      onChange={(e) =>
                        edit((q) => {
                          q.rooms.find((r) => r.id === room.id)!.name =
                            e.target.value;
                        })
                      }
                    />
                  </label>
                  <label>
                    Destinazione ambiente
                    <select
                      value={room.kind}
                      onChange={(e) =>
                        edit((q) => {
                          q.rooms.find((r) => r.id === room.id)!.kind = e.target
                            .value as RecognizedRoom["kind"];
                        })
                      }
                    >
                      {kinds.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>
                    Superficie dal contorno proposto:{" "}
                    {roomArea(room).toFixed(2)} m² · da verificare.
                  </p>
                  <details>
                    <summary>Modifica contorno</summary>
                    {room.points.map((p, i) => (
                      <div key={i}>
                        <div className="pair">
                          {(["x", "y"] as const).map((axis) => (
                            <NumberField
                              key={axis}
                              label={`Vertice ${i + 1} ${axis.toUpperCase()} (mm)`}
                              value={p[axis]}
                              onChange={(v) =>
                                edit((q) => {
                                  q.rooms.find((r) => r.id === room.id)!.points[
                                    i
                                  ][axis] = v;
                                })
                              }
                            />
                          ))}
                        </div>
                        <div className="actions">
                          <button
                            disabled={room.points.length >= 100}
                            onClick={() =>
                              edit((q) => {
                                const r = q.rooms.find(
                                  (r) => r.id === room.id,
                                )!;
                                const a = r.points[i],
                                  b = r.points[(i + 1) % r.points.length];
                                r.points.splice(i + 1, 0, {
                                  x: (a.x + b.x) / 2,
                                  y: (a.y + b.y) / 2,
                                });
                              })
                            }
                          >
                            Aggiungi vertice dopo {i + 1}
                          </button>
                          <button
                            disabled={room.points.length <= 3}
                            onClick={() =>
                              edit((q) => {
                                q.rooms
                                  .find((r) => r.id === room.id)!
                                  .points.splice(i, 1);
                              })
                            }
                          >
                            Rimuovi vertice {i + 1}
                          </button>
                        </div>
                      </div>
                    ))}
                  </details>
                </>
              )}
              {(wall || opening || room) && (
                <button onClick={remove}>Rimuovi elemento selezionato</button>
              )}
            </div>
          </div>
          <details open>
            <summary>Controlli e punti da verificare</summary>
            {draft.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </details>
          <label className="cad-confirm">
            <input
              type="checkbox"
              checked={checked}
              disabled={busy}
              onChange={(e) => setChecked(e.target.checked)}
            />
            Ho controllato gli elementi proposti e le misure sulla planimetria
          </label>
          <button
            className="primary"
            disabled={!checked || busy}
            onClick={() => void confirm()}
          >
            Conferma nel progetto
          </button>
          <p className="hint">
            La conferma aggiorna il progetto aperto. Premi poi Salva progetto.
            Puoi annullare l’intera modifica dallo studio.
          </p>
        </>
      )}
    </dialog>
  );
}
