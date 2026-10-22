"""Private, revisioned catalog and local swatch storage for the phase-2 prototype."""

import csv
import hashlib
import io
import json
import os
from pathlib import Path
import time
from typing import Literal
from uuid import uuid4

from fastapi import Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from PIL import Image, UnidentifiedImageError


class CatalogData(BaseModel):
    model_config = ConfigDict(
        extra="forbid", allow_inf_nan=False, str_strip_whitespace=True
    )
    kind: Literal["manufacturer", "product", "finish"]
    name: str = Field(min_length=1, max_length=150)
    code: str = Field(min_length=1, max_length=100)
    manufacturerId: str = Field(default="", max_length=36)
    family: str = Field(default="", max_length=100)
    width: float = Field(default=600, gt=0, le=10000)
    depth: float = Field(default=600, gt=0, le=10000)
    height: float = Field(default=870, gt=0, le=6000)
    color: str = Field(default="#C5A77C", pattern="^#[0-9a-fA-F]{6}$")
    isDemo: bool = True
    sourceReference: str = Field(default="", max_length=2000)
    license: str = Field(default="", max_length=2000)
    status: Literal["draft", "approved", "archived"] = "draft"
    compatibleCodes: list[str] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def provenance(self):
        if self.status == "approved" and (not self.sourceReference or not self.license):
            raise ValueError("Per approvare servono provenienza e diritti d’uso")
        if self.kind != "manufacturer" and not self.manufacturerId:
            raise ValueError("Seleziona un produttore")
        if self.kind == "manufacturer" and self.manufacturerId:
            raise ValueError("Un produttore non può avere un produttore padre")
        return self


