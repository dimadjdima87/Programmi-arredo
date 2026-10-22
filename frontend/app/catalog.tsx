"use client";
import { useEffect, useState } from "react";
export type Entry = {
  id: string;
  revision: number;
  kind: "manufacturer" | "product" | "finish";
  name: string;
  code: string;
  manufacturerId: string;
  family: string;
  width: number;
  depth: number;
  height: number;
  color: string;
  isDemo: boolean;
  sourceReference: string;
  license: string;
  status: "draft" | "approved" | "archived";
  compatibleCodes: string[];
};
export type CatalogSnapshot = Entry;
async function request(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "Dati non validi: verifica i campi e la provenienza",
    );
  return data;
}
function empty(): Entry {
  return {
    id: "",
    revision: 0,
    kind: "manufacturer",
    name: "",
    code: "",
    manufacturerId: "",
    family: "",
    width: 600,
    depth: 600,
    height: 870,
    color: "#C5A77C",
    isDemo: true,
    sourceReference: "",
    license: "",
    status: "draft",
    compatibleCodes: [],
  };
}
export default function Catalog({
  onPlace,
  onFinish,
}: {
  onPlace?: (e: Entry) => void;
  onFinish?: (e: Entry) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [entry, setEntry] = useState<Entry>(empty()),
    [filter, setFilter] = useState(""),
    [kind, setKind] = useState("all"),
    [manufacturer, setManufacturer] = useState("all"),
    [state, setState] = useState("all"),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [csv, setCsv] = useState(""),
    [report, setReport] = useState<{
      valid: number;
      imported: number;
      errors: { row: number; message: string }[];
    } | null>(null),
    [history, setHistory] = useState<Entry[]>([]);
  async function refresh() {
    setEntries(await request("/catalog"));
  }
  useEffect(() => {
    refresh().catch((e) => setStatus(e.message));
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Operazione non riuscita");
    } finally {
      setBusy(false);
    }
  }
  function patch(p: Partial<Entry>) {
    setEntry({ ...entry, ...p });
  }
  async function save(next = entry) {
    await run(async () => {
      const { id, revision, ...data } = next;
      const result = await request(
        "/catalog" + (id ? "/" + id : ""),
        id ? "PUT" : "POST",
        { expectedRevision: revision, entry: data },
      );
      setEntry(result);
      await refresh();
      setHistory(await request("/catalog/" + result.id + "/versions"));
      setStatus("Voce salvata · revisione " + result.revision);
    });
  }
  function select(e: Entry) {
    setEntry(structuredClone(e));
    run(async () => {
      setHistory(await request("/catalog/" + e.id + "/versions"));
      setStatus("Voce selezionata: " + e.name);
    });
  }
  const manufacturers = entries.filter(
    (e) => e.kind === "manufacturer" && e.status === "approved",
  );
  const visible = entries.filter(
    (e) =>
      (kind === "all" || e.kind === kind) &&
      (manufacturer === "all" ||
        e.manufacturerId === manufacturer ||
        e.id === manufacturer) &&
      (state === "all" || e.status === state) &&
      `${e.name} ${e.code} ${e.family}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  const locked = entry.status !== "draft";
  function template() {
    const columns =
      "kind,name,code,manufacturerId,family,width,depth,height,color,isDemo,sourceReference,license,compatibleCodes";
    const producer = manufacturers[0];
    const line = producer
      ? `product,Base esempio DEMO,DEMO-CSV-${Date.now()},${producer.id},Cucina,600,600,870,#C5A77C,${producer.isDemo},Campione fornito dall’operatore,Verificare i diritti,`
      : "";
    const url = URL.createObjectURL(
      new Blob([columns + "\n" + line + "\n"], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "modello-catalogo.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="catalog-page" inert={busy}>
      <div className="section-title">
        <span className="eyebrow">PROVENIENZA / MATERIALI / MISURE</span>
        <h2>Il tuo catalogo</h2>
        <p>
          Nessun prodotto reale precaricato. I dati DEMO restano riconoscibili
          anche dopo l’approvazione.
        </p>
        <p role="status" className="catalog-status">
          {status ||
            "Crea un produttore, approvalo e aggiungi prodotti e finiture."}
        </p>
      </div>
      <div className="catalog-layout">
        <div>
          <div className="catalog-filters">
            <label>
              Cerca nel catalogo
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Nome, codice o famiglia"
              />
            </label>
            <label>
              Tipo
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="all">Tutti</option>
                <option value="manufacturer">Produttori</option>
                <option value="product">Prodotti</option>
                <option value="finish">Finiture</option>
              </select>
            </label>
            <label>
              Produttore
              <select
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
              >
                <option value="all">Tutti</option>
                {manufacturers.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Stato
              <select value={state} onChange={(e) => setState(e.target.value)}>
                <option value="all">Tutti</option>
                <option value="draft">Bozze</option>
                <option value="approved">Approvati</option>
                <option value="archived">Archiviati</option>
              </select>
            </label>
          </div>
          <div className="catalog-cards">
            {visible.map((e) => (
              <article className="catalog-card" key={e.id}>
                <div className="catalog-swatch" style={{ background: e.color }}>
                  {e.kind === "finish" && (
                    <img
                      key={e.revision}
                      alt=""
                      src={`/api/catalog/${e.id}/swatch?v=${e.revision}`}
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                  <span>{e.isDemo ? "DEMO" : "DATI OPERATORE"}</span>
                </div>
                <div>
                  <span className="eyebrow">
                    {e.kind === "manufacturer"
                      ? "PRODUTTORE"
                      : e.kind === "product"
                        ? "PRODOTTO"
                        : "FINITURA"}{" "}
                    ·{" "}
                    {e.status === "approved"
                      ? "APPROVATO"
                      : e.status === "draft"
                        ? "BOZZA"
                        : "ARCHIVIATO"}
                  </span>
                  <h3>{e.name}</h3>
                  <p>
                    {e.code} · {e.family || "Famiglia non indicata"}
                  </p>
                  {e.kind === "product" && (
                    <p>
                      {e.width} × {e.depth} × {e.height} mm
                    </p>
                  )}
                  <p className="hint">
                    {e.sourceReference || "Provenienza da completare"}
                    <br />
                    {e.license || "Diritti d’uso da completare"}
                  </p>
                  <div className="actions">
                    <button onClick={() => select(e)}>Gestisci {e.name}</button>
                    {e.status === "approved" &&
                      e.kind === "product" &&
                      onPlace && (
                        <button className="primary" onClick={() => onPlace(e)}>
                          Inserisci in pianta
                        </button>
                      )}
                    {e.status === "approved" &&
                      e.kind === "finish" &&
                      onFinish && (
                        <button className="primary" onClick={() => onFinish(e)}>
                          Applica finitura
                        </button>
                      )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {!visible.length && <p>Nessuna voce corrisponde ai filtri.</p>}
          <section className="csv-panel">
            <h3>Importazione CSV</h3>
            <p>
              Prima crea e approva il produttore. Le importazioni producono
              bozze: nessuna riga viene approvata automaticamente. Prodotti e
              finiture vanno importati in due passaggi se la finitura ne cita i
              codici.
            </p>
            <button onClick={template}>Scarica modello CSV</button>
            <label>
              File CSV UTF-8
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) =>
                  run(async () => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 500000) throw new Error("CSV massimo 500 KB");
                    setCsv(await f.text());
                    setReport(null);
                    setStatus("File caricato: verifica prima di importare");
                  })
                }
              />
            </label>
            <label>
              Contenuto CSV
              <textarea
                value={csv}
                onChange={(e) => {
                  setCsv(e.target.value);
                  setReport(null);
                }}
              />
            </label>
            <div className="actions">
              <button
                disabled={!csv}
                onClick={() =>
                  run(async () => {
                    setReport(
                      await request("/catalog/import", "POST", {
                        csv,
                        commit: false,
                      }),
                    );
                    setStatus("Verifica CSV completata");
                  })
                }
              >
                Verifica CSV
              </button>
              <button
                className="primary"
                disabled={
                  !report ||
                  !!report.errors.length ||
                  !report.valid ||
                  !!report.imported
                }
                onClick={() =>
                  run(async () => {
                    const r = await request("/catalog/import", "POST", {
                      csv,
                      commit: true,
                    });
                    setReport(r);
                    await refresh();
                    setStatus(
                      r.imported
                        ? "Importate " + r.imported + " bozze"
                        : "Importazione non eseguita: controlla gli errori",
                    );
                  })
                }
              >
                Importa bozze
              </button>
            </div>
            {report && (
              <div className="csv-report">
                <b>
                  {report.valid} righe valide · {report.imported} importate
                </b>
                {report.errors.map((e, i) => (
                  <p key={i}>
                    Riga {e.row}: {e.message}
                  </p>
                ))}
              </div>
            )}
          </section>
        </div>
        <aside className="catalog-form">
          <div className="actions">
            <h3>{entry.id ? "Modifica voce" : "Nuova voce"}</h3>
            <button
              onClick={() => {
                setEntry(empty());
                setHistory([]);
              }}
            >
              Nuova voce
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <fieldset disabled={locked}>
              <label>
                Tipo voce
                <select
                  value={entry.kind}
                  disabled={!!entry.id}
                  onChange={(e) =>
                    patch({
                      kind: e.target.value as Entry["kind"],
                      manufacturerId: "",
                      compatibleCodes: [],
                    })
                  }
                >
                  <option value="manufacturer">Produttore</option>
                  <option value="product">Prodotto</option>
                  <option value="finish">Finitura</option>
                </select>
              </label>
              <label>
                Nome voce
                <input
                  required
                  maxLength={150}
                  value={entry.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </label>
              <label>
                Codice voce
                <input
                  required
                  maxLength={100}
                  disabled={!!entry.id}
                  value={entry.code}
                  onChange={(e) => patch({ code: e.target.value })}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={entry.isDemo}
                  disabled={!!entry.id}
                  onChange={(e) =>
                    patch({ isDemo: e.target.checked, manufacturerId: "" })
                  }
                />{" "}
                Dato dimostrativo DEMO
              </label>
              {!entry.isDemo && (
                <p className="hint">
                  Inserisci esclusivamente dati forniti da fonti autorizzate.
                  L’approvazione è una dichiarazione dell’operatore, non una
                  verifica automatica del produttore.
                </p>
              )}
              {entry.kind !== "manufacturer" && (
                <label>
                  Produttore della voce
                  <select
                    required
                    disabled={!!entry.id}
                    value={entry.manufacturerId}
                    onChange={(e) => patch({ manufacturerId: e.target.value })}
                  >
                    <option value="">Seleziona…</option>
                    {manufacturers
                      .filter((e) => e.isDemo === entry.isDemo)
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                Famiglia
                <input
                  value={entry.family}
                  onChange={(e) => patch({ family: e.target.value })}
                />
              </label>
              {entry.kind === "product" && (
                <div className="pair">
                  {(["width", "depth", "height"] as const).map((key, i) => (
                    <label key={key}>
                      {["Larghezza mm", "Profondità mm", "Altezza mm"][i]}
                      <input
                        type="number"
                        required
                        min={1}
                        value={entry[key]}
                        onChange={(e) =>
                          patch({ [key]: Number(e.target.value) })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
              {entry.kind === "finish" && (
                <>
                  <label>
                    Colore campione
                    <input
                      type="color"
                      value={entry.color}
                      onChange={(e) => patch({ color: e.target.value })}
                    />
                  </label>
                  <label>
                    Codici prodotti compatibili (separati da |)
                    <input
                      value={entry.compatibleCodes.join("|")}
                      onChange={(e) =>
                        patch({
                          compatibleCodes: e.target.value
                            .split("|")
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                </>
              )}
              <label>
                Provenienza / documento fonte
                <textarea
                  value={entry.sourceReference}
                  onChange={(e) => patch({ sourceReference: e.target.value })}
                />
              </label>
              <label>
                Licenza / diritti d’uso
                <textarea
                  value={entry.license}
                  onChange={(e) => patch({ license: e.target.value })}
                />
              </label>
              <button className="primary" type="submit">
                Salva bozza
              </button>
            </fieldset>
          </form>
          {entry.id && (
            <div className="entry-approval">
              <p>
                Stato: {entry.status} · revisione {entry.revision}
              </p>
              {entry.status === "draft" ? (
                <button
                  className="primary"
                  onClick={() => save({ ...entry, status: "approved" })}
                >
                  Approva voce
                </button>
              ) : (
                <button onClick={() => save({ ...entry, status: "draft" })}>
                  Riapri come bozza
                </button>
              )}
              {entry.status !== "archived" && (
                <button onClick={() => save({ ...entry, status: "archived" })}>
                  Archivia voce
                </button>
              )}
              {entry.kind === "finish" && entry.status === "draft" && (
                <label>
                  Carica campione PNG/JPEG
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) =>
                      run(async () => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 2097152)
                          throw new Error("Campione massimo 2 MB");
                        const r = await fetch(
                          `/api/catalog/${entry.id}/swatch`,
                          {
                            method: "PUT",
                            headers: { "Content-Type": file.type },
                            body: file,
                          },
                        );
                        const data = await r.json();
                        if (!r.ok)
                          throw new Error(
                            data.detail || "Caricamento non riuscito",
                          );
                        setEntry(data);
                        await refresh();
                        setHistory(
                          await request("/catalog/" + entry.id + "/versions"),
                        );
                        setStatus("Campione salvato, metadati rimossi");
                      })
                    }
                  />
                </label>
              )}
              <details>
                <summary>Cronologia voce ({history.length})</summary>
                {history.map((h) => (
                  <p key={h.revision}>
                    Revisione {h.revision} · {h.name} · {h.status}
                  </p>
                ))}
              </details>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
