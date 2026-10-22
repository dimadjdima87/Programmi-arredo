"use client";
import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Line, Rect, Text, Group, Circle } from "react-konva";
import type Konva from "konva";
import Catalog, { type Entry } from "./catalog";
import Kitchen from "./kitchen";
import {
  demo,
  finishOnly,
  type Project,
  type Item,
  type Opening,
  type Board,
} from "./model";
const S = 0.125;
async function api(path: string, method = "GET", body?: unknown) {
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
        : Array.isArray(data.detail)
          ? data.detail
              .map((e: { msg: string }) => e.msg.replace("Value error, ", ""))
              .join(" · ")
          : "Operazione non riuscita",
    );
  return data;
}
function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}
export default function Studio() {
  const [desktopMode, setDesktopMode] = useState<boolean | null>(null);
  const [email, setEmail] = useState("designer@demo.local"),
    [password, setPassword] = useState("DemoStudio2026!"),
    [user, setUser] = useState("");
  const [p, setP] = useState<Project | null>(null),
    [list, setList] = useState<
      { id: string; title: string; revision: number }[]
    >([]),
    [past, setPast] = useState<Project[]>([]),
    [future, setFuture] = useState<Project[]>([]);
  const [selected, setSelected] = useState(""),
    [tab, setTab] = useState("plan"),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [versions, setVersions] = useState<{ revision: number; created: number }[]>(
      [],
    );
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState(false);
  const stage = useRef<Konva.Stage>(null);
  useEffect(() => {
    api("/health")
      .then((h) => setDesktopMode(h.desktop === true))
      .catch(() => setDesktopMode(false));
    api("/me")
      .then((u) => {
        setUser(u.email);
        refresh();
      })
      .catch(() => {
        api("/desktop-session", "POST")
          .then((u) => {
            setUser(u.email);
            refresh();
          })
          .catch(() => {});
      });
  }, []);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  async function refresh() {
    setList(await api("/projects"));
  }
  function edit(fn: (q: Project) => void) {
    if (!p) return;
    const q = structuredClone(p);
    fn(q);
    setPast([...past, p].slice(-100));
    setFuture([]);
    setP(q);
    setDirty(true);
    setStatus("Modifiche da salvare");
  }
  function accept(q: Project) {
    setP(q);
    setPast([]);
    setFuture([]);
    setSelected("");
    setDirty(false);
  }
  function canLeave() {
    return (
      !dirty ||
      window.confirm("Le modifiche non salvate verranno perse. Continuare?")
    );
  }
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
  async function load(id: string) {
    if (!canLeave()) return;
    await run(async () => {
      accept(await api("/projects/" + id));
      if (tab === "catalog" || tab === "kitchen") setTab("plan");
      setVersions(await api("/projects/" + id + "/versions"));
      setStatus("Progetto ricaricato dal database");
    });
  }
  async function save() {
    if (!p) return;
    await run(async () => {
      const data = await api(
        "/projects" + (p.id ? "/" + p.id : ""),
        p.id ? "PUT" : "POST",
        {
          title: p.title,
          brief: p.brief,
          scene: p.scene,
          expectedRevision: p.revision,
        },
      );
      setP(data);
      setDirty(false);
      setVersions(await api("/projects/" + data.id + "/versions"));
      await refresh();
      setStatus("Salvata revisione " + data.revision);
    });
  }
  function undo() {
    if (!p || !past.length) return;
    const q = past[past.length - 1];
    setFuture([p, ...future]);
    setPast(past.slice(0, -1));
    setP({ ...q, id: p.id, revision: p.revision });
    setDirty(true);
  }
  function redo() {
    if (!p || !future.length) return;
    setPast([...past, p]);
    setP({ ...future[0], id: p.id, revision: p.revision });
    setFuture(future.slice(1));
    setDirty(true);
  }
  const item = p?.scene.items.find((i) => i.id === selected),
    opening = p?.scene.openings.find((i) => i.id === selected);
  function updateItem(data: Partial<Item>) {
    if (item)
      edit((q) => {
        q.scene.items = q.scene.items.map((i) =>
          i.id === item.id ? { ...i, ...data } : i,
        );
      });
  }
  function updateOpening(data: Partial<Opening>) {
    if (opening)
      edit((q) => {
        q.scene.openings = q.scene.openings.map((o) =>
          o.id === opening.id ? { ...o, ...data } : o,
        );
      });
  }
  function addItem(
    label: string,
    width: number,
    depth: number,
    height: number,
  ) {
    const id = crypto.randomUUID();
    edit((q) => {
      q.scene.items.push({
        id,
        label: label + " · DEMO",
        x: 600,
        y: 600,
        width,
        depth,
        height,
        rotation: 0,
        finish: "#C5A77C",
        locked: false,
        verification: "DEMO",
      });
    });
    setSelected(id);
  }
  function placeCatalog(e: Entry) {
    if (!p) {
      setStatus("Crea o apri un progetto prima di inserire un prodotto");
      return;
    }
    const id = crypto.randomUUID();
    edit((q) => {
      q.scene.items.push({
        id,
        label: e.name + (e.isDemo ? " · DEMO" : ""),
        x: 600,
        y: 600,
        width: e.width,
        depth: e.depth,
        height: e.height,
        rotation: 0,
        finish: e.color,
        locked: false,
        verification: e.isDemo ? "DEMO" : "verified",
        catalogProduct: e,
      });
    });
    setSelected(id);
    setTab("plan");
  }
  function applyCatalogFinish(e: Entry) {
    if (!item || item.locked) {
      setStatus("Seleziona e sblocca un arredo prima di applicare la finitura");
      return;
    }
    if (
      !item.catalogProduct ||
      e.manufacturerId !== item.catalogProduct.manufacturerId ||
      !e.compatibleCodes.includes(item.catalogProduct.code)
    ) {
      setStatus("Compatibilità della finitura con il prodotto non documentata");
      return;
    }
    updateItem({ finish: e.color, catalogFinish: e });
    setTab("plan");
  }
  async function suggestCatalog() {
    await run(async () => {
      const data = await api("/catalog/suggestions", "POST");
      const catalog: Entry[] = await api("/catalog");
      edit((q) => {
        q.scene.moodboards = data.directions.map(
          (d: {
            title: string;
            palette: string[];
            productIds: string[];
            genericSuggestions: string[];
            provenance: Record<string, unknown>;
          }) => ({
            id: crypto.randomUUID(),
            title: d.title + " · DEMO",
            palette: d.palette,
            notes: d.genericSuggestions.join(" · "),
            approved: false,
            catalogReferences: catalog.filter((e) =>
              d.productIds.includes(e.id),
            ),
            provenance: d.provenance,
          }),
        );
      });
      setStatus("Proposte DEMO dal catalogo: verifica e approva manualmente");
    });
  }
  function addOpening(kind: "door" | "window") {
    const id = crypto.randomUUID();
    edit((q) => {
      q.scene.openings.push({
        id,
        kind,
        wallId: q.scene.walls[kind === "door" ? 0 : 2].id,
        offset: kind === "door" ? 300 : 1200,
        width: kind === "door" ? 800 : 1200,
        height: kind === "door" ? 2100 : 1200,
        sill: kind === "door" ? 0 : 1000,
        swing: "left",
      });
    });
    setSelected(id);
  }
  function exportPlan() {
    if (!p || !stage.current) return;
    download(
      stage.current.toDataURL({ pixelRatio: 2 }),
      "pianta-revisione-" + p.revision + ".png",
    );
  }
  function exportBoard(b: Board) {
    if (!p) return;
    const c = document.createElement("canvas");
    c.width = 1400;
    const ctx = c.getContext("2d")!;
    ctx.font = "23px sans-serif";
    const references = (b.catalogReferences || []).map(
      (r) =>
        `${r.name} · ${r.code} · revisione ${r.revision} · ${r.isDemo ? "DEMO" : "Approvazione operatore"} · Fonte: ${r.sourceReference} · Diritti: ${r.license}`,
    );
    const paragraphs = [b.notes, ...references];
    const lines: string[] = [];
    for (const paragraph of paragraphs) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        if (ctx.measureText(line + word).width > 1250 && line) {
          lines.push(line);
          line = "";
        }
        line += word + " ";
      }
      lines.push(line);
    }
    c.height = Math.max(900, 620 + lines.length * 32 + 150);
    ctx.fillStyle = "#f6f4ee";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#253e37";
    ctx.font = "24px sans-serif";
    ctx.fillText("ALBERTELLI / DESIGN STUDIO — DEMO", 60, 70);
    ctx.font = "42px sans-serif";
    ctx.fillText(b.title, 60, 150);
    const sw = 1280 / b.palette.length;
    b.palette.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(60 + i * sw, 210, sw - 25, 300);
      ctx.fillStyle = "#253e37";
      ctx.font = "22px sans-serif";
      ctx.fillText(color, 60 + i * sw, 550);
    });
    ctx.font = "23px sans-serif";
    lines.forEach((line, i) => ctx.fillText(line, 60, 620 + i * 32));
    ctx.font = "18px sans-serif";
    ctx.fillText(
      `${p.title} · revisione ${p.revision}${dirty ? " · modifiche non salvate" : ""} · ${b.approved ? "Approvata" : "Bozza"}`,
      60,
      c.height - 90,
    );
    ctx.fillText(
      "Concept dimostrativo. Catalogo dichiarato dall’operatore; prezzi e disponibilità sconosciuti.",
      60,
      c.height - 50,
    );
    download(c.toDataURL(), "moodboard-revisione-" + p.revision + ".png");
  }
  if (!user && desktopMode === null)
    return (
      <main className="login">
        <p>Avvio dello studio…</p>
      </main>
    );
  if (!user)
    return (
      <main className="login">
        <div className="login-art">
          <span className="eyebrow">ALBERTELLI ARREDAMENTI</span>
          <h1>Lo spazio prende forma.</h1>
          <p>Uno studio per disegnare, esplorare e dare ordine alle idee.</p>
          <div className="abstract">
            <div />
            <div />
            <div />
          </div>
          <small>DESIGN STUDIO / PROTOTIPO DEMO</small>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const u = await api(
                desktopMode ? "/desktop-session" : "/login",
                "POST",
                desktopMode ? undefined : { email, password },
              );
              setUser(u.email);
              await refresh();
              setStatus("");
            });
          }}
        >
          <span className="eyebrow">BENVENUTO NELLO STUDIO</span>
          <h2>{desktopMode ? "Studio locale" : "Accedi al tuo spazio"}</h2>
          <p>
            {desktopMode
              ? "I progetti sono conservati su questo computer. Puoi rientrare senza inserire credenziali."
              : "Ambiente dimostrativo, senza dati cliente reali."}
          </p>
          {!desktopMode && (
            <>
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
            </>
          )}
          <button className="primary" disabled={busy}>
            {desktopMode ? "Rientra nello studio →" : "Entra nello studio →"}
          </button>
          {!desktopMode && (
            <p className="hint">
              Account DEMO: designer@demo.local oppure viewer@demo.local
              <br />
              Password iniziale: DemoStudio2026!
            </p>
          )}
          <p role="status">{status}</p>
        </form>
      </main>
    );
  return (
    <div className="app" inert={busy}>
      <aside className="sidebar">
        <div className="brand">
          ALBERTELLI<span>DESIGN STUDIO</span>
        </div>
        <div className="demo-badge">{tab === "kitchen" ? "CATALOGO DELLO STUDIO" : "WORKSPACE DEMO"}</div>
        <button
          className="new"
          onClick={() => {
            if (canLeave()) {
              accept(demo());
              setTab("plan");
              setDirty(true);
              setVersions([]);
              setStatus("Nuova cucina: 4200 × 3600 mm");
            }
          }}
        >
          ＋ Nuovo progetto cucina
        </button>
        <button className="new" onClick={() => setTab("catalog")}>
          Catalogo e materiali
        </button>
        <button className={"new" + (tab === "kitchen" ? " active" : "")} onClick={() => setTab("kitchen")}>
          Albertelli Kitchen
        </button>
        <p className="eyebrow">I TUOI PROGETTI</p>
        <nav>
          {list.map((l) => (
            <button
              className={p?.id === l.id ? "active" : ""}
              key={l.id}
              onClick={() => load(l.id)}
            >
              {l.title}
              <small>Revisione {l.revision}</small>
            </button>
          ))}
          {!list.length && (
            <p className="hint">Il tuo primo progetto inizia qui.</p>
          )}
        </nav>
        <footer>
          <span>{user}</span>
          <button
            onClick={() => {
              if (canLeave())
                run(async () => {
                  await api("/logout", "POST");
                  setUser("");
                  setP(null);
                  setDirty(false);
                  setList([]);
                  setPast([]);
                  setFuture([]);
                  setSelected("");
                  setStatus(
                    desktopMode
                      ? "Sessione locale chiusa. Puoi rientrare senza password."
                      : "",
                  );
                });
            }}
          >
            Esci
          </button>
        </footer>
      </aside>
      <main className="workspace">
        <header>
          <div>
            <span className="eyebrow">PROGETTA / ESPLORA / COMPONI</span>
            <h1>{p?.title || "Il tuo studio di progettazione"}</h1>
          </div>
          {p && (
            <div className="actions">
              <span className="hint">
                {dirty ? "● Da salvare" : "✓ Salvato"} · rev. {p.revision}
              </span>
              <button disabled={!past.length || busy} onClick={undo}>
                Annulla
              </button>
              <button disabled={!future.length || busy} onClick={redo}>
                Ripristina
              </button>
              <button className="primary" onClick={save} disabled={busy}>
                Salva progetto
              </button>
            </div>
          )}
        </header>
        <div role="status" className="status">
          {status ||
            (tab === "kitchen" ? "Albertelli Kitchen · catalogo e appunti privati dello studio" : "Dati DEMO · misure in millimetri · nessun servizio IA esterno")}
        </div>
        {tab === "kitchen" ? (
          <Kitchen projectId={p?.id || ""} projectTitle={p?.title || ""} onBack={() => setTab("plan")} />
        ) : tab === "catalog" ? (
          <>
            <button className="catalog-back" onClick={() => setTab("plan")}>
              ← {p ? "Torna al progetto" : "Torna allo studio"}
            </button>
            <Catalog
              onPlace={p ? placeCatalog : undefined}
              onFinish={item ? applyCatalogFinish : undefined}
            />
          </>
        ) : !p ? (
          <section className="welcome">
            <span className="eyebrow">DALL’IDEA ALLO SPAZIO</span>
            <h2>
              Ogni progetto comincia
              <br />
              da una buona pianta.
            </h2>
            <p>
              Crea una cucina, definisci le misure e scopri due direzioni di
              stile.
            </p>
            <button
              className="primary"
              onClick={() => {
                accept(demo());
                setTab("plan");
                setDirty(true);
                setVersions([]);
              }}
            >
              Crea il primo progetto →
            </button>
            <div className="feature-row">
              <article>
                <b>01 / Disegna</b>
                <p>Geometria precisa, in millimetri.</p>
              </article>
              <article>
                <b>02 / Componi</b>
                <p>Arredi generici e palette modificabili.</p>
              </article>
              <article>
                <b>03 / Conserva</b>
                <p>Versioni e immagini del progetto.</p>
              </article>
            </div>
          </section>
        ) : (
          <>
            <div className="tabs">
              {[
                ["plan", "Pianta 2D"],
                ["mood", "Moodboard"],
                ["project", "Brief e versioni"],
                ["catalog", "Catalogo"],
                ["kitchen", "Albertelli Kitchen"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={tab === key ? "chosen" : ""}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "plan" && (
              <div className="editor">
                <section className="drawing">
                  <div className="toolbar">
                    <b>
                      Pianta tecnica <span className="hint">/ mm</span>
                    </b>
                    <div className="actions">
                      <button
                        onClick={() => setZoom(Math.max(0.4, zoom - 0.2))}
                        aria-label="Riduci zoom"
                      >
                        −
                      </button>
                      <span>{Math.round(zoom * 100)}%</span>
                      <button
                        onClick={() => setZoom(Math.min(2, zoom + 0.2))}
                        aria-label="Aumenta zoom"
                      >
                        ＋
                      </button>
                      <button
                        className={pan ? "chosen" : ""}
                        onClick={() => setPan(!pan)}
                      >
                        Sposta vista
                      </button>
                      <button onClick={exportPlan}>Esporta PNG</button>
                    </div>
                  </div>
                  <div className="canvas-wrap">
                    <Stage
                      ref={stage}
                      width={760}
                      height={650}
                      scaleX={zoom}
                      scaleY={zoom}
                      x={65}
                      y={70}
                      draggable={pan}
                      onMouseDown={(e) => {
                        if (e.target === e.target.getStage()) setSelected("");
                      }}
                    >
                      <Layer>
                        <Rect
                          x={-2000}
                          y={-2000}
                          width={10000}
                          height={10000}
                          fill="#f4f3ed"
                          listening={false}
                        />
                        {Array.from({ length: 31 }, (_, i) => (
                          <Group key={i}>
                            <Line
                              points={[i * 25, 0, i * 25, 750]}
                              stroke="#e5e6de"
                              strokeWidth={0.5}
                            />
                            <Line
                              points={[0, i * 25, 750, i * 25]}
                              stroke="#e5e6de"
                              strokeWidth={0.5}
                            />
                          </Group>
                        ))}
                        <Line
                          points={p.scene.walls.flatMap((w) => [
                            w.x * S,
                            w.y * S,
                          ])}
                          closed
                          fill="#fffefa"
                          stroke="#38564b"
                          strokeWidth={7}
                        />
                        {p.scene.walls.map((w, i) => {
                          const b =
                            p.scene.walls[(i + 1) % p.scene.walls.length];
                          return (
                            <Group key={w.id}>
                              <Text
                                x={((w.x + b.x) * S) / 2 - 40}
                                y={((w.y + b.y) * S) / 2 - 25}
                                text={
                                  Math.round(Math.hypot(b.x - w.x, b.y - w.y)) +
                                  " mm"
                                }
                                fontSize={13}
                                fill="#38564b"
                              />
                              <Circle
                                x={w.x * S}
                                y={w.y * S}
                                radius={5}
                                fill="#f9f8f0"
                                stroke="#38564b"
                              />
                            </Group>
                          );
                        })}
                        {p.scene.openings.map((o) => {
                          const i = p.scene.walls.findIndex(
                            (w) => w.id === o.wallId,
                          );
                          if (i < 0) return null;
                          const a = p.scene.walls[i],
                            b = p.scene.walls[(i + 1) % p.scene.walls.length],
                            length = Math.hypot(b.x - a.x, b.y - a.y),
                            dx = (b.x - a.x) / length,
                            dy = (b.y - a.y) / length;
                          return (
                            <Group key={o.id} onClick={() => setSelected(o.id)}>
                              <Line
                                points={[
                                  (a.x + dx * o.offset) * S,
                                  (a.y + dy * o.offset) * S,
                                  (a.x + dx * (o.offset + o.width)) * S,
                                  (a.y + dy * (o.offset + o.width)) * S,
                                ]}
                                stroke={
                                  selected === o.id
                                    ? "#D38A4F"
                                    : o.kind === "door"
                                      ? "#bd976d"
                                      : "#8eb5c2"
                                }
                                strokeWidth={12}
                                hitStrokeWidth={25}
                              />
                              <Text
                                x={(a.x + dx * o.offset) * S + 8}
                                y={(a.y + dy * o.offset) * S + 12}
                                text={
                                  (o.kind === "door" ? "Porta" : "Finestra") +
                                  " " +
                                  o.width
                                }
                                fontSize={11}
                              />
                            </Group>
                          );
                        })}
                        {p.scene.items.map((i) => (
                          <Group
                            key={i.id}
                            x={i.x * S}
                            y={i.y * S}
                            rotation={i.rotation}
                            draggable={!i.locked && !pan}
                            onClick={() => setSelected(i.id)}
                            onDragEnd={(e) => {
                              const x = Math.max(
                                  0,
                                  Math.round(e.target.x() / S / 50) * 50,
                                ),
                                y = Math.max(
                                  0,
                                  Math.round(e.target.y() / S / 50) * 50,
                                );
                              edit((q) => {
                                const a = q.scene.items.find(
                                  (a) => a.id === i.id,
                                )!;
                                a.x = x;
                                a.y = y;
                              });
                            }}
                          >
                            <Rect
                              width={i.width * S}
                              height={i.depth * S}
                              fill={i.finish}
                              stroke={selected === i.id ? "#c2753e" : "#6b726b"}
                              strokeWidth={selected === i.id ? 3 : 1}
                              cornerRadius={2}
                            />
                            <Line
                              points={[5, 8, i.width * S - 5, 8]}
                              stroke="#ffffffaa"
                            />
                            <Text
                              x={6}
                              y={20}
                              width={i.width * S - 10}
                              text={
                                i.label.replace(" · DEMO", "") +
                                (i.locked ? " 🔒" : "")
                              }
                              fontSize={11}
                              fill="#25332d"
                            />
                          </Group>
                        ))}
                        <Text
                          y={560}
                          text={`DEMO · ${p.title} · revisione ${p.revision}${dirty ? " · modifiche non salvate" : ""}`}
                          fontSize={12}
                          fill="#536359"
                        />
                      </Layer>
                    </Stage>
                  </div>
                  <p className="hint canvas-note">
                    Trascina gli arredi · griglia 200 mm · aggancio arredi 50 mm
                    · origine in alto a sinistra
                  </p>
                </section>
                <aside className="inspector">
                  <h3>Il tuo ambiente</h3>
                  <p className="hint">
                    Misure canoniche in millimetri. Le aperture non valide
                    impediscono il salvataggio.
                  </p>
                  <label>
                    Altezza stanza
                    <Num
                      value={p.scene.height}
                      onChange={(v) =>
                        edit((q) => {
                          q.scene.height = v;
                        })
                      }
                    />
                  </label>
                  <details>
                    <summary>Muri e vertici ({p.scene.walls.length})</summary>
                    {p.scene.walls.map((w, i) => (
                      <div className="vertex" key={w.id}>
                        <b>Muro {i + 1} · vertice iniziale</b>
                        <div className="pair">
                          <label>
                            X
                            <Num
                              value={w.x}
                              onChange={(v) =>
                                edit((q) => {
                                  q.scene.walls[i].x = v;
                                })
                              }
                            />
                          </label>
                          <label>
                            Y
                            <Num
                              value={w.y}
                              onChange={(v) =>
                                edit((q) => {
                                  q.scene.walls[i].y = v;
                                })
                              }
                            />
                          </label>
                        </div>
                        <button
                          disabled={p.scene.walls.length <= 3}
                          onClick={() =>
                            edit((q) => {
                              q.scene.walls.splice(i, 1);
                            })
                          }
                        >
                          Rimuovi vertice
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() =>
                        edit((q) => {
                          const a = q.scene.walls[0],
                            b = q.scene.walls[1];
                          q.scene.walls.splice(1, 0, {
                            id: crypto.randomUUID(),
                            x: (a.x + b.x) / 2,
                            y: (a.y + b.y) / 2,
                          });
                        })
                      }
                    >
                      ＋ Dividi primo muro
                    </button>
                  </details>
                  <h4>Aperture</h4>
                  <div className="pair">
                    <button onClick={() => addOpening("door")}>＋ Porta</button>
                    <button onClick={() => addOpening("window")}>
                      ＋ Finestra
                    </button>
                  </div>
                  {p.scene.openings.map((o) => (
                    <button
                      className="object"
                      key={o.id}
                      onClick={() => setSelected(o.id)}
                    >
                      {o.kind === "door" ? "Porta" : "Finestra"} · {o.width} mm
                    </button>
                  ))}
                  <h4>Catalogo dimostrativo</h4>
                  <p className="hint">Volumi generici, senza marchio o SKU.</p>
                  {[
                    ["Base cucina", 600, 600, 870],
                    ["Colonna", 600, 600, 2100],
                    ["Tavolo", 1400, 800, 750],
                  ].map(([label, w, d, h]) => (
                    <button
                      className="object"
                      key={label}
                      onClick={() =>
                        addItem(
                          label as string,
                          w as number,
                          d as number,
                          h as number,
                        )
                      }
                    >
                      ＋ {label}{" "}
                      <small>
                        {w} × {d} × {h} mm · DEMO
                      </small>
                    </button>
                  ))}
                  {p.scene.items.map((i) => (
                    <button
                      className="object"
                      key={i.id}
                      onClick={() => setSelected(i.id)}
                    >
                      {i.label}
                      {i.locked ? " · bloccato" : ""}
                    </button>
                  ))}
                  {item && (
                    <section className="properties">
                      <h4>Elemento selezionato</h4>
                      <b>{item.label}</b>
                      {item.catalogProduct && (
                        <p className="hint">
                          Catalogo: {item.catalogProduct.code} · revisione{" "}
                          {item.catalogProduct.revision}
                          <br />
                          {item.catalogProduct.sourceReference}
                        </p>
                      )}
                      <label>
                        <input
                          type="checkbox"
                          checked={item.locked}
                          onChange={(e) =>
                            updateItem({ locked: e.target.checked })
                          }
                        />{" "}
                        Blocca elemento
                      </label>
                      {item.locked && (
                        <p className="hint">
                          Per modificare un elemento già salvato come bloccato,
                          sbloccalo e salva prima di cambiarlo.
                        </p>
                      )}
                      <fieldset disabled={item.locked}>
                        <div className="pair">
                          <label>
                            X
                            <Num
                              value={item.x}
                              onChange={(v) => updateItem({ x: v })}
                            />
                          </label>
                          <label>
                            Y
                            <Num
                              value={item.y}
                              onChange={(v) => updateItem({ y: v })}
                            />
                          </label>
                        </div>
                        <label>
                          Rotazione °
                          <Num
                            value={item.rotation}
                            min={-360}
                            onChange={(v) => updateItem({ rotation: v })}
                          />
                        </label>
                        <div className="pair">
                          <label>
                            Larghezza
                            <Num
                              value={item.width}
                              onChange={(v) => updateItem({ width: v })}
                            />
                          </label>
                          <label>
                            Profondità
                            <Num
                              value={item.depth}
                              onChange={(v) => updateItem({ depth: v })}
                            />
                          </label>
                        </div>
                        <label>
                          Altezza
                          <Num
                            value={item.height}
                            onChange={(v) => updateItem({ height: v })}
                          />
                        </label>
                        <label>
                          Finitura DEMO
                          <input
                            type="color"
                            value={item.finish}
                            onChange={(e) =>
                              edit((q) => {
                                q.scene = finishOnly(
                                  q.scene,
                                  item.id,
                                  e.target.value,
                                );
                              })
                            }
                          />
                        </label>
                        <button
                          onClick={() => {
                            edit((q) => {
                              q.scene.items = q.scene.items.filter(
                                (i) => i.id !== item.id,
                              );
                            });
                            setSelected("");
                          }}
                        >
                          Rimuovi elemento
                        </button>
                      </fieldset>
                    </section>
                  )}
                  {opening && (
                    <section className="properties">
                      <h4>Apertura selezionata</h4>
                      <label>
                        Muro
                        <select
                          value={opening.wallId}
                          onChange={(e) =>
                            updateOpening({ wallId: e.target.value })
                          }
                        >
                          {p.scene.walls.map((w, i) => (
                            <option key={w.id} value={w.id}>
                              Muro {i + 1}
                            </option>
                          ))}
                        </select>
                      </label>
                      {(["offset", "width", "height", "sill"] as const).map(
                        (key, i) => (
                          <label key={key}>
                            {
                              [
                                "Distanza inizio muro",
                                "Larghezza",
                                "Altezza",
                                "Davanzale",
                              ][i]
                            }
                            <Num
                              value={opening[key]}
                              onChange={(v) => updateOpening({ [key]: v })}
                            />
                          </label>
                        ),
                      )}
                      {opening.kind === "door" && (
                        <label>
                          Apertura
                          <select
                            value={opening.swing}
                            onChange={(e) =>
                              updateOpening({
                                swing: e.target.value as "left" | "right",
                              })
                            }
                          >
                            <option value="left">Sinistra</option>
                            <option value="right">Destra</option>
                          </select>
                        </label>
                      )}
                      <button
                        onClick={() => {
                          edit((q) => {
                            q.scene.openings = q.scene.openings.filter(
                              (o) => o.id !== opening.id,
                            );
                          });
                          setSelected("");
                        }}
                      >
                        Rimuovi apertura
                      </button>
                    </section>
                  )}
                </aside>
              </div>
            )}
            {tab === "mood" && (
              <section className="mood-section">
                <div className="section-title">
                  <div>
                    <span className="eyebrow">DUE DIREZIONI, IL TUO STILE</span>
                    <h2>Materia e colore</h2>
                    <p>
                      Proposte deterministiche DEMO. Modifica la palette e
                      approva il tuo concept.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        "Sostituire le moodboard correnti con due proposte DEMO? Puoi annullare la modifica.",
                      )
                    )
                      suggestCatalog();
                  }}
                >
                  Proponi dal catalogo · DEMO
                </button>
                <div className="boards">
                  {p.scene.moodboards.map((b, index) => (
                    <article className="board" key={b.id}>
                      <div
                        className="board-art"
                        style={{ background: b.palette[1] }}
                      >
                        <div
                          className="swatch-main"
                          style={{ background: b.palette[0] }}
                        />
                        <div
                          className="swatch-round"
                          style={{ background: b.palette[2] }}
                        />
                        <div
                          className="swatch-accent"
                          style={{ background: b.palette[3] }}
                        />
                        <span>ISPIRAZIONE CONCETTUALE / DEMO</span>
                      </div>
                      <div className="board-body">
                        <span className="eyebrow">
                          DIREZIONE 0{index + 1} ·{" "}
                          {b.approved ? "APPROVATA" : "BOZZA"}
                        </span>
                        <h3>{b.title}</h3>
                        {b.catalogReferences?.map((ref) => (
                          <p className="catalog-ref" key={ref.id}>
                            {ref.name} · {ref.code} ·{" "}
                            {ref.isDemo ? "DEMO" : "Catalogo approvato"} · rev.{" "}
                            {ref.revision}
                          </p>
                        ))}
                        {b.provenance && (
                          <p className="hint">
                            Provider: {String(b.provenance.provider)} ·
                            Suggerimento dimostrativo, senza IA esterna
                          </p>
                        )}
                        <div className="palette">
                          {b.palette.map((color, j) => (
                            <label key={j}>
                              Colore {j + 1}
                              <input
                                aria-label={`Palette ${index + 1} colore ${j + 1}`}
                                type="color"
                                value={color}
                                onChange={(e) =>
                                  edit((q) => {
                                    q.scene.moodboards[index].palette[j] =
                                      e.target.value;
                                    q.scene.moodboards[index].approved = false;
                                  })
                                }
                              />
                              <small>{color}</small>
                            </label>
                          ))}
                        </div>
                        <label>
                          Materiali, motivazioni e note
                          <textarea
                            value={b.notes}
                            onChange={(e) =>
                              edit((q) => {
                                q.scene.moodboards[index].notes =
                                  e.target.value;
                                q.scene.moodboards[index].approved = false;
                              })
                            }
                          />
                        </label>
                        <p className="hint">
                          Campioni procedurali e ispirazioni generiche. Prezzi,
                          disponibilità e codici commerciali non verificati.
                        </p>
                        <div className="actions">
                          <button
                            onClick={() =>
                              edit((q) => {
                                q.scene.moodboards[index].approved =
                                  !b.approved;
                              })
                            }
                          >
                            {b.approved ? "Riapri bozza" : "Approva concept"}
                          </button>
                          <button
                            className="primary"
                            onClick={() => exportBoard(b)}
                          >
                            Esporta PNG
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {tab === "project" && (
              <section className="project-panel">
                <article>
                  <h2>Il brief del progetto</h2>
                  <label>
                    Nome progetto
                    <input
                      value={p.title}
                      maxLength={150}
                      onChange={(e) =>
                        edit((q) => {
                          q.title = e.target.value;
                        })
                      }
                    />
                  </label>
                  <label>
                    Priorità e desideri
                    <textarea
                      value={p.brief}
                      maxLength={4000}
                      onChange={(e) =>
                        edit((q) => {
                          q.brief = e.target.value;
                        })
                      }
                    />
                  </label>
                  <p className="hint">
                    Non inserire dati personali reali nell’ambiente DEMO.
                  </p>
                  <button
                    onClick={() => {
                      const url = URL.createObjectURL(
                        new Blob([JSON.stringify(p, null, 2)], {
                          type: "application/json",
                        }),
                      );
                      download(
                        url,
                        "progetto-revisione-" + p.revision + ".json",
                      );
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Esporta progetto JSON
                  </button>
                </article>
                <article>
                  <h2>Versioni salvate</h2>
                  <p>
                    Ogni salvataggio conserva una fotografia immutabile. Un
                    ripristino crea una nuova revisione.
                  </p>
                  {p.id && (
                    <button onClick={() => load(p.id!)}>
                      Ricarica dal database
                    </button>
                  )}
                  {!versions.length && (
                    <p>Salva il progetto per creare la prima versione.</p>
                  )}
                  {versions.map((v) => (
                    <div className="version" key={v.revision}>
                      <span>
                        Revisione {v.revision}
                        <small>
                          {new Date(v.created * 1000).toLocaleString("it-IT")}
                        </small>
                      </span>
                      <button
                        disabled={busy || v.revision === p.revision}
                        onClick={() => {
                          if (!canLeave()) return;
                          run(async () => {
                            const q = await api(
                              `/projects/${p.id}/restore/${v.revision}`,
                              "POST",
                              { expectedRevision: p.revision },
                            );
                            accept(q);
                            setVersions(
                              await api(`/projects/${p.id}/versions`),
                            );
                            await refresh();
                            setStatus(
                              "Versione ripristinata come revisione " +
                                q.revision,
                            );
                          });
                        }}
                      >
                        Ripristina versione {v.revision}
                      </button>
                    </div>
                  ))}
                </article>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
function Num({
  value,
  onChange,
  min = 0,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  return (
    <input
      type="number"
      min={min}
      step="1"
      value={value}
      onChange={(e) => {
        if (e.target.value !== "" && Number.isFinite(e.target.valueAsNumber))
          onChange(e.target.valueAsNumber);
      }}
    />
  );
}