class CatalogSave(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRevision: int = Field(ge=0)
    entry: CatalogData


class CSVImport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    csv: str = Field(max_length=500000)
    commit: bool = False


CSV_COLUMNS = [
    "kind",
    "name",
    "code",
    "manufacturerId",
    "family",
    "width",
    "depth",
    "height",
    "color",
    "isDemo",
    "sourceReference",
    "license",
    "compatibleCodes",
]


def row_public(row):
    return json.loads(row["payload"]) | {"id": row["id"], "revision": row["revision"]}


def catalog_entry(c, eid, uid):
    row = (
        c.execute(
            text("SELECT * FROM catalog_entries WHERE id=:id AND owner_id=:uid"),
            {"id": eid, "uid": uid},
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(404, "Voce di catalogo non trovata")
    return row_public(row)


def init_catalog(engine):
    with engine.begin() as c:
        c.execute(
            text(
                "CREATE TABLE IF NOT EXISTS catalog_entries (id VARCHAR(36) PRIMARY KEY, owner_id VARCHAR(36) NOT NULL REFERENCES users(id), kind VARCHAR(20) NOT NULL, manufacturer_id VARCHAR(36) NOT NULL, code VARCHAR(100) NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(owner_id,kind,manufacturer_id,code))"
            )
        )
        c.execute(
            text(
                "CREATE INDEX IF NOT EXISTS catalog_owner ON catalog_entries(owner_id,kind)"
            )
        )
        c.execute(
            text(
                "CREATE TABLE IF NOT EXISTS catalog_versions (entry_id VARCHAR(36) NOT NULL REFERENCES catalog_entries(id), revision INTEGER NOT NULL, payload TEXT NOT NULL, created DOUBLE PRECISION NOT NULL, PRIMARY KEY(entry_id,revision))"
            )
        )
        c.execute(
            text(
                "CREATE TABLE IF NOT EXISTS catalog_assets (entry_id VARCHAR(36) PRIMARY KEY REFERENCES catalog_entries(id), asset_key VARCHAR(64) NOT NULL, sha256 VARCHAR(64) NOT NULL)"
            )
        )
        c.execute(
            text(
                "INSERT INTO schema_version(version) SELECT 2 WHERE NOT EXISTS (SELECT 1 FROM schema_version WHERE version=2)"
            )
        )


def validate_parent(c, data, uid):
    if data.kind == "manufacturer":
        return
    parent = catalog_entry(c, data.manufacturerId, uid)
    if parent["kind"] != "manufacturer" or (
        parent["status"] != "approved" and data.status != "archived"
    ):
        raise HTTPException(422, "Il produttore deve essere approvato e attivo")
    if parent["isDemo"] != data.isDemo:
        raise HTTPException(
            422, "Produttore e voce devono avere la stessa classificazione DEMO/reale"
        )
    for code in data.compatibleCodes:
        row = c.execute(
            text(
                "SELECT id FROM catalog_entries WHERE owner_id=:uid AND manufacturer_id=:mid AND kind='product' AND code=:code"
            ),
            {"uid": uid, "mid": data.manufacturerId, "code": code},
        ).first()
        if not row:
            raise HTTPException(
                422, "Codice prodotto compatibile non presente nel catalogo"
            )


def write_entry(c, uid, data, eid=None, expected=0):
    validate_parent(c, data, uid)
    if eid:
        old = catalog_entry(c, eid, uid)
        if old["revision"] != expected:
            raise HTTPException(409, "Catalogo aggiornato altrove: ricarica")
        if (old["kind"], old["code"], old["manufacturerId"], old["isDemo"]) != (
            data.kind,
            data.code,
            data.manufacturerId,
            data.isDemo,
        ):
            raise HTTPException(
                422,
                "Tipo, codice, produttore e classificazione sono immutabili: crea una nuova voce",
            )
        if old["status"] == "approved" and data.status == "approved":
            if any(old[k] != v for k, v in data.model_dump().items() if k != "status"):
                raise HTTPException(
                    422, "Riapri come bozza prima di modificare una voce approvata"
                )
        rev = expected + 1
        r = c.execute(
            text(
                "UPDATE catalog_entries SET payload=:payload,revision=:rev WHERE id=:id AND owner_id=:uid AND revision=:old"
            ),
            {
                "payload": data.model_dump_json(),
                "rev": rev,
                "id": eid,
                "uid": uid,
                "old": expected,
            },
        )
        if r.rowcount != 1:
            raise HTTPException(409, "Modifica concorrente: ricarica")
    else:
        if expected:
            raise HTTPException(409, "Revisione iniziale non valida")
        eid = str(uuid4())
        rev = 1
        c.execute(
            text(
                "INSERT INTO catalog_entries VALUES (:id,:uid,:kind,:mid,:code,1,:payload)"
            ),
            {
                "id": eid,
                "uid": uid,
                "kind": data.kind,
                "mid": data.manufacturerId,
                "code": data.code,
                "payload": data.model_dump_json(),
            },
        )
    result = data.model_dump() | {"id": eid, "revision": rev}
    c.execute(
        text("INSERT INTO catalog_versions VALUES (:id,:rev,:payload,:created)"),
        {"id": eid, "rev": rev, "payload": json.dumps(result), "created": time.time()},
    )
    return result


def validate_scene_catalog(c, scene, uid, old=None):
    previous_boards = {b["id"]: b for b in (old or {}).get("moodboards", [])}
    for board in scene.get("moodboards", []):
        for ref in board.get("catalogReferences") or []:
            if ref in (
                previous_boards.get(board["id"], {}).get("catalogReferences") or []
            ):
                continue
            actual = catalog_entry(c, ref.get("id", ""), uid)
            if (
                actual != ref
                or actual["kind"] != "product"
                or actual["status"] != "approved"
            ):
                raise HTTPException(
                    422, "Moodboard: riferimento non approvato o alterato"
                )
    previous = {i["id"]: i for i in (old or {}).get("items", [])}
    for item in scene["items"]:
        for field, kind in [("catalogProduct", "product"), ("catalogFinish", "finish")]:
            ref = item.get(field)
            if not ref:
                continue
            if previous.get(item["id"], {}).get(field) == ref:
                continue
            actual = catalog_entry(c, ref.get("id", ""), uid)
            if (
                actual != ref
                or actual["status"] != "approved"
                or actual["kind"] != kind
            ):
                raise HTTPException(
                    422, "Riferimento catalogo non approvato o non aggiornato"
                )
            parent = catalog_entry(c, actual["manufacturerId"], uid)
            if parent["status"] != "approved":
                raise HTTPException(422, "Produttore non più approvato")
        product = item.get("catalogProduct")
        finish = item.get("catalogFinish")
        if item["verification"] == "verified" and (not product or product["isDemo"]):
            raise HTTPException(
                422, "Un elemento verificato richiede un prodotto reale approvato"
            )
        if product and not product["isDemo"]:
            if item["verification"] != "verified" or any(
                item[k] != product[k] for k in ["width", "depth", "height"]
            ):
                raise HTTPException(
                    422,
                    "Le dimensioni del prodotto reale devono rispettare il catalogo",
                )
        if finish:
            if (
                not product
                or finish["manufacturerId"] != product["manufacturerId"]
                or product["code"] not in finish["compatibleCodes"]
            ):
                raise HTTPException(
                    422, "Compatibilità prodotto/finitura non documentata"
                )
            if item["finish"].lower() != finish["color"].lower():
                raise HTTPException(422, "Colore diverso dalla finitura referenziata")


def register_catalog(app, engine, user):
    init_catalog(engine)
    assets = Path(os.getenv("ASSET_DIR", ".studio-assets"))

    def listing(uid):
        with engine.connect() as c:
            return [
                row_public(r)
                for r in c.execute(
                    text(
                        "SELECT * FROM catalog_entries WHERE owner_id=:uid ORDER BY kind,code"
                    ),
                    {"uid": uid},
                ).mappings()
            ]

    @app.get("/api/catalog")
    def get_catalog(u=Depends(user)):
        return listing(u["id"])

    @app.post("/api/catalog", status_code=201)
    def create_catalog(data: CatalogSave, u=Depends(user)):
        try:
            with engine.begin() as c:
                return write_entry(
                    c, u["id"], data.entry, expected=data.expectedRevision
                )
        except IntegrityError:
            raise HTTPException(409, "Codice già presente per questo produttore")

    @app.put("/api/catalog/{eid}")
    def update_catalog(eid: str, data: CatalogSave, u=Depends(user)):
        try:
            with engine.begin() as c:
                return write_entry(c, u["id"], data.entry, eid, data.expectedRevision)
        except IntegrityError:
            raise HTTPException(409, "Codice già presente")

    @app.get("/api/catalog/{eid}/versions")
    def versions(eid: str, u=Depends(user)):
        with engine.connect() as c:
            catalog_entry(c, eid, u["id"])
            return [
                json.loads(r[0])
                for r in c.execute(
                    text(
                        "SELECT payload FROM catalog_versions WHERE entry_id=:id ORDER BY revision DESC"
                    ),
                    {"id": eid},
                )
            ]

    @app.post("/api/catalog/import")
    def import_csv(data: CSVImport, u=Depends(user)):
        reader = csv.DictReader(
            io.StringIO(data.csv.removeprefix("\ufeff")), strict=True
        )
        if reader.fieldnames != CSV_COLUMNS:
            raise HTTPException(
                422, "Intestazioni CSV non valide: usa il modello scaricabile"
            )
        parsed = []
        errors = []
        seen = set()
        try:
            for line, row in enumerate(reader, 2):
                if line > 501:
                    raise HTTPException(413, "Massimo 500 righe per importazione")
                try:
                    if None in row or any(v is None for v in row.values()):
                        raise ValueError("Numero colonne non valido")
                    if row["kind"] == "manufacturer":
                        raise ValueError("Crea prima i produttori dall’interfaccia")
                    if row["isDemo"] not in ["true", "false"]:
                        raise ValueError("isDemo deve essere true o false")
                    row["isDemo"] = row["isDemo"] == "true"
                    row["compatibleCodes"] = [
                        v.strip()
                        for v in row["compatibleCodes"].split("|")
                        if v.strip()
                    ]
                    entry = CatalogData.model_validate(row)
                    key = (entry.kind, entry.manufacturerId, entry.code)
                    if key in seen:
                        raise ValueError("Codice duplicato nel file")
                    seen.add(key)
                    with engine.connect() as c:
                        validate_parent(c, entry, u["id"])
                        if c.execute(
                            text(
                                "SELECT id FROM catalog_entries WHERE owner_id=:uid AND kind=:kind AND manufacturer_id=:mid AND code=:code"
                            ),
                            {
                                "uid": u["id"],
                                "kind": entry.kind,
                                "mid": entry.manufacturerId,
                                "code": entry.code,
                            },
                        ).first():
                            raise ValueError("Codice già presente")
                    parsed.append(entry)
                except (ValueError, ValidationError, HTTPException) as e:
                    errors.append(
                        {
                            "row": line,
                            "message": (
                                str(e.detail)
                                if isinstance(e, HTTPException)
                                else str(e)
                            ),
                        }
                    )
        except csv.Error:
            errors.append({"row": reader.line_num, "message": "CSV non valido"})
        if not parsed and not errors:
            errors.append({"row": 2, "message": "Nessuna riga dati"})
        report = {"valid": len(parsed), "errors": errors, "imported": 0, "entries": []}
        if data.commit and not errors:
            try:
                with engine.begin() as c:
                    report["entries"] = [write_entry(c, u["id"], e) for e in parsed]
                    report["imported"] = len(parsed)
            except IntegrityError:
                raise HTTPException(409, "Importazione concorrente: ripeti la verifica")
        return report

    @app.put("/api/catalog/{eid}/swatch")
    async def upload_swatch(eid: str, request: Request, u=Depends(user)):
        with engine.connect() as c:
            entry = catalog_entry(c, eid, u["id"])
            if entry["kind"] != "finish" or entry["status"] != "draft":
                raise HTTPException(
                    422, "Carica campioni soltanto su finiture in bozza"
                )
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 2 * 1024 * 1024:
                raise HTTPException(413, "Campione troppo grande: massimo 2 MB")
        try:
            with Image.open(io.BytesIO(raw)) as im:
                if im.format not in ["PNG", "JPEG"] or im.width * im.height > 4000000:
                    raise ValueError()
                im.load()
                im = im.convert("RGB")
                im.thumbnail((1024, 1024))
                out = io.BytesIO()
                im.save(out, format="PNG")
        except (
            UnidentifiedImageError,
            OSError,
            ValueError,
            Image.DecompressionBombError,
        ):
            raise HTTPException(
                422, "Carica un PNG/JPEG valido, massimo 4 milioni di pixel"
            )
        content = out.getvalue()
        key = str(uuid4()) + ".png"
        assets.mkdir(parents=True, exist_ok=True)
        path = assets / key
        path.write_bytes(content)
        try:
            with engine.begin() as c:
                current = catalog_entry(c, eid, u["id"])
                if current["revision"] != entry["revision"]:
                    raise HTTPException(409, "Voce modificata durante il caricamento")
                c.execute(
                    text("DELETE FROM catalog_assets WHERE entry_id=:id"), {"id": eid}
                )
                c.execute(
                    text("INSERT INTO catalog_assets VALUES (:id,:key,:sha)"),
                    {"id": eid, "key": key, "sha": hashlib.sha256(content).hexdigest()},
                )
                data = CatalogData.model_validate(
                    {k: v for k, v in current.items() if k not in ["id", "revision"]}
                )
                result = write_entry(c, u["id"], data, eid, current["revision"])
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return result

    @app.get("/api/catalog/{eid}/swatch")
    def get_swatch(eid: str, u=Depends(user)):
        with engine.connect() as c:
            catalog_entry(c, eid, u["id"])
            row = c.execute(
                text("SELECT asset_key,sha256 FROM catalog_assets WHERE entry_id=:id"),
                {"id": eid},
            ).first()
        if not row or not (assets / row[0]).is_file():
            raise HTTPException(404, "Campione non presente")
        return Response(
            (assets / row[0]).read_bytes(),
            media_type="image/png",
            headers={
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
                "ETag": row[1],
            },
        )

    @app.post("/api/catalog/suggestions")
    def suggestions(u=Depends(user)):
        entries = listing(u["id"])
        active = {
            e["id"]
            for e in entries
            if e["kind"] == "manufacturer" and e["status"] == "approved"
        }
        products = [
            e
            for e in entries
            if e["kind"] == "product"
            and e["status"] == "approved"
            and e["manufacturerId"] in active
        ]
        return {
            "provider": "rules-demo",
            "externalAI": False,
            "label": "Suggerimento deterministico DEMO, revisione umana richiesta",
            "directions": [
                {
                    "title": title,
                    "productIds": [e["id"] for e in products[:6]],
                    "palette": palette,
                    "genericSuggestions": [
                        "Illuminazione e tessili da verificare con il progettista"
                    ],
                    "provenance": {"provider": "rules-demo", "templateVersion": "2.0"},
                }
                for title, palette in [
                    ("Naturale luminoso", ["#C5A77C", "#EEE7DB", "#69745D", "#413F39"]),
                    (
                        "Minerale contemporaneo",
                        ["#A6B8BF", "#E6E8E4", "#676C73", "#BDAA98"],
                    ),
                ]
            ],
        }
