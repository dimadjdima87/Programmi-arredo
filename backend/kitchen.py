"""Private kitchen reference library, indexed locally without executing uploads."""

from contextlib import closing, contextmanager
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import time
from uuid import uuid4
import zipfile
import zlib

from fastapi import Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

MAX_UPLOAD = 20 * 1024 * 1024
MAX_JSON = 50 * 1024 * 1024
SOURCE_HASH = "ce4a42c404d6c41565d523d1c2ad08f116dbcc4318f6c85dbfcdb34dcecdd2c4"
# A fingerprint, not the catalog: only the privately prepared and audited data
# can be imported. No provider file, URL or catalog content is shipped here.
DATASETS = {"ad35a878b9aba524e86f34ffe8aaaed9e0c54d05c1e1a1e008f3515c3c70f9e5": SOURCE_HASH}
CATEGORIES = {
    "bases": "Basi", "tall": "Colonne e semicolonne", "wall": "Pensili",
    "worktops": "Piani e rivestimenti", "fronts": "Ante e finiture",
    "complements": "Fianchi e complementi", "accessories": "Maniglie e accessori",
    "handleless": "Cucine senza maniglie", "spares": "Frontali e ricambi",
    "technical": "Regole e progettazione",
}
STATES = {"cross_checked", "visual_checked", "rule_checked", "not_listed", "needs_review"}


def category(page):
    if 45 <= page <= 147:
        return "fronts"
    if 148 <= page <= 158 or 293 <= page <= 338:
        return "worktops"
    if 159 <= page <= 190:
        return "accessories"
    for start, end, key in [(191, 292, "bases"), (339, 390, "complements"),
                             (391, 564, "tall"), (565, 652, "wall"),
                             (653, 840, "handleless"), (1025, 1066, "spares")]:
        if start <= page <= end:
            return key
    return "technical"


def visible(value):
    value = re.sub(r"(?:https?://|www\.)[^\s<>]*nobilia[^\s<>]*|[\w.+-]+@[^\s<>]*nobilia[^\s<>]*",
                   "[riferimento nella fonte originale]", value, flags=re.I)
    return re.sub(r"nobilia(?:-Werke)?", "Albertelli Kitchen", value, flags=re.I)


def checked_string(value, maximum=10000):
    if not isinstance(value, str) or len(value) > maximum:
        raise ValueError("Testo di catalogo non valido")
    return value


