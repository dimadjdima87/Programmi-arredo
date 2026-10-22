"use client";

import { useEffect, useRef, useState } from "react";

type Cell = { group: string; raw: string; points: string | null; available: boolean | null; crossChecked: boolean; visuallyVerified?: boolean };
type KitchenItem = {
  id: string; code: string; codeKind?: string; rowLabel: string; variant?: string;
  supplementCode?: string; page: number; reference: string; section: string; category: string;
  numericStatus: string; groupKind: string; cells: Cell[]; context?: string;
  pricingRules?: { type: string; percent: string; basisReference: { page: number } }[];
};
type Category = { id: string; label: string; count: number; pages?: number };
type Library = {
  installed: boolean; datasetHash?: string; edition?: string; articleOccurrences?: number;
  kitchenPages?: number; numericCrossChecked?: number; categories: Category[];
  sections?: { category: string; section: string }[];
};
type Preview = { datasetHash: string; currentDatasetHash: string; edition: string; articleOccurrences: number; kitchenPages: number; alreadyInstalled: boolean };
type SourcePage = { page: number; reference: string; section: string; display_text?: string };
type Pick = { id: string; projectId: string; quantity: number; note: string; revision: number; snapshot: KitchenItem };
const labels: Record<string, string> = {
  cross_checked: "Valori controllati", visual_checked: "Verificato sulla pagina",
  rule_checked: "Regola percentuale", not_listed: "Punti non indicati", needs_review: "Da verificare",
};
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch("/api/kitchen" + path, { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Operazione non riuscita: verifica i dati");
  return data;
}
const jsonBody = (method: string, data: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
const format = (value: string) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: 4 }).format(Number(value));

function PickEditor({ pick, onSave, onRemove, onOpen }: {
  pick: Pick; onSave: (p: Pick, quantity: number, note: string) => Promise<void>;
  onRemove: (p: Pick) => Promise<void>; onOpen: () => void;
}) {
  const [quantity, setQuantity] = useState(pick.quantity), [note, setNote] = useState(pick.note);
  const [working, setWorking] = useState(false);
  return <article className="k-pick">
    <button className="k-link" onClick={onOpen}><b>{pick.snapshot.code}</b> · {pick.snapshot.rowLabel}</button>
    <p className="hint">{pick.snapshot.variant} · pagina {pick.snapshot.page} · {pick.snapshot.reference}</p>
    <form onSubmit={async e => { e.preventDefault(); setWorking(true); try { await onSave(pick, quantity, note); } finally { setWorking(false); } }}>
      <label>Quantità<input type="number" min={1} max={1000} step={1} value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></label>
      <label>Note per questo articolo<textarea maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></label>
      <div className="actions"><button disabled={working || (quantity === pick.quantity && note === pick.note)}>Salva note e quantità</button><button type="button" disabled={working} onClick={async () => { setWorking(true); try { await onRemove(pick); } finally { setWorking(false); } }}>Rimuovi dall’elenco</button></div>
    </form>
  </article>;
}

