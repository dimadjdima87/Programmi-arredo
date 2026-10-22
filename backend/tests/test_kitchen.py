import copy
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import zipfile

from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, text

from backend import kitchen


def fixture_data():
    def row(page, code, name, value):
        return {"id": f"p{page}-1", "page": page, "code": code, "rowLabel": name,
                "variant": "", "section": "Basi" if page == 200 else "Piani",
                "reference": "M 3.6", "context": name + " pagina originale",
                "numericStatus": "cross_checked", "groupKind": "price_group",
                "cells": [{"group": "1", "raw": value, "points": value, "available": True, "crossChecked": True}],
                "commercialStatus": "needs_review", "usableForPricing": False}
    pages = [{"page": n, "reference": f"M {n}", "kitchen": n != 900,
              "sections": ["Cucine", "Basi"], "text": "Nobilia · profondità · www.nobilia.de " + str(n),
              "sourceText": "Originale Nobilia"} for n in [200, 295, 900]]
    return {"manifest": {"version": 1, "displayName": "Albertelli Kitchen", "edition": "2026",
            "sourceSha256": kitchen.SOURCE_HASH, "pages": 3, "kitchenPages": 2,
            "articleOccurrences": 2, "distinctCodes": 2, "numericCrossChecked": 2,
            "numericNeedsReview": 0, "withoutExplicitPoints": 0, "visuallyCheckedGraphicRows": 0,
            "percentageRuleRowsChecked": 0}, "pages": pages,
            "rows": [row(200, "00123", "Base di prova", "1006"), row(295, "7460", "APD60 Piano", "27.6")]}


def package(data, monkeypatch, extra=None):
    raw = json.dumps(data, ensure_ascii=False).encode()
    digest = hashlib.sha256(raw).hexdigest()
    monkeypatch.setitem(kitchen.DATASETS, digest, kitchen.SOURCE_HASH)
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("catalogo.json", raw)
        for name, content in (extra or {}).items():
            z.writestr(name, content)
    return stream.getvalue(), digest


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("ASSET_DIR", str(tmp_path / "assets"))
    engine = create_engine("sqlite:///" + str(tmp_path / "studio.db"))
    with engine.begin() as c:
        c.execute(text("CREATE TABLE users(id VARCHAR(36) PRIMARY KEY)"))
        c.execute(text("CREATE TABLE projects(id VARCHAR(36) PRIMARY KEY,owner_id VARCHAR(36))"))
        c.execute(text("CREATE TABLE schema_version(version INTEGER PRIMARY KEY)"))
        c.execute(text("INSERT INTO users VALUES ('a'),('b')"))
        c.execute(text("INSERT INTO projects VALUES ('pa','a'),('pb','b')"))
    app = FastAPI()

    def current(x_user: str | None = Header(default=None)):
        if x_user not in {"a", "b"}:
            raise HTTPException(401, "Accedi")
        return {"id": x_user}

    kitchen.register_kitchen(app, engine, current)
    client = TestClient(app)
    client.headers["x-user"] = "a"
    content, digest = package(fixture_data(), monkeypatch, {"catalogo.sqlite": b"Never execute me", "catalogo.html": "<script>throw 1</script>"})
    yield client, engine, content, digest, tmp_path
    client.close()
    engine.dispose()


def install(client, content, expected=""):
    response = client.post("/api/kitchen/import", params={"commit": "true", "expected": expected}, content=content)
    assert response.status_code == 200, response.text
    return response.json()


def test_preview_is_read_only_and_installed_index_is_own_sqlite(env):
    client, engine, content, digest, root = env
    assert not client.get("/api/kitchen/status").json()["installed"]
    report = client.post("/api/kitchen/import", content=content).json()
    assert report["articleOccurrences"] == 2
    assert report["currentDatasetHash"] == ""
    assert list((root / "assets").glob("**/*.sqlite")) == []
    assert not client.get("/api/kitchen/status").json()["installed"]
    install(client, content)
    status = client.get("/api/kitchen/status").json()
    assert status["installed"] and status["datasetHash"] == digest
    assert next(c for c in status["categories"] if c["id"] == "bases")["count"] == 1
    dbpath = next((root / "assets").glob("**/*.sqlite"))
    before = dbpath.stat().st_mtime_ns
    install(client, content)
    assert dbpath.stat().st_mtime_ns == before
    with sqlite3.connect(dbpath) as db:
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert db.execute("SELECT source_text FROM pages LIMIT 1").fetchone() == ("Originale Nobilia",)


def test_queries_filters_details_source_privacy_and_scope(env):
    client, _, content, _, _ = env
    install(client, content)
    result = client.get("/api/kitchen/items", params={"q": "00123"}).json()
    assert result["total"] == 1 and result["items"][0]["code"] == "00123"
    assert "context" not in result["items"][0]
    assert client.get("/api/kitchen/items", params={"categoryId": "worktops"}).json()["total"] == 1
    assert client.get("/api/kitchen/items", params={"offset": 1, "limit": 1}).json()["items"][0]["code"] == "7460"
    assert client.get("/api/kitchen/items", params={"categoryId": "invalid"}).status_code == 422
    assert client.get("/api/kitchen/items", params={"q": '" OR 1=1 --'}).status_code == 200
    detail = client.get("/api/kitchen/items/p200-1").json()
    assert detail["usableForPricing"] is False
    pages = client.get("/api/kitchen/pages", params={"q": "profondita"}).json()
    assert pages["total"] == 2
    page = client.get("/api/kitchen/pages/200")
    assert "Albertelli Kitchen" in page.text
    assert "nobilia" not in page.text.lower() and "source_text" not in page.text
    assert client.get("/api/kitchen/pages/900").status_code == 404


