import copy
import hashlib
import hmac
import json
import math
import os
import secrets
import time
from uuid import uuid4

from fastapi import Cookie, Depends, FastAPI, HTTPException, Response, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import create_engine, text
from backend.catalog import register_catalog, validate_scene_catalog
from backend.kitchen import register_kitchen

engine = create_engine(os.getenv("DATABASE_URL", "sqlite:///./studio.db"))
app = FastAPI(title="Albertelli Design Studio — DEMO", version="0.2.0")


@app.middleware("http")
async def desktop_guard(request: Request, call_next):
    token = os.getenv("DESKTOP_API_TOKEN")
    if token and not hmac.compare_digest(request.headers.get("x-studio-desktop-token", ""), token):
        return JSONResponse({"detail": "Accesso desktop non autorizzato"}, status_code=401)
    return await call_next(request)


@app.get("/api/health")
def health():
    return {"status": "ok", "desktop": bool(os.getenv("DESKTOP_API_TOKEN"))}


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Wall(Strict):
    id: str
    x: float = Field(ge=0, le=50000)
    y: float = Field(ge=0, le=50000)


class Opening(Strict):
    id: str
    wallId: str
    kind: str = Field(pattern="^(door|window)$")
    offset: float = Field(ge=0)
    width: float = Field(ge=100, le=10000)
    height: float = Field(gt=0, le=6000)
    sill: float = Field(ge=0, le=5000)
    swing: str = Field(default="left", pattern="^(left|right)$")


class Item(Strict):
    id: str
    label: str = Field(min_length=1, max_length=100)
    x: float = Field(ge=0, le=50000)
    y: float = Field(ge=0, le=50000)
    width: float = Field(gt=0, le=10000)
    depth: float = Field(gt=0, le=10000)
    height: float = Field(gt=0, le=6000)
    rotation: float = Field(ge=-360, le=360)
    finish: str = Field(pattern="^#[0-9a-fA-F]{6}$")
    locked: bool = False
    verification: str = Field(default="DEMO", pattern="^(DEMO|verified)$")

    catalogProduct: dict | None = None
    catalogFinish: dict | None = None


class Moodboard(Strict):
    id: str
    title: str = Field(min_length=1, max_length=100)
    palette: list[str] = Field(min_length=3, max_length=6)
    notes: str = Field(max_length=4000)
    approved: bool = False
    catalogReferences: list[dict] | None = Field(default=None, max_length=100)
    provenance: dict | None = None

    @model_validator(mode="after")
    def colors(self):
        import re

        if any(not re.fullmatch("#[0-9a-fA-F]{6}", c) for c in self.palette):
            raise ValueError("Palette non valida")
        return self


class CadPath(Strict):
    layer: str = Field(max_length=100)
    points: list[float] = Field(min_length=4, max_length=20000)

    @model_validator(mode="after")
    def coordinates(self):
        if len(self.points) % 2 or any(v < 0 or v > 50000 for v in self.points):
            raise ValueError("Coordinate CAD non valide")
        return self


class CadReference(Strict):
    filename: str = Field(min_length=1, max_length=255)
    sha256: str = Field(pattern="^[a-f0-9]{64}$")
    format: str = Field(pattern="^(dwg|dxf)$")
    sourceUnit: str = Field(max_length=30)
    millimetersPerUnit: float = Field(gt=0, le=1000000)
    width: float = Field(gt=0, le=50000)
    height: float = Field(gt=0, le=50000)
    originX: float
    originY: float
    paths: list[CadPath] = Field(min_length=1, max_length=5000)
    warnings: list[str] = Field(max_length=50)

    @model_validator(mode="after")
    def size(self):
        if sum(len(p.points) for p in self.paths) > 120000:
            raise ValueError("Planimetria troppo dettagliata")
        if any(len(w) > 300 for w in self.warnings):
            raise ValueError("Nota CAD troppo lunga")
        return self