export default function Kitchen({ projectId, projectTitle, onBack }: { projectId: string; projectTitle: string; onBack: () => void }) {
  const [library, setLibrary] = useState<Library | null>(null), [preview, setPreview] = useState<Preview | null>(null);
  const file = useRef<File | null>(null), fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [mode, setMode] = useState("items"), [query, setQuery] = useState(""), [category, setCategory] = useState("");
  const [section, setSection] = useState(""), [state, setState] = useState(""), [offset, setOffset] = useState(0);
  const [items, setItems] = useState<KitchenItem[]>([]), [pages, setPages] = useState<SourcePage[]>([]), [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false), [selected, setSelected] = useState<KitchenItem | null>(null), [source, setSource] = useState<SourcePage | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]), [change, setChange] = useState(0);
  const detailRequest = useRef(0);

  async function loadStatus() { setLibrary(await request<Library>("/status")); }
  useEffect(() => { loadStatus().catch(e => setMessage(e.message)); }, []);
  useEffect(() => {
    if (!library?.installed) return;
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        if (mode === "favorites" || mode === "project") {
          const result = await request<Pick[]>("/picks?" + new URLSearchParams({ projectId: mode === "project" ? projectId : "" }), { signal: controller.signal });
          setPicks(result); setTotal(result.length);
        } else {
          const params = new URLSearchParams({ q: query, categoryId: category, section, state, offset: String(offset) });
          if (mode === "pages") {
            const result = await request<{ total: number; items: SourcePage[] }>("/pages?" + params, { signal: controller.signal });
            setPages(result.items); setTotal(result.total);
          } else {
            const result = await request<{ total: number; items: KitchenItem[] }>("/items?" + params, { signal: controller.signal });
            setItems(result.items); setTotal(result.total);
          }
        }
      } catch (e) { if (!controller.signal.aborted) setMessage(e instanceof Error ? e.message : "Ricerca non riuscita"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [library, mode, query, category, section, state, offset, projectId, change]);

  async function action(fn: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await fn(); } catch (e) { setMessage(e instanceof Error ? e.message : "Operazione non riuscita"); }
    finally { setBusy(false); }
  }
  async function choose(chosen?: File) {
    if (!chosen) return;
    file.current = null; setPreview(null);
    if (chosen.size > 20 * 1024 * 1024) { setMessage("Il pacchetto deve essere inferiore a 20 MB"); return; }
    await action(async () => {
      const report = await request<Preview>("/import", { method: "POST", headers: { "Content-Type": "application/zip" }, body: chosen });
      file.current = chosen; setPreview(report);
      setMessage("Pacchetto riconosciuto. Controlla il riepilogo e conferma il caricamento.");
    });
  }
  async function confirmImport() {
    if (!file.current || !preview) return;
    const chosen = file.current, expected = preview.currentDatasetHash;
    await action(async () => {
      await request("/import?" + new URLSearchParams({ commit: "true", expected }), { method: "POST", headers: { "Content-Type": "application/zip" }, body: chosen });
      setPreview(null); file.current = null; setSelected(null); setSource(null);
      await loadStatus(); setMessage("Catalogo Albertelli Kitchen caricato e disponibile nello studio.");
    });
  }
  async function openItem(id: string) {
    const version = ++detailRequest.current;
    try {
      const item = await request<KitchenItem>("/items/" + encodeURIComponent(id));
      if (version !== detailRequest.current) return;
      setSelected(item); setSource(null);
      const page = await request<SourcePage>("/pages/" + item.page);
      if (version === detailRequest.current) setSource(page);
    } catch (e) { if (version === detailRequest.current) setMessage(e instanceof Error ? e.message : "Articolo non disponibile"); }
  }
  async function openPage(page: number) {
    const version = ++detailRequest.current;
    try {
      const result = await request<SourcePage>("/pages/" + page);
      if (version === detailRequest.current) { setSource(result); setSelected(null); }
    } catch (e) { setMessage(e instanceof Error ? e.message : "Pagina non disponibile"); }
  }
  async function addPick(project: string) {
    if (!selected) return;
    await action(async () => {
      const result = await request<{ alreadyPresent: boolean }>("/picks", jsonBody("POST", { occurrenceId: selected.id, projectId: project }));
      setMessage(result.alreadyPresent ? "Articolo già presente nell’elenco" : project ? "Articolo aggiunto all’elenco del progetto" : "Articolo salvato nei preferiti");
      setChange(n => n + 1);
    });
  }
  async function savePick(pick: Pick, quantity: number, note: string) {
    await action(async () => {
      await request("/picks/" + pick.id, jsonBody("PUT", { expectedRevision: pick.revision, quantity, note }));
      setChange(n => n + 1); setMessage("Elenco aggiornato");
    });
  }
  async function removePick(pick: Pick) {
    await action(async () => {
      await request("/picks/" + pick.id + "?expectedRevision=" + pick.revision, { method: "DELETE" });
      setChange(n => n + 1); setMessage("Articolo rimosso dall’elenco");
    });
  }
  function exportPicks() {
    const content = JSON.stringify({ catalogo: "Albertelli Kitchen", edizione: library?.edition, progetto: mode === "project" ? projectTitle : "Preferiti", articoli: picks }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "Albertelli-Kitchen-Elenco.json"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function selectMode(value: string) { setMode(value); setOffset(0); setMessage(""); }

  return <section className="kitchen" aria-label="Catalogo Albertelli Kitchen" aria-busy={busy}>
    <button className="k-link" onClick={onBack}>← {projectTitle ? "Torna al progetto" : "Torna allo studio"}</button>
    <div className="k-heading"><div><span className="eyebrow">BIBLIOTECA DELLO STUDIO</span><h2>Albertelli Kitchen</h2><p>Articoli, varianti e riferimenti per progettare le nostre cucine.</p></div>
      <div><input ref={fileInput} className="k-file" type="file" accept=".zip,application/zip" aria-label="Pacchetto catalogo Albertelli Kitchen" onChange={e => { void choose(e.target.files?.[0]); e.target.value = ""; }} /><button disabled={busy} onClick={() => fileInput.current?.click()}>{library?.installed ? "Carica pacchetto catalogo" : "Carica catalogo 2026"}</button></div>
    </div>
    <p role="status" className="k-message">{busy ? "Caricamento e controllo del catalogo in corso…" : message}</p>
    {preview && <section className="k-import"><h3>Catalogo riconosciuto · {preview.edition}</h3><p>{preview.articleOccurrences.toLocaleString("it-IT")} righe e varianti · {preview.kitchenPages} pagine cucina.</p><p>Il catalogo viene conservato nei dati locali dello studio, insieme ai backup. Preferiti e articoli già scelti mantengono i loro riferimenti.</p><div className="actions"><button className="primary" disabled={busy} onClick={confirmImport}>Conferma caricamento</button><button disabled={busy} onClick={() => { setPreview(null); file.current = null; }}>Annulla caricamento</button></div></section>}
    {!library?.installed ? <div className="k-empty"><span className="eyebrow">IL MANUALE, DENTRO LO STUDIO</span><h3>Tutto il catalogo cucina in un solo spazio.</h3><p>Carica il pacchetto <b>Albertelli-Kitchen-Catalogo-2026.zip</b> già preparato. Dopo il caricamento potrai consultarlo senza Internet.</p><div className="k-intro"><div><b>Trova</b><p>Cerca per codice, sigla, descrizione o nota.</p></div><div><b>Controlla</b><p>Confronta gruppi, punti e condizioni della fonte.</p></div><div><b>Raccogli</b><p>Conserva preferiti ed elenchi degli articoli per progetto.</p></div></div></div> : <>
      <div className="k-meta"><span>EDIZIONE {library.edition}</span><span>{library.articleOccurrences?.toLocaleString("it-IT")} righe e varianti</span><span>{library.kitchenPages} pagine cucina</span></div>
      <div className="k-modes" role="group" aria-label="Viste del catalogo">{[["items", "Catalogo"], ["pages", "Manuale e note"], ["favorites", "Preferiti"], ...(projectId ? [["project", "Articoli del progetto"]] : [])].map(([key, label]) => <button key={key} aria-pressed={mode === key} className={mode === key ? "primary" : ""} onClick={() => selectMode(key)}>{label}</button>)}</div>
      {mode === "project" && <p className="k-project-label">Elenco per <b>{projectTitle}</b> · le quantità sono separate dalla geometria della pianta.</p>}
      <div className="k-layout"><aside className="k-categories"><h3>Le nostre cucine</h3><button className={!category ? "chosen" : ""} onClick={() => { setCategory(""); setSection(""); setOffset(0); selectMode(mode === "pages" ? "pages" : "items"); }}>Tutto il catalogo</button>{library.categories.map(c => <button key={c.id} className={category === c.id ? "chosen" : ""} onClick={() => { setCategory(c.id); setSection(""); setOffset(0); selectMode(mode === "pages" || !c.count ? "pages" : "items"); }}>{c.label}<span>{c.count ? c.count.toLocaleString("it-IT") : (c.pages || 0) + " pagine"}</span></button>)}<p>La pagina originale resta il riferimento per disponibilità, misure e condizioni.</p></aside>
        <div className="k-content">
          {(mode === "items" || mode === "pages") && <div className="k-filters"><label>Cerca nel catalogo<input type="search" value={query} placeholder="Codice, sigla, descrizione…" onChange={e => { setQuery(e.target.value); setOffset(0); }} /></label>{mode === "items" && <><label>Sezione<select value={section} onChange={e => { setSection(e.target.value); setOffset(0); }}><option value="">Tutte le sezioni</option>{library.sections?.filter(s => !category || s.category === category).map(s => <option key={s.category + s.section} value={s.section}>{s.section}</option>)}</select></label><label>Verifica dei valori<select value={state} onChange={e => { setState(e.target.value); setOffset(0); }}><option value="">Tutti</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></>}</div>}
          <div className="k-result-heading"><p className="hint" aria-live="polite">{loading ? "Ricerca in corso…" : total.toLocaleString("it-IT") + (mode === "pages" ? " pagine" : " voci")}</p>{(mode === "favorites" || mode === "project") && <div className="actions"><button onClick={() => setChange(n => n + 1)}>Aggiorna elenco</button>{picks.length > 0 && <button onClick={exportPicks}>Esporta elenco</button>}</div>}</div>
          <div className="k-results" aria-label="Risultati del catalogo" aria-busy={loading}>
            {mode === "items" && items.map(r => <button className={"k-result" + (selected?.id === r.id ? " selected" : "")} key={r.id} onClick={() => void openItem(r.id)}><span className="k-result-code">{r.codeKind === "handle_number" ? "MANIGLIA " : "CODICE "}{r.code}</span><strong>{r.rowLabel || r.section}</strong><span>{r.variant && r.variant + " · "}{r.section}</span><small>Pagina {r.page} · {r.reference}</small><em>{labels[r.numericStatus]}</em></button>)}
            {mode === "pages" && pages.map(p => <button className="k-result" key={p.page} onClick={() => void openPage(p.page)}><span className="k-result-code">PAGINA {p.page}</span><strong>{p.section}</strong><small>{p.reference}</small></button>)}
            {(mode === "favorites" || mode === "project") && picks.map(p => <PickEditor key={p.id + ":" + p.revision} pick={p} onSave={savePick} onRemove={removePick} onOpen={() => void openItem(p.snapshot.id)} />)}
            {!loading && !total && <div className="k-no-results">{mode === "favorites" || mode === "project" ? "Scegli un articolo dal catalogo e aggiungilo a questo elenco." : "Nessun risultato. Prova un altro termine o cerca in Manuale e note."}</div>}
          </div>
          {(mode === "items" || mode === "pages") && <div className="k-pagination"><button disabled={offset === 0 || loading} onClick={() => setOffset(n => Math.max(0, n - 40))}>← Precedenti</button><span>{total ? offset + 1 : 0}–{Math.min(offset + 40, total)} di {total}</span><button disabled={offset + 40 >= total || loading} onClick={() => setOffset(n => n + 40)}>Successivi →</button></div>}
        </div>
        <article className="k-detail" aria-label="Dettaglio del catalogo">
          {selected ? <><span className="eyebrow">{selected.codeKind === "handle_number" ? "MANIGLIA / POMELLO" : "ARTICOLO"}</span><h3>{selected.code}</h3><p>{selected.rowLabel}</p>{selected.variant && <p><b>Variante {selected.variant}</b></p>}{selected.supplementCode && <p>Codice supplemento: <b>{selected.supplementCode}</b></p>}<span className="k-verification">{labels[selected.numericStatus]}</span>
            {selected.cells.length > 0 && <div className="k-table-scroll"><table><thead><tr><th>{selected.groupKind === "price_group" ? "Gruppo prezzi" : selected.groupKind === "color_group" ? "Gruppo colori" : selected.groupKind === "surface" ? "Superficie" : "Voce"}</th><th>Punti</th></tr></thead><tbody>{selected.cells.map(c => <tr key={c.group}><td>{c.group === "single" ? "Articolo" : c.group}</td><td>{c.available === false ? "Non disponibile" : c.points !== null ? format(c.points) : c.raw || "Da verificare"}</td></tr>)}</tbody></table></div>}
            {selected.pricingRules?.map((rule, i) => <p className="k-rule" key={i}>Maggiorazione <b>{rule.percent}%</b><br /><button className="k-link" onClick={() => void openPage(rule.basisReference.page)}>Condizioni a pagina {rule.basisReference.page}</button></p>)}
            {!selected.cells.length && !selected.pricingRules?.length && <p>I punti non sono indicati nella scheda estratta. Consulta le condizioni della pagina.</p>}
            <div className="k-detail-actions"><button disabled={busy} onClick={() => void addPick("")}>Salva nei preferiti</button>{projectId && <button className="primary" disabled={busy} onClick={() => void addPick(projectId)}>Aggiungi agli articoli del progetto</button>}</div>
            {projectTitle && !projectId && <p className="hint">Salva il progetto per raccogliere i suoi articoli.</p>}
            <p className="k-note">I punti sono valori del listino. Per utilizzare il pezzo verifica gruppo, dimensioni, finitura e note applicabili.</p>
          </> : source ? <><span className="eyebrow">MANUALE DI RIFERIMENTO</span><h3>{source.section}</h3></> : <><span className="eyebrow">DAL MANUALE AL PROGETTO</span><h3>Ogni scelta ha un riferimento.</h3><p>Apri una voce per confrontare le varianti e consultare la pagina del manuale.</p><p>I preferiti raccolgono gli articoli ricorrenti. L’elenco del progetto conserva quantità, note e dati della scelta.</p></>}
          {source && <details className="k-source" open={!selected}><summary>Pagina {source.page} · {source.reference || "riferimento originale"}</summary><pre>{source.display_text}</pre></details>}
          {selected && <p className="hint">Pagina {selected.page} · {selected.reference}. I dati del manuale sono conservati; gli elenchi non modificano gli ingombri della pianta.</p>}
        </article>
      </div>
    </>}
  </section>;
}