def test_catalog_and_project_selections_are_private_and_revisioned(env):
    client, _, content, _, _ = env
    install(client, content)
    pick = client.post("/api/kitchen/picks", json={"occurrenceId": "p200-1", "projectId": "pa"}).json()
    assert not pick["alreadyPresent"]
    assert client.post("/api/kitchen/picks", json={"occurrenceId": "p200-1", "projectId": "pa"}).json()["alreadyPresent"]
    assert client.get("/api/kitchen/picks").json() == []
    row = client.get("/api/kitchen/picks?projectId=pa").json()[0]
    assert row["snapshot"]["code"] == "00123"
    assert client.post("/api/kitchen/picks", json={"occurrenceId": "p200-1", "projectId": "pb"}).status_code == 404
    payload = {"quantity": 3, "note": "Finitura da confermare", "expectedRevision": 1}
    assert client.put("/api/kitchen/picks/" + pick["id"], json=payload).status_code == 200
    assert client.put("/api/kitchen/picks/" + pick["id"], json=payload).status_code == 409
    assert client.delete("/api/kitchen/picks/" + pick["id"] + "?expectedRevision=1").status_code == 409
    client.headers["x-user"] = "b"
    assert not client.get("/api/kitchen/status").json()["installed"]
    assert client.get("/api/kitchen/items").status_code == 404
    assert client.get("/api/kitchen/picks?projectId=pa").status_code == 404
    assert client.put("/api/kitchen/picks/" + pick["id"], json={**payload, "expectedRevision": 2}).status_code == 404
    install(client, content)
    assert client.get("/api/kitchen/picks").json() == []
    client.headers["x-user"] = "a"
    assert client.get("/api/kitchen/picks?projectId=pa").json()[0]["note"] == payload["note"]
    assert client.delete("/api/kitchen/picks/" + pick["id"] + "?expectedRevision=2").status_code == 200


def test_unknown_modified_or_path_traversing_package_is_rejected(env, monkeypatch):
    client, _, content, _, _ = env
    for payload in [b"not a zip", content[:50]]:
        assert client.post("/api/kitchen/import", content=payload).status_code == 422
    fake = io.BytesIO()
    with zipfile.ZipFile(fake, "w") as z:
        z.writestr("catalogo.json", '{"not":"audited"}')
    assert client.post("/api/kitchen/import", content=fake.getvalue()).status_code == 422
    bad, _ = package(fixture_data(), monkeypatch, {"../outside.txt": "escape"})
    assert client.post("/api/kitchen/import", content=bad).status_code == 422
    monkeypatch.setattr(kitchen, "MAX_UPLOAD", 100)
    assert client.post("/api/kitchen/import", content=content).status_code == 413
    assert not client.get("/api/kitchen/status").json()["installed"]
    del client.headers["x-user"]
    assert client.post("/api/kitchen/import", content=content).status_code == 401


def test_update_preserves_selection_snapshot_and_detects_conflicts(env, monkeypatch):
    client, _, content, digest, _ = env
    install(client, content)
    client.post("/api/kitchen/picks", json={"occurrenceId": "p200-1"})
    data = fixture_data()
    data["rows"][0]["cells"][0]["points"] = "2000"
    revised, new_digest = package(data, monkeypatch)
    assert client.post("/api/kitchen/import?commit=true&expected=wrong", content=revised).status_code == 409
    assert client.get("/api/kitchen/status").json()["datasetHash"] == digest
    install(client, revised, expected=digest)
    assert client.get("/api/kitchen/status").json()["datasetHash"] == new_digest
    assert client.get("/api/kitchen/picks").json()[0]["snapshot"]["cells"][0]["points"] == "1006"
    assert client.get("/api/kitchen/items/p200-1").json()["cells"][0]["points"] == "2000"


def test_missing_index_can_be_restored_without_removing_favorites(env):
    client, _, content, digest, root = env
    install(client, content)
    client.post("/api/kitchen/picks", json={"occurrenceId": "p200-1"})
    next((root / "assets").glob("**/*.sqlite")).unlink()
    assert client.get("/api/kitchen/status").status_code == 503
    install(client, content, expected=digest)
    assert client.get("/api/kitchen/picks").json()[0]["snapshot"]["code"] == "00123"


def test_data_file_survives_backup_copy_and_database_migration_is_additive(env, tmp_path):
    import shutil

    client, engine, content, _, root = env
    install(client, content)
    client.post("/api/kitchen/picks", json={"occurrenceId": "p200-1", "projectId": "pa"})
    with engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM projects")).scalar() == 2
        assert c.execute(text("SELECT count(*) FROM schema_version WHERE version=3")).scalar() == 1
    copy_root = tmp_path / "backup"
    shutil.copytree(root / "assets", copy_root)
    with sqlite3.connect(next(copy_root.glob("**/*.sqlite"))) as db:
        assert db.execute("SELECT code FROM items ORDER BY idx LIMIT 1").fetchone()[0] == "00123"