def parse_package(content):
    """Read one bounded JSON entry; uploaded HTML and SQLite are never opened."""
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            infos = archive.infolist()
            names = [i.filename for i in infos]
            if len(names) > 12 or len(names) != len(set(names)):
                raise ValueError("Archivio duplicato o non valido")
            if any("/" in n or "\\" in n or n.startswith(".") for n in names):
                raise ValueError("Struttura del pacchetto non valida")
            if sum(i.file_size for i in infos) > 180 * 1024 * 1024:
                raise ValueError("Archivio troppo grande")
            entry = archive.getinfo("catalogo.json")
            if entry.file_size > MAX_JSON or entry.flag_bits & 1:
                raise ValueError("Catalogo troppo grande o cifrato")
            with archive.open(entry) as stream:
                raw = stream.read(MAX_JSON + 1)
            if len(raw) > MAX_JSON:
                raise ValueError("Catalogo troppo grande")
        digest = hashlib.sha256(raw).hexdigest()
        if digest not in DATASETS:
            raise ValueError("Questo pacchetto non corrisponde al catalogo verificato Albertelli Kitchen 2026")
        data = json.loads(raw)
        manifest = data["manifest"]
        if (manifest["sourceSha256"] != DATASETS[digest]
                or manifest["displayName"] != "Albertelli Kitchen" or manifest["version"] != 1):
            raise ValueError("Provenienza del catalogo non valida")
        pages, rows = data["pages"], data["rows"]
        if not 1 <= len(pages) <= 2000 or not 1 <= len(rows) <= 20000:
            raise ValueError("Numero di voci non valido")
        if manifest["pages"] != len(pages) or manifest["articleOccurrences"] != len(rows):
            raise ValueError("Inventario del catalogo incompleto")
        page_ids = set()
        for p in pages:
            if type(p["page"]) is not int or p["page"] in page_ids or not 1 <= p["page"] <= 2000:
                raise ValueError("Pagina non valida")
            page_ids.add(p["page"])
            checked_string(p["text"], 200000)
            checked_string(p["sourceText"], 200000)
            if type(p["kitchen"]) is not bool or not isinstance(p["sections"], list):
                raise ValueError("Sezione non valida")
            for s in p["sections"]:
                checked_string(s, 1000)
        selected = {p["page"] for p in pages if p["kitchen"]}
        ids = set()
        for r in rows:
            if r["page"] not in selected or r["id"] in ids:
                raise ValueError("Riferimenti di catalogo non validi")
            ids.add(r["id"])
            for key, maximum in [("id", 100), ("code", 100), ("rowLabel", 4000), ("context", 200000), ("section", 1000)]:
                checked_string(r[key], maximum)
            if r["numericStatus"] not in STATES or len(r["cells"]) > 20:
                raise ValueError("Stato di verifica non valido")
            # A numeric check can never authorize automatic placement/pricing.
            if r["usableForPricing"] is not False or r["commercialStatus"] != "needs_review":
                raise ValueError("Stato commerciale non valido")
        return data, digest
    except (ValueError, KeyError, TypeError, zipfile.BadZipFile, RuntimeError, OverflowError, zlib.error) as exc:
        message = str(exc) if isinstance(exc, ValueError) else "Pacchetto di catalogo non valido"
        raise HTTPException(422, message) from exc


def summary(manifest):
    return {key: manifest[key] for key in ["displayName", "edition", "sourceSha256", "pages",
            "kitchenPages", "articleOccurrences", "distinctCodes", "numericCrossChecked",
            "numericNeedsReview", "withoutExplicitPoints", "visuallyCheckedGraphicRows", "percentageRuleRowsChecked"]}


def create_index(path, data):
    with closing(sqlite3.connect(path)) as db, db:
        db.executescript("""
          CREATE TABLE pages(page INTEGER PRIMARY KEY, category TEXT NOT NULL, reference TEXT,
            section TEXT NOT NULL, kitchen INTEGER NOT NULL, display_text TEXT NOT NULL, source_text TEXT NOT NULL);
          CREATE TABLE items(idx INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, code TEXT NOT NULL,
            category TEXT NOT NULL, section TEXT NOT NULL, page INTEGER NOT NULL, status TEXT NOT NULL,
            label TEXT NOT NULL, payload TEXT NOT NULL);
          CREATE INDEX items_category ON items(category,page);
          CREATE INDEX items_code ON items(code);
          CREATE VIRTUAL TABLE item_search USING fts5(words,content='',tokenize='unicode61 remove_diacritics 2');
          CREATE VIRTUAL TABLE page_search USING fts5(words,content='',tokenize='unicode61 remove_diacritics 2');
        """)
        for p in data["pages"]:
            display_text = visible(p["text"])
            db.execute("INSERT INTO pages VALUES (?,?,?,?,?,?,?)", (p["page"], category(p["page"]),
                       p["reference"], visible(p["sections"][-1]) if p["sections"] else "Informazioni generali",
                       int(p["kitchen"]), display_text, p["sourceText"]))
            if p["kitchen"]:
                db.execute("INSERT INTO page_search(rowid,words) VALUES (?,?)", (p["page"], display_text))
        for index, raw in enumerate(data["rows"], 1):
            r = {**raw, "category": category(raw["page"])}
            for key in ["context", "rowLabel", "section"]:
                r[key] = visible(r[key])
            db.execute("INSERT INTO items VALUES (?,?,?,?,?,?,?,?,?)", (index, r["id"], r["code"],
                       r["category"], r["section"], r["page"], r["numericStatus"], r["rowLabel"],
                       json.dumps(r, ensure_ascii=False)))
            words = " ".join([r["code"], r["rowLabel"], r["section"], r["context"], r.get("supplementCode") or ""])
            db.execute("INSERT INTO item_search(rowid,words) VALUES (?,?)", (index, words))
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise HTTPException(422, "Indice del catalogo non valido")