class Scene(Strict):
    schemaVersion: str = Field(default="1.0", pattern="^1\\.0$")
    units: str = Field(default="mm", pattern="^mm$")
    height: float = Field(gt=0, le=6000)
    reference: CadReference | None = None
    walls: list[Wall] = Field(max_length=100)
    openings: list[Opening] = Field(max_length=100)
    items: list[Item] = Field(max_length=500)
    moodboards: list[Moodboard] = Field(min_length=2, max_length=10)

    @model_validator(mode="after")
    def geometry(self):
        def fail(msg):
            raise ValueError(msg)

        ids = [
            o.id for o in [*self.walls, *self.openings, *self.items, *self.moodboards]
        ]
        if len(ids) != len(set(ids)):
            fail("Identificativi duplicati")
        n = len(self.walls)
        if n < 3:
            if n == 0 and self.reference and not self.openings:
                return self
            fail("Definire almeno tre vertici o importare una planimetria CAD")

        def cross(a, b, c):
            return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

        def on(a, b, c):
            return (
                abs(cross(a, b, c)) < 1e-6
                and min(a.x, b.x) <= c.x <= max(a.x, b.x)
                and min(a.y, b.y) <= c.y <= max(a.y, b.y)
            )

        def intersects(a, b, c, d):
            return (
                (
                    cross(a, b, c) * cross(a, b, d) < 0
                    and cross(c, d, a) * cross(c, d, b) < 0
                )
                or on(a, b, c)
                or on(a, b, d)
                or on(c, d, a)
                or on(c, d, b)
            )

        area = sum(
            w.x * self.walls[(i + 1) % n].y - self.walls[(i + 1) % n].x * w.y
            for i, w in enumerate(self.walls)
        )
        if abs(area) < 20000:
            fail("Area stanza insufficiente")
        lengths = {}
        for i, a in enumerate(self.walls):
            b = self.walls[(i + 1) % n]
            length = math.hypot(b.x - a.x, b.y - a.y)
            if length < 100:
                fail("Muro inferiore a 100 mm")
            lengths[a.id] = length
            for j in range(i + 1, n):
                if j == i + 1 or (i == 0 and j == n - 1):
                    continue
                if intersects(a, b, self.walls[j], self.walls[(j + 1) % n]):
                    fail("Il perimetro si interseca")
        for o in self.openings:
            if o.wallId not in lengths:
                fail("Muro apertura inesistente")
            if o.offset + o.width > lengths[o.wallId] + 1e-6:
                fail("Apertura fuori dal muro")
            if o.height + o.sill > self.height:
                fail("Apertura oltre altezza stanza")
        for i, a in enumerate(self.openings):
            for b in self.openings[i + 1 :]:
                if a.wallId == b.wallId and max(a.offset, b.offset) < min(
                    a.offset + a.width, b.offset + b.width
                ):
                    fail("Aperture sovrapposte")
        return self


class Save(Strict):
    title: str = Field(min_length=1, max_length=150)
    brief: str = Field(default="", max_length=4000)
    scene: Scene
    expectedRevision: int = Field(ge=0)


class Login(Strict):
    email: str
    password: str


def init_db():
    with engine.begin() as c:
        c.execute(
            text(
                "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)"
            )
        )
        c.execute(
            text(
                "INSERT INTO schema_version(version) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version)"
            )
        )
        c.execute(
            text(
                "CREATE TABLE IF NOT EXISTS users (id VARCHAR(36) PRIMARY KEY, email VARCHAR(200) UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL)"
            )
        )
        c.execute(
            text(
                "CREATE TABLE IF NOT EXISTS sessions (token_hash VARCHAR(64) PRIMARY KEY, user_id VARCHAR(36) NOT NULL REFERENCES users(id), expires DOUBLE PRECISION NOT NULL)"
            )
        )
        c.execute(
            text(
                "CREATE TABLE IF NOT EXISTS projects (id VARCHAR(36) PRIMARY KEY, owner_id VARCHAR(36) NOT NULL REFERENCES users(id), title TEXT NOT NULL, brief TEXT NOT NULL, revision INTEGER NOT NULL, scene TEXT NOT NULL)"
            )
        )
        c.execute(
            text("CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner_id)")
        )
        c.execute(
            text(
                "CREATE TABLE IF NOT EXISTS versions (project_id VARCHAR(36) NOT NULL REFERENCES projects(id), revision INTEGER NOT NULL, payload TEXT NOT NULL, created DOUBLE PRECISION NOT NULL, PRIMARY KEY(project_id, revision))"
            )
        )
        for i, email in enumerate(["designer@demo.local", "viewer@demo.local"]):
            if not c.execute(
                text("SELECT id FROM users WHERE email=:email"), {"email": email}
            ).first():
                salt = secrets.token_hex(16)
                password = os.getenv("DEMO_PASSWORD", "DemoStudio2026!")
                c.execute(
                    text("INSERT INTO users VALUES (:id,:email,:hash,:salt)"),
                    {
                        "id": str(uuid4()),
                        "email": email,
                        "hash": hashlib.scrypt(
                            password.encode(), salt=salt.encode(), n=16384, r=8, p=1
                        ).hex(),
                        "salt": salt,
                    },
                )


