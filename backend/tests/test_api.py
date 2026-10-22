import copy
import importlib.util
import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

test_dir = tempfile.TemporaryDirectory(prefix="albertelli-tests-")
os.environ["DATABASE_URL"] = os.getenv(
    "TEST_DATABASE_URL", "sqlite:///" + test_dir.name + "/studio.db"
)
if (
    os.getenv("TEST_DATABASE_URL")
    and "test" not in os.getenv("TEST_DATABASE_URL").rsplit("/", 1)[-1]
):
    raise RuntimeError(
        "TEST_DATABASE_URL deve indicare un database dedicato con test nel nome"
    )
os.environ["ASSET_DIR"] = test_dir.name + "/assets"

spec = importlib.util.spec_from_file_location(
    "studio_api", Path(__file__).parents[1] / "main.py"
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


@pytest.fixture
def client():
    with m.engine.begin() as c:
        for table in [
            "catalog_assets",
            "catalog_versions",
            "catalog_entries",
            "versions",
            "projects",
            "sessions",
        ]:
            c.execute(m.text("DELETE FROM " + table))
    with TestClient(m.app) as c:
        assert (
            c.post(
                "/api/login",
                json={"email": "designer@demo.local", "password": "DemoStudio2026!"},
            ).status_code
            == 200
        )
        yield c


@pytest.fixture
def payload():
    return {
        "title": "Cucina prova",
        "brief": "Demo",
        "expectedRevision": 0,
        "scene": {
            "schemaVersion": "1.0",
            "units": "mm",
            "height": 2700,
            "walls": [
                {"id": "a", "x": 0, "y": 0},
                {"id": "b", "x": 4200, "y": 0},
                {"id": "c", "x": 4200, "y": 3600},
                {"id": "d", "x": 0, "y": 3600},
            ],
            "openings": [
                {
                    "id": "door",
                    "wallId": "a",
                    "kind": "door",
                    "offset": 300,
                    "width": 800,
                    "height": 2100,
                    "sill": 0,
                    "swing": "left",
                },
                {
                    "id": "window",
                    "wallId": "c",
                    "kind": "window",
                    "offset": 1000,
                    "width": 1200,
                    "height": 1200,
                    "sill": 1000,
                    "swing": "left",
                },
            ],
            "items": [
                {
                    "id": "base",
                    "label": "Base DEMO",
                    "x": 600,
                    "y": 600,
                    "width": 600,
                    "depth": 600,
                    "height": 870,
                    "rotation": 0,
                    "finish": "#C5A77C",
                    "locked": False,
                    "verification": "DEMO",
                }
            ],
            "moodboards": [
                {
                    "id": "warm",
                    "title": "Caldo DEMO",
                    "palette": ["#ffffff", "#eeeeee", "#dddddd"],
                    "notes": "Concept",
                    "approved": False,
                },
                {
                    "id": "cool",
                    "title": "Freddo DEMO",
                    "palette": ["#ffffff", "#eeeeee", "#dddddd"],
                    "notes": "Concept",
                    "approved": False,
                },
            ],
        },
    }


def create(client, payload):
    r = client.post("/api/projects", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_roundtrip_versions_and_restore(client, payload):
    a = create(client, payload)
    url = "/api/projects/" + a["id"]
    assert client.get(url).json()["scene"] == payload["scene"]
    payload["expectedRevision"] = 1
    payload["scene"]["walls"][1]["x"] = 4300
    assert client.put(url, json=payload).json()["revision"] == 2
    assert client.put(url, json=payload).status_code == 409
    r = client.post(url + "/restore/1", json={"expectedRevision": 2})
    assert r.status_code == 200
    assert r.json()["revision"] == 3
    assert r.json()["scene"] == a["scene"]
    assert len(client.get(url + "/versions").json()) == 3


def test_private_projects(client, payload):
    a = create(client, payload)
    url = "/api/projects/" + a["id"]
    client.post("/api/logout")
    assert client.get(url).status_code == 401
    client.post(
        "/api/login", json={"email": "viewer@demo.local", "password": "DemoStudio2026!"}
    )
    assert client.get("/api/projects").json() == []
    for method, path, data in [
        ("GET", url, None),
        ("GET", url + "/versions", None),
        ("PUT", url, payload),
        ("POST", url + "/restore/1", {"expectedRevision": 1}),
    ]:
        assert client.request(method, path, json=data).status_code == 404


@pytest.mark.parametrize(
    "change", ["outside", "overlap", "missing", "cross", "nan", "duplicate", "height"]
)
def test_invalid_geometry(client, payload, change):
    s = payload["scene"]
    if change == "outside":
        s["openings"][0]["offset"] = 4000
    if change == "overlap":
        s["openings"].append({**s["openings"][0], "id": "second"})
    if change == "missing":
        s["openings"][0]["wallId"] = "unknown"
    if change == "cross":
        s["walls"][1], s["walls"][2] = s["walls"][2], s["walls"][1]
    if change == "nan":
        s["walls"][1]["x"] = "NaN"
    if change == "duplicate":
        s["items"][0]["id"] = "a"
    if change == "height":
        s["openings"][1]["sill"] = 2000
    assert client.post("/api/projects", json=payload).status_code == 422


def test_finish_preserves_geometry_and_identity(client, payload):
    a = create(client, payload)
    old = copy.deepcopy(a["scene"])
    payload["expectedRevision"] = 1
    payload["scene"]["items"][0]["finish"] = "#112233"
    r = client.put("/api/projects/" + a["id"], json=payload)
    assert r.status_code == 200
    new = r.json()["scene"]
    new["items"][0]["finish"] = old["items"][0]["finish"]
    assert new == old


def test_lock_requires_standalone_unlock(client, payload):
    payload["scene"]["items"][0]["locked"] = True
    a = create(client, payload)
    url = "/api/projects/" + a["id"]
    payload["expectedRevision"] = 1
    payload["scene"]["items"][0]["x"] = 900
    assert client.put(url, json=payload).status_code == 422
    payload["scene"]["items"][0]["locked"] = False
    assert client.put(url, json=payload).status_code == 422
    payload["scene"]["items"][0]["x"] = 600
    assert client.put(url, json=payload).status_code == 200
    payload["expectedRevision"] = 2
    payload["scene"]["items"][0]["x"] = 900
    assert client.put(url, json=payload).status_code == 200


def test_login_and_logout(client):
    assert client.get("/api/me").status_code == 200
    assert (
        client.post(
            "/api/login", json={"email": "designer@demo.local", "password": "wrong"}
        ).status_code
        == 401
    )
    client.post("/api/logout")
    assert client.get("/api/me").status_code == 401


def test_seed_is_repeatable(client):
    m.init_db()
    m.init_db()
    assert client.get("/api/me").status_code == 200
    assert (
        client.post(
            "/api/login",
            json={"email": "designer@demo.local", "password": "DemoStudio2026!"},
        ).status_code
        == 200
    )


def catalog_create(client, kind="manufacturer", **kwargs):
    data = {
        "kind": kind,
        "name": "Studio DEMO",
        "code": "DEMO-M",
        "isDemo": True,
        "sourceReference": "Fonte demo procedurale",
        "license": "Campione originale DEMO",
        **kwargs,
    }
    r = client.post("/api/catalog", json={"expectedRevision": 0, "entry": data})
    assert r.status_code == 201, r.text
    return r.json()


def catalog_update(client, entry, **changes):
    data = {k: v for k, v in entry.items() if k not in ["id", "revision"]}
    return client.put(
        "/api/catalog/" + entry["id"],
        json={"expectedRevision": entry["revision"], "entry": data | changes},
    )


def test_catalog_approval_revision_and_privacy(client):
    brand = catalog_create(client)
    assert (
        catalog_update(client, brand, status="approved", sourceReference="").status_code
        == 422
    )
    brand = catalog_update(client, brand, status="approved").json()
    p = catalog_create(client, "product", code="DEMO-P", manufacturerId=brand["id"])
    assert catalog_update(client, p, expectedRevision=99).status_code == 422
    approved = catalog_update(client, p, status="approved").json()
    assert catalog_update(client, p, status="approved").status_code == 409
    assert catalog_update(client, approved, name="Alterato").status_code == 422
    assert catalog_update(client, approved, code="NEW").status_code == 422
    assert len(client.get("/api/catalog/" + p["id"] + "/versions").json()) == 2
    client.post(
        "/api/login", json={"email": "viewer@demo.local", "password": "DemoStudio2026!"}
    )
    assert client.get("/api/catalog").json() == []
    assert client.get("/api/catalog/" + p["id"] + "/versions").status_code == 404
    assert catalog_update(client, approved, status="draft").status_code == 404
    assert client.get("/api/catalog/" + p["id"] + "/swatch").status_code == 404


def test_catalog_snapshot_preserved_and_forgery_rejected(client, payload):
    brand = catalog_create(client, status="approved")
    p = catalog_create(
        client, "product", code="P", manufacturerId=brand["id"], status="approved"
    )
    payload["scene"]["items"][0]["catalogProduct"] = p
    a = create(client, payload)
    draft = catalog_update(client, p, status="draft").json()
    archived = catalog_update(client, draft, status="archived").json()
    payload["expectedRevision"] = 1
    assert client.put("/api/projects/" + a["id"], json=payload).status_code == 200
    assert (
        client.get("/api/projects/" + a["id"]).json()["scene"]["items"][0][
            "catalogProduct"
        ]
        == p
    )
    payload["expectedRevision"] = 0
    assert client.post("/api/projects", json=payload).status_code == 422
    payload["scene"]["items"][0]["catalogProduct"] = archived
    assert client.post("/api/projects", json=payload).status_code == 422


def test_real_product_dimensions_and_finish_compatibility(client, payload):
    brand = catalog_create(client, isDemo=False, status="approved")
    product = catalog_create(
        client,
        "product",
        code="P",
        manufacturerId=brand["id"],
        isDemo=False,
        status="approved",
    )
    finish = catalog_create(
        client,
        "finish",
        code="F",
        manufacturerId=brand["id"],
        isDemo=False,
        status="approved",
        color="#112233",
        compatibleCodes=["P"],
    )
    item = payload["scene"]["items"][0]
    item.update(
        catalogProduct=product,
        verification="verified",
        catalogFinish=finish,
        finish="#112233",
    )
    assert client.post("/api/projects", json=payload).status_code == 201
    item["width"] = 601
    assert client.post("/api/projects", json=payload).status_code == 422
    item["width"] = 600
    item["finish"] = "#ffffff"
    assert client.post("/api/projects", json=payload).status_code == 422
    item["finish"] = "#112233"
    item["catalogFinish"] = {**finish, "compatibleCodes": ["FAKE"]}
    assert client.post("/api/projects", json=payload).status_code == 422
    item.pop("catalogProduct")
    item.pop("catalogFinish")
    assert client.post("/api/projects", json=payload).status_code == 422


def csv_data(brand, rows):
    import csv, io
    from backend.catalog import CSV_COLUMNS

    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(CSV_COLUMNS)
    for code, width in rows:
        writer.writerow(
            [
                "product",
                "Base DEMO",
                code,
                brand["id"],
                "Cucina",
                width,
                600,
                870,
                "#abcdef",
                "true",
                "Documento demo",
                "Uso demo",
                "",
            ]
        )
    return out.getvalue()


def test_csv_preview_atomic_import_and_duplicates(client):
    brand = catalog_create(client, status="approved")
    bad = csv_data(brand, [("A", 600), ("B", -1)])
    result = client.post(
        "/api/catalog/import", json={"csv": bad, "commit": True}
    ).json()
    assert result["imported"] == 0 and result["errors"][0]["row"] == 3
    assert len(client.get("/api/catalog").json()) == 1
    good = csv_data(brand, [("A", 600), ("B", 800)])
    assert client.post("/api/catalog/import", json={"csv": good}).json()["valid"] == 2
    assert len(client.get("/api/catalog").json()) == 1
    result = client.post(
        "/api/catalog/import", json={"csv": good, "commit": True}
    ).json()
    assert result["imported"] == 2 and all(
        e["status"] == "draft" for e in result["entries"]
    )
    assert (
        client.post("/api/catalog/import", json={"csv": good, "commit": True}).json()[
            "imported"
        ]
        == 0
    )
    assert (
        client.post("/api/catalog/import", json={"csv": "wrong,header"}).status_code
        == 422
    )


def test_swatch_upload_validation_and_authorization(client):
    import io
    from PIL import Image

    brand = catalog_create(client, status="approved")
    finish = catalog_create(client, "finish", code="F", manufacturerId=brand["id"])
    url = "/api/catalog/" + finish["id"] + "/swatch"
    assert client.put(url, content=b"<svg>not an image</svg>").status_code == 422
    assert client.put(url, content=b"x" * (2 * 1024 * 1024 + 1)).status_code == 413
    image = io.BytesIO()
    Image.new("RGB", (40, 30), "red").save(image, format="PNG")
    r = client.put(url, content=image.getvalue(), headers={"Content-Type": "image/png"})
    assert r.status_code == 200, r.text
    assert r.json()["revision"] == 2
    png = client.get(url)
    assert png.status_code == 200 and png.content.startswith(b"\x89PNG")
    assert png.headers["cache-control"] == "private, no-store"
    client.post(
        "/api/login", json={"email": "viewer@demo.local", "password": "DemoStudio2026!"}
    )
    assert client.get(url).status_code == 404
    assert client.put(url, content=image.getvalue()).status_code == 404


def test_suggestions_only_approved_products_and_moodboard_refs(client, payload):
    brand = catalog_create(client, status="approved")
    p = catalog_create(
        client, "product", code="P", manufacturerId=brand["id"], status="approved"
    )
    catalog_create(client, "product", code="DRAFT", manufacturerId=brand["id"])
    data = client.post("/api/catalog/suggestions").json()
    assert data["externalAI"] is False
    assert len(data["directions"]) == 2
    assert data["directions"][0]["productIds"] == [p["id"]]
    payload["scene"]["moodboards"][0]["catalogReferences"] = [p]
    assert client.post("/api/projects", json=payload).status_code == 201
    payload["scene"]["moodboards"][0]["catalogReferences"][0]["code"] = "FAKE"
    assert client.post("/api/projects", json=payload).status_code == 422


def test_catalog_migration_repeatable_preserves_projects(client, payload):
    from backend.catalog import init_catalog

    a = create(client, payload)
    init_catalog(m.engine)
    init_catalog(m.engine)
    assert client.get("/api/projects/" + a["id"]).json()["scene"] == payload["scene"]


def test_desktop_session_disabled_on_web(client):
    assert client.post('/api/desktop-session').status_code == 404
    assert client.get('/api/health').json() == {'status':'ok'}


def test_desktop_token_gate_and_local_session(client, monkeypatch):
    monkeypatch.setenv('DESKTOP_API_TOKEN', 'test-private-process-key')
    assert client.get('/api/health').status_code == 401
    assert client.post('/api/desktop-session').status_code == 401
    headers={'x-studio-desktop-token':'test-private-process-key'}
    client.post('/api/logout',headers=headers)
    assert client.get('/api/me',headers=headers).status_code == 401
    assert client.post('/api/desktop-session',headers=headers).status_code == 200
    assert client.get('/api/me',headers=headers).status_code == 200