def search_terms(q):
    return " AND ".join('"' + token + '"*' for token in re.findall(r"\w+", q, re.UNICODE)[:8])


class PickCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    occurrenceId: str = Field(min_length=1, max_length=100)
    projectId: str = Field(default="", max_length=36)


class PickUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRevision: int = Field(ge=1)
    quantity: int = Field(ge=1, le=1000)
    note: str = Field(default="", max_length=2000)


def register_kitchen(app, engine, user):
    assets = Path(os.getenv("ASSET_DIR", ".studio-assets")) / "kitchen"
    with engine.begin() as c:
        c.execute(text("""CREATE TABLE IF NOT EXISTS kitchen_libraries (
          owner_id VARCHAR(36) PRIMARY KEY REFERENCES users(id), dataset_hash VARCHAR(64) NOT NULL,
          manifest TEXT NOT NULL, imported DOUBLE PRECISION NOT NULL)"""))
        c.execute(text("""CREATE TABLE IF NOT EXISTS kitchen_picks (
          id VARCHAR(36) PRIMARY KEY, owner_id VARCHAR(36) NOT NULL REFERENCES users(id),
          project_id VARCHAR(36) NOT NULL, source_hash VARCHAR(64) NOT NULL,
          occurrence_id VARCHAR(100) NOT NULL, revision INTEGER NOT NULL,
          quantity INTEGER NOT NULL, note TEXT NOT NULL, snapshot TEXT NOT NULL,
          UNIQUE(owner_id,project_id,source_hash,occurrence_id))"""))
        c.execute(text("INSERT INTO schema_version(version) SELECT 3 WHERE NOT EXISTS (SELECT 1 FROM schema_version WHERE version=3)"))

    def active(uid):
        with engine.connect() as c:
            row = c.execute(text("SELECT * FROM kitchen_libraries WHERE owner_id=:uid"), {"uid": uid}).mappings().first()
        return dict(row) if row else None

    def location(uid, digest):
        if not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise HTTPException(503, "Riferimento del catalogo non valido")
        owner = hashlib.sha256(uid.encode()).hexdigest()
        return assets / owner / (digest + ".sqlite")

    @contextmanager
    def library(uid):
        current = active(uid)
        if not current:
            raise HTTPException(404, "Carica il catalogo Albertelli Kitchen per iniziare")
        db = None
        try:
            db = sqlite3.connect(location(uid, current["dataset_hash"]).resolve().as_uri() + "?mode=ro", uri=True)
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA query_only=ON")
            yield db, current
        except sqlite3.DatabaseError as exc:
            raise HTTPException(503, "Catalogo non leggibile: ricarica il pacchetto originale") from exc
        finally:
            if db:
                db.close()

    def owned_project(c, pid, uid):
        if pid and not c.execute(text("SELECT id FROM projects WHERE id=:pid AND owner_id=:uid"), {"pid": pid, "uid": uid}).first():
            raise HTTPException(404, "Progetto non trovato")

    @app.get("/api/kitchen/status")
    def status(u=Depends(user)):
        current = active(u["id"])
        if not current:
            return {"installed": False, "categories": [{"id": k, "label": v, "count": 0} for k, v in CATEGORIES.items()]}
        with library(u["id"]) as (db, _):
            counts = dict(db.execute("SELECT category,count(*) FROM items GROUP BY category"))
            page_counts = dict(db.execute("SELECT category,count(*) FROM pages WHERE kitchen=1 GROUP BY category"))
            sections = [dict(r) for r in db.execute("SELECT DISTINCT category,section FROM items ORDER BY category,section")]
        return {"installed": True, "datasetHash": current["dataset_hash"], "importedAt": current["imported"],
                **summary(json.loads(current["manifest"])), "sections": sections,
                "categories": [{"id": k, "label": v, "count": counts.get(k, 0), "pages": page_counts.get(k, 0)} for k, v in CATEGORIES.items()]}

    def do_import(content, commit, expected, uid):
        data, digest = parse_package(content)
        current = active(uid)
        report = {**summary(data["manifest"]), "datasetHash": digest,
                  "alreadyInstalled": bool(current and current["dataset_hash"] == digest),
                  "currentDatasetHash": current["dataset_hash"] if current else "", "imported": False}
        if not commit:
            return report
        if current and current["dataset_hash"] == digest:
            try:
                with closing(sqlite3.connect(location(uid, digest).resolve().as_uri() + "?mode=ro", uri=True)) as db:
                    if db.execute("PRAGMA quick_check").fetchone()[0] == "ok":
                        return {**report, "imported": True}
            except sqlite3.DatabaseError:
                pass
        if (current["dataset_hash"] if current else "") != expected:
            raise HTTPException(409, "Il catalogo è cambiato: aggiorna l'anteprima prima di confermare")
        path = location(uid, digest)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(uuid4().hex + ".partial")
        try:
            create_index(temporary, data)
            temporary.replace(path)
            with engine.begin() as c:
                if current:
                    result = c.execute(text("UPDATE kitchen_libraries SET dataset_hash=:hash,manifest=:manifest,imported=:now WHERE owner_id=:uid AND dataset_hash=:old"),
                                       {"hash": digest, "manifest": json.dumps(data["manifest"]), "now": time.time(), "uid": uid, "old": expected})
                    if not result.rowcount:
                        raise HTTPException(409, "Catalogo aggiornato in un'altra finestra")
                else:
                    c.execute(text("INSERT INTO kitchen_libraries VALUES (:uid,:hash,:manifest,:now)"),
                              {"uid": uid, "hash": digest, "manifest": json.dumps(data["manifest"]), "now": time.time()})
        except IntegrityError as exc:
            raise HTTPException(409, "Catalogo aggiornato in un'altra finestra") from exc
        finally:
            temporary.unlink(missing_ok=True)
        return {**report, "imported": True}

    @app.post("/api/kitchen/import")
    async def import_catalog(request: Request, commit: bool = False,
                             expected: str = Query(default="", max_length=64), u=Depends(user)):
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_UPLOAD:
                raise HTTPException(413, "Pacchetto troppo grande: massimo 20 MB")
            chunks.append(chunk)
        return await run_in_threadpool(do_import, b"".join(chunks), commit, expected, u["id"])

    @app.get("/api/kitchen/items")
    def items(q: str = Query(default="", max_length=200), categoryId: str = "", section: str = "",
              state: str = "", offset: int = Query(default=0, ge=0, le=20000),
              limit: int = Query(default=40, ge=1, le=100), u=Depends(user)):
        if categoryId and categoryId not in CATEGORIES or state and state not in STATES:
            raise HTTPException(422, "Filtro non valido")
        match, params, conditions = search_terms(q), [], []
        source = "items i"
        if match:
            source += " JOIN item_search ON item_search.rowid=i.idx"
            conditions.append("item_search MATCH ?")
            params.append(match)
        for column, value in [("category", categoryId), ("section", section), ("status", state)]:
            if value:
                conditions.append("i." + column + "=?")
                params.append(value)
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        with library(u["id"]) as (db, _):
            total = db.execute("SELECT count(*) FROM " + source + where, params).fetchone()[0]
            found = db.execute("SELECT i.payload FROM " + source + where + " ORDER BY (i.code=?) DESC,i.page,i.idx LIMIT ? OFFSET ?",
                               [*params, q.strip(), limit, offset]).fetchall()
        result = []
        for row in found:
            r = json.loads(row[0])
            result.append({k: v for k, v in r.items() if k not in {"context", "bbox", "issues"}})
        return {"total": total, "offset": offset, "limit": limit, "items": result}

    @app.get("/api/kitchen/items/{eid}")
    def item(eid: str, u=Depends(user)):
        with library(u["id"]) as (db, current):
            found = db.execute("SELECT payload FROM items WHERE id=?", (eid,)).fetchone()
        if not found:
            raise HTTPException(404, "Articolo non trovato")
        return {**json.loads(found[0]), "sourceSha256": json.loads(current["manifest"])["sourceSha256"]}

    @app.get("/api/kitchen/pages")
    def pages(q: str = Query(default="", max_length=200), categoryId: str = "",
              offset: int = Query(default=0, ge=0, le=2000), u=Depends(user)):
        match, params, conditions = search_terms(q), [], ["p.kitchen=1"]
        source = "pages p"
        if match:
            source += " JOIN page_search ON page_search.rowid=p.page"
            conditions.append("page_search MATCH ?")
            params.append(match)
        if categoryId:
            if categoryId not in CATEGORIES:
                raise HTTPException(422, "Categoria non valida")
            conditions.append("p.category=?")
            params.append(categoryId)
        where = " WHERE " + " AND ".join(conditions)
        with library(u["id"]) as (db, _):
            total = db.execute("SELECT count(*) FROM " + source + where, params).fetchone()[0]
            rows = db.execute("SELECT p.page,p.category,p.reference,p.section FROM " + source + where + " ORDER BY p.page LIMIT 40 OFFSET ?", [*params, offset])
            return {"total": total, "items": [dict(r) for r in rows]}

    @app.get("/api/kitchen/pages/{page}")
    def page(page: int, u=Depends(user)):
        with library(u["id"]) as (db, _):
            row = db.execute("SELECT page,category,reference,section,display_text FROM pages WHERE page=? AND kitchen=1", (page,)).fetchone()
        if not row:
            raise HTTPException(404, "Pagina non presente nel catalogo cucina")
        return dict(row)

    @app.get("/api/kitchen/picks")
    def picks(projectId: str = "", u=Depends(user)):
        with engine.connect() as c:
            owned_project(c, projectId, u["id"])
            rows = c.execute(text("SELECT * FROM kitchen_picks WHERE owner_id=:uid AND project_id=:pid ORDER BY id"), {"uid": u["id"], "pid": projectId}).mappings()
            return [{"id": r["id"], "projectId": r["project_id"], "quantity": r["quantity"], "note": r["note"],
                     "revision": r["revision"], "snapshot": json.loads(r["snapshot"])} for r in rows]

    @app.post("/api/kitchen/picks")
    def add_pick(data: PickCreate, u=Depends(user)):
        with library(u["id"]) as (db, current):
            found = db.execute("SELECT payload FROM items WHERE id=?", (data.occurrenceId,)).fetchone()
        if not found:
            raise HTTPException(404, "Articolo non trovato")
        r = json.loads(found[0])
        snapshot = {k: v for k, v in r.items() if k not in {"context", "bbox", "issues"}}
        snapshot.update({"sourceSha256": json.loads(current["manifest"])["sourceSha256"], "datasetHash": current["dataset_hash"]})
        try:
            with engine.begin() as c:
                owned_project(c, data.projectId, u["id"])
                existing = c.execute(text("SELECT id FROM kitchen_picks WHERE owner_id=:uid AND project_id=:pid AND source_hash=:source AND occurrence_id=:eid"),
                                     {"uid": u["id"], "pid": data.projectId, "source": snapshot["sourceSha256"], "eid": r["id"]}).first()
                if existing:
                    return {"id": existing[0], "alreadyPresent": True}
                count = c.execute(text("SELECT count(*) FROM kitchen_picks WHERE owner_id=:uid"), {"uid": u["id"]}).scalar()
                if count >= 2000:
                    raise HTTPException(422, "Limite di 2000 articoli salvati raggiunto")
                key = str(uuid4())
                c.execute(text("INSERT INTO kitchen_picks VALUES (:id,:uid,:pid,:source,:eid,1,1,'',:snapshot)"),
                          {"id": key, "uid": u["id"], "pid": data.projectId, "source": snapshot["sourceSha256"], "eid": r["id"], "snapshot": json.dumps(snapshot, ensure_ascii=False)})
        except IntegrityError as exc:
            raise HTTPException(409, "Articolo già aggiunto: aggiorna l'elenco") from exc
        return {"id": key, "alreadyPresent": False}

    @app.put("/api/kitchen/picks/{key}")
    def update_pick(key: str, data: PickUpdate, u=Depends(user)):
        with engine.begin() as c:
            old = c.execute(text("SELECT revision FROM kitchen_picks WHERE id=:id AND owner_id=:uid"), {"id": key, "uid": u["id"]}).first()
            if not old:
                raise HTTPException(404, "Voce non trovata")
            result = c.execute(text("UPDATE kitchen_picks SET quantity=:qty,note=:note,revision=revision+1 WHERE id=:id AND owner_id=:uid AND revision=:rev"),
                               {"qty": data.quantity, "note": data.note, "id": key, "uid": u["id"], "rev": data.expectedRevision})
            if not result.rowcount:
                raise HTTPException(409, "Elenco aggiornato in un'altra finestra: ricarica prima di modificare")
        return {"revision": data.expectedRevision + 1}

    @app.get("/api/kitchen/picks/{key}/reference")
    def pick_reference(key: str, pageNumber: int | None = Query(default=None, ge=1, le=2000), u=Depends(user)):
        with engine.connect() as c:
            row = c.execute(text("SELECT snapshot FROM kitchen_picks WHERE id=:id AND owner_id=:uid"),
                            {"id": key, "uid": u["id"]}).first()
        if not row:
            raise HTTPException(404, "Voce non trovata")
        snapshot = json.loads(row[0])
        source_page = None
        try:
            uri = location(u["id"], snapshot["datasetHash"]).resolve().as_uri() + "?mode=ro"
            with closing(sqlite3.connect(uri, uri=True)) as db:
                db.row_factory = sqlite3.Row
                page_row = db.execute("SELECT page,category,reference,section,display_text FROM pages WHERE page=? AND kitchen=1",
                                      (pageNumber or snapshot["page"],)).fetchone()
                source_page = dict(page_row) if page_row else None
        except sqlite3.DatabaseError:
            pass  # Preserve and return the saved choice even if its index needs recovery.
        return {"item": snapshot, "page": source_page}

    @app.delete("/api/kitchen/picks/{key}")
    def remove_pick(key: str, expectedRevision: int = Query(ge=1), u=Depends(user)):
        with engine.begin() as c:
            old = c.execute(text("SELECT revision FROM kitchen_picks WHERE id=:id AND owner_id=:uid"), {"id": key, "uid": u["id"]}).first()
            if not old:
                raise HTTPException(404, "Voce non trovata")
            if old[0] != expectedRevision:
                raise HTTPException(409, "Elenco aggiornato in un'altra finestra")
            deleted = c.execute(text("DELETE FROM kitchen_picks WHERE id=:id AND owner_id=:uid AND revision=:rev"), {"id": key, "uid": u["id"], "rev": expectedRevision})
            if not deleted.rowcount:
                raise HTTPException(409, "Elenco aggiornato in un'altra finestra")
        return {"removed": True}