init_db()


def user(studio_session: str | None = Cookie(default=None)):
    if not studio_session:
        raise HTTPException(401, "Accedi per continuare")
    with engine.connect() as c:
        row = (
            c.execute(
                text(
                    "SELECT u.id,u.email FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token_hash=:token AND s.expires>:now"
                ),
                {
                    "token": hashlib.sha256(studio_session.encode()).hexdigest(),
                    "now": time.time(),
                },
            )
            .mappings()
            .first()
        )
    if not row:
        raise HTTPException(401, "Sessione scaduta")
    return dict(row)


def project(c, pid, uid):
    row = (
        c.execute(
            text("SELECT * FROM projects WHERE id=:id AND owner_id=:owner"),
            {"id": pid, "owner": uid},
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(404, "Progetto non trovato")
    return dict(row)


def output(row):
    return {k: v for k, v in row.items() if k != "owner_id"} | {
        "scene": json.loads(row["scene"])
    }


@app.post("/api/login")
def login(data: Login, response: Response):
    with engine.begin() as c:
        row = (
            c.execute(
                text("SELECT * FROM users WHERE email=:email"), {"email": data.email}
            )
            .mappings()
            .first()
        )
        salt = row["salt"] if row else "dummy-salt"
        candidate = hashlib.scrypt(
            data.password.encode(), salt=salt.encode(), n=16384, r=8, p=1
        ).hex()
        if not row or not hmac.compare_digest(candidate, row["password_hash"]):
            raise HTTPException(401, "Credenziali non valide")
        token = secrets.token_urlsafe(32)
        c.execute(text("DELETE FROM sessions WHERE expires<:now"), {"now": time.time()})
        c.execute(
            text("INSERT INTO sessions VALUES (:token,:uid,:expires)"),
            {
                "token": hashlib.sha256(token.encode()).hexdigest(),
                "uid": row["id"],
                "expires": time.time() + 28800,
            },
        )
    response.set_cookie(
        "studio_session",
        token,
        httponly=True,
        samesite="strict",
        secure=os.getenv("COOKIE_SECURE") == "1",
        max_age=28800,
    )
    return {"email": row["email"]}


@app.post("/api/desktop-session")
def desktop_session(response: Response):
    # The middleware requires a per-process secret. Never enabled on the web app.
    if not os.getenv("DESKTOP_API_TOKEN"):
        raise HTTPException(404, "Modalità desktop non attiva")
    with engine.begin() as c:
        uid = c.execute(text("SELECT id FROM users WHERE email=:email"), {"email": "designer@demo.local"}).scalar_one()
        token = secrets.token_urlsafe(32)
        c.execute(text("DELETE FROM sessions WHERE expires<:now"), {"now": time.time()})
        c.execute(text("INSERT INTO sessions VALUES (:token,:uid,:expires)"), {"token": hashlib.sha256(token.encode()).hexdigest(), "uid":uid, "expires":time.time()+28800})
    response.set_cookie("studio_session",token,httponly=True,samesite="strict",max_age=28800)
    return {"email":"designer@demo.local"}


@app.get("/api/me")
def me(u=Depends(user)):
    return {"email": u["email"]}


@app.post("/api/logout")
def logout(response: Response, studio_session: str | None = Cookie(default=None)):
    with engine.begin() as c:
        c.execute(
            text("DELETE FROM sessions WHERE token_hash=:token"),
            {"token": hashlib.sha256((studio_session or "").encode()).hexdigest()},
        )
    response.delete_cookie("studio_session")
    return {"ok": True}


@app.get("/api/projects")
def listing(u=Depends(user)):
    with engine.connect() as c:
        return [
            dict(r)
            for r in c.execute(
                text(
                    "SELECT id,title,revision FROM projects WHERE owner_id=:uid ORDER BY title"
                ),
                {"uid": u["id"]},
            ).mappings()
        ]


def snapshot(c, pid, revision, payload):
    c.execute(
        text("INSERT INTO versions VALUES (:id,:rev,:data,:now)"),
        {"id": pid, "rev": revision, "data": json.dumps(payload), "now": time.time()},
    )


@app.post("/api/projects", status_code=201)
def create(data: Save, u=Depends(user)):
    if data.expectedRevision != 0:
        raise HTTPException(409, "Revisione iniziale non valida")
    pid = str(uuid4())
    payload = {
        "id": pid,
        "title": data.title,
        "brief": data.brief,
        "revision": 1,
        "scene": data.scene.model_dump(exclude_none=True),
    }
    with engine.begin() as c:
        validate_scene_catalog(c, payload["scene"], u["id"])
        c.execute(
            text("INSERT INTO projects VALUES (:id,:owner,:title,:brief,1,:scene)"),
            {
                "id": pid,
                "owner": u["id"],
                "title": data.title,
                "brief": data.brief,
                "scene": json.dumps(payload["scene"]),
            },
        )
        snapshot(c, pid, 1, payload)
    return payload


@app.get("/api/projects/{pid}")
def get(pid: str, u=Depends(user)):
    with engine.connect() as c:
        return output(project(c, pid, u["id"]))


def check_locks(old, new):
    for item in old["items"]:
        if item["locked"]:
            found = next((i for i in new["items"] if i["id"] == item["id"]), None)
            # Unlock is an explicit standalone operation.
            if found is None or {k: v for k, v in item.items() if k != "locked"} != {
                k: v for k, v in found.items() if k != "locked"
            }:
                raise HTTPException(422, "Sblocca prima gli elementi bloccati")


@app.put("/api/projects/{pid}")
def save(pid: str, data: Save, u=Depends(user)):
    with engine.begin() as c:
        old = project(c, pid, u["id"])
        if old["revision"] != data.expectedRevision:
            raise HTTPException(
                409, "Il progetto è cambiato: ricarica prima di salvare"
            )
        check_locks(json.loads(old["scene"]), data.scene.model_dump(exclude_none=True))
        validate_scene_catalog(
            c,
            data.scene.model_dump(exclude_none=True),
            u["id"],
            json.loads(old["scene"]),
        )
        rev = old["revision"] + 1
        result = c.execute(
            text(
                "UPDATE projects SET title=:title,brief=:brief,scene=:scene,revision=:rev WHERE id=:id AND revision=:expected"
            ),
            {
                "title": data.title,
                "brief": data.brief,
                "scene": data.scene.model_dump_json(exclude_none=True),
                "rev": rev,
                "id": pid,
                "expected": data.expectedRevision,
            },
        )
        if result.rowcount != 1:
            raise HTTPException(409, "Modifica concorrente: ricarica")
        payload = {
            "id": pid,
            "title": data.title,
            "brief": data.brief,
            "scene": data.scene.model_dump(exclude_none=True),
            "revision": rev,
        }
        snapshot(c, pid, rev, payload)
    return payload


@app.get("/api/projects/{pid}/versions")
def versions(pid: str, u=Depends(user)):
    with engine.connect() as c:
        project(c, pid, u["id"])
        return [
            dict(r)
            for r in c.execute(
                text(
                    "SELECT revision,created FROM versions WHERE project_id=:id ORDER BY revision DESC"
                ),
                {"id": pid},
            ).mappings()
        ]


class Restore(Strict):
    expectedRevision: int


@app.post("/api/projects/{pid}/restore/{revision}")
def restore(pid: str, revision: int, data: Restore, u=Depends(user)):
    with engine.begin() as c:
        old = project(c, pid, u["id"])
        if old["revision"] != data.expectedRevision:
            raise HTTPException(409, "Revisione cambiata: ricarica")
        row = c.execute(
            text("SELECT payload FROM versions WHERE project_id=:id AND revision=:rev"),
            {"id": pid, "rev": revision},
        ).first()
        if not row:
            raise HTTPException(404, "Versione non trovata")
        payload = json.loads(row[0])
        Scene.model_validate(payload["scene"])
        payload["revision"] = old["revision"] + 1
        result = c.execute(
            text(
                "UPDATE projects SET title=:title,brief=:brief,scene=:scene,revision=:rev WHERE id=:id AND revision=:expected"
            ),
            {
                "title": payload["title"],
                "brief": payload["brief"],
                "scene": json.dumps(payload["scene"]),
                "rev": payload["revision"],
                "id": pid,
                "expected": data.expectedRevision,
            },
        )
        if result.rowcount != 1:
            raise HTTPException(409, "Modifica concorrente: ricarica")
        snapshot(c, pid, payload["revision"], payload)
    return payload


register_catalog(app, engine, user)
register_kitchen(app, engine, user)
