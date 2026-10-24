"""Local, deterministic CAD interpretation. No model, API key or network calls."""

import math
import re
import threading
from collections import defaultdict
from uuid import uuid4

from fastapi import Depends, HTTPException
from shapely.geometry import LineString, Polygon
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree
from shapely.errors import GEOSException
from pydantic import Field
from backend.plan_models import CadReference, Recognition, Strict, fingerprint

WALL = re.compile(r"mur|wall|paret|tramezz|struct", re.I)
DOOR = re.compile(r"(?:^|[^a-z])(?:doors?|porta|porte)(?:$|[^a-z])", re.I)
WINDOW = re.compile(r"window|finestr|vetrat", re.I)
EXCLUDE = re.compile(
    r"arred|furn|quot|dimens|text|test[oi]|retin|hatch|impiant|electric|plumb", re.I
)
_lock = threading.Lock()


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1]


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def add(a, b):
    return (a[0] + b[0], a[1] + b[1])


def mul(a, t):
    return (a[0] * t, a[1] * t)


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def point(p):
    return {"x": round(p[0], 2), "y": round(p[1], 2)}


def uid():
    return str(uuid4())


def segment(a, b, layer):
    d = sub(b, a)
    length = dist(a, b)
    if length < 100:
        return None
    u = mul(d, 1 / length)
    if u[0] < -1e-8 or (abs(u[0]) < 1e-8 and u[1] < 0):
        a, b, u = b, a, mul(u, -1)
    return {"a": a, "b": b, "u": u, "layer": layer, "length": length}


def circular_arc(points):
    # Circular sweeps produced by the CAD importer, including polylines with a leaf.
    for trim in range(3):
        ps = points[trim:]
        if len(ps) < 6:
            continue
        a, b, c = ps[0], ps[len(ps) // 2], ps[-1]
        bx, by = sub(b, a)
        cx, cy = sub(c, a)
        d = 2 * (bx * cy - by * cx)
        if abs(d) < 1e-5:
            continue
        ux = (cy * (bx * bx + by * by) - by * (cx * cx + cy * cy)) / d
        uy = (bx * (cx * cx + cy * cy) - cx * (bx * bx + by * by)) / d
        center = add(a, (ux, uy))
        r = dist(center, a)
        if not 350 <= r <= 2000:
            continue
        if max(abs(dist(center, p) - r) for p in ps) > max(8, r * 0.02):
            continue
        angle = math.acos(
            max(-1, min(1, dot(sub(a, center), sub(c, center)) / (r * r)))
        )
        if math.pi / 4 <= angle <= math.pi * 0.73:
            return center, r, a, c
    return None


def recognize(reference: CadReference, wall_layers=()):
    warnings = [
        "Riconoscimento locale geometrico, da controllare: non è un modello IA generativo.",
        "Le destinazioni degli ambienti non si deducono dalle sole linee: assegnale nel riepilogo.",
    ]
    paths = [
        (p.layer, list(zip(p.points[::2], p.points[1::2]))) for p in reference.paths
    ]
    if len({layer for layer, _ in paths}) == 1:
        warnings.append(
            "Un solo livello CAD: porte senza arco e finestre senza livelli dedicati possono non essere riconosciute."
        )
    explicit = lambda layer: (
        layer in wall_layers if wall_layers else bool(WALL.search(layer))
    )
    raw = []
    arcs = []
    contours = []
    opening_paths = defaultdict(list)
    for layer, points in paths:
        kind = (
            "window" if WINDOW.search(layer) else "door" if DOOR.search(layer) else None
        )
        if kind:
            opening_paths[kind].append(points)
        arc = circular_arc(points)
        if arc:
            arcs.append((arc, layer))
        if kind or EXCLUDE.search(layer):
            continue
        if wall_layers and layer not in wall_layers:
            continue
        closed = len(points) >= 4 and dist(points[0], points[-1]) < 2
        if closed:
            poly = Polygon(points)
            if poly.is_valid and poly.area >= 1e6:
                contours.append(points)
        for a, b in zip(points, points[1:]):
            seg = segment(a, b, layer)
            if seg and seg["length"] >= 300:
                raw.append(seg)
    if len(raw) > 6000:
        raise ValueError(
            "Troppi segmenti: seleziona solo i livelli dei muri e ripeti l’analisi."
        )
    lines = [LineString([s["a"], s["b"]]) for s in raw]
    tree = STRtree(lines)
    pairs = []
    comparisons = 0
    for i, s in enumerate(raw):
        neighbors = tree.query(lines[i].buffer(600))
        comparisons += len(neighbors)
        if comparisons > 500000:
            raise ValueError(
                "Disegno troppo denso: selezionare solo i livelli dei muri."
            )
        for j in neighbors:
            j = int(j)
            if j <= i:
                continue
            t = raw[j]
            if s["layer"] != t["layer"] or abs(dot(s["u"], t["u"])) < 0.99985:
                continue
            u = s["u"]
            n = (-u[1], u[0])
            gap = abs(dot(sub(t["a"], s["a"]), n))
            if not 70 <= gap <= 600:
                continue
            lo = max(
                min(dot(s["a"], u), dot(s["b"], u)), min(dot(t["a"], u), dot(t["b"], u))
            )
            hi = min(
                max(dot(s["a"], u), dot(s["b"], u)), max(dot(t["a"], u), dot(t["b"], u))
            )
            if hi - lo < max(400, 0.75 * min(s["length"], t["length"])):
                continue
            pairs.append((gap, i, j, lo, hi))
    used = set()
    walls = []
    for gap, i, j, lo, hi in sorted(pairs):
        if i in used or j in used:
            continue
        s, t = raw[i], raw[j]
        u = s["u"]
        n = (-u[1], u[0])
        offset = (dot(s["a"], n) + dot(t["a"], n)) / 2
        walls.append(
            {
                **segment(
                    add(mul(u, lo), mul(n, offset)),
                    add(mul(u, hi), mul(n, offset)),
                    s["layer"],
                ),
                "thickness": gap,
                "certainty": "strong" if explicit(s["layer"]) else "possible",
                "evidence": "Due linee parallele del CAD; spessore misurato fra le linee.",
                "gaps": [],
            }
        )
        used.update([i, j])
    for i, s in enumerate(raw):
        if i not in used and explicit(s["layer"]):
            walls.append(
                {
                    **s,
                    "thickness": 200,
                    "certainty": "possible",
                    "evidence": "Livello dei muri; spessore ipotizzato 200 mm, da correggere.",
                    "gaps": [],
                }
            )
    if not walls:
        for points in contours:
            for a, b in zip(points, points[1:]):
                s = segment(a, b, "contorno")
                if s and s["length"] >= 300:
                    walls.append(
                        {
                            **s,
                            "thickness": 200,
                            "certainty": "possible",
                            "evidence": "Contorno CAD chiuso: possibile muro, spessore ipotizzato 200 mm.",
                            "gaps": [],
                        }
                    )
        if contours:
            warnings.append(
                "Muri ricavati da contorni chiusi: controllare che non siano arredi o quote."
            )
    if len(walls) > 500:
        raise ValueError("Troppi muri candidati: limita i livelli della pianta.")
    # Join collinear host walls across probable openings. Every bridged gap is retained.
    changed = True
    while changed:
        changed = False
        for i, s in enumerate(walls):
            for j in range(i + 1, len(walls)):
                t = walls[j]
                u = s["u"]
                n = (-u[1], u[0])
                if (
                    abs(dot(u, t["u"])) < 0.99985
                    or abs(dot(sub(t["a"], s["a"]), n)) > 20
                    or abs(s["thickness"] - t["thickness"]) > 40
                ):
                    continue
                sa, sb = sorted([dot(s["a"], u), dot(s["b"], u)])
                ta, tb = sorted([dot(t["a"], u), dot(t["b"], u)])
                gap = max(sa, ta) - min(sb, tb)
                if gap > 1500:
                    continue
                if gap > 30:
                    s["gaps"].append(
                        (
                            add(s["a"], mul(u, min(sb, tb) - sa)),
                            add(s["a"], mul(u, max(sa, ta) - sa)),
                        )
                    )
                start = add(s["a"], mul(u, min(sa, ta) - sa))
                end = add(s["a"], mul(u, max(sb, tb) - sa))
                s.update(
                    {**segment(start, end, s["layer"]), "gaps": s["gaps"] + t["gaps"]}
                )
                walls.pop(j)
                changed = True
                break
            if changed:
                break
    # Bring wall centerlines to nearby intersections, without moving parallel walls.
    endpoints = []
    for i, s in enumerate(walls):
        ends = []
        for p in [s["a"], s["b"]]:
            best = p
            best_dist = 350
            for j, t in enumerate(walls):
                if i == j:
                    continue
                u, v = s["u"], t["u"]
                den = u[0] * v[1] - u[1] * v[0]
                if abs(den) < 0.05:
                    continue
                d = sub(t["a"], s["a"])
                a = (d[0] * v[1] - d[1] * v[0]) / den
                q = add(s["a"], mul(u, a))
                b = dot(sub(q, t["a"]), v)
                distance = dist(p, q)
                if (
                    distance < best_dist
                    and -350 <= b <= t["length"] + 350
                    and 0 <= q[0] <= reference.width
                    and 0 <= q[1] <= reference.height
                ):
                    best = q
                    best_dist = distance
            ends.append(best)
        endpoints.append(ends)
    for s, ends in zip(walls, endpoints):
        updated = segment(*ends, s["layer"])
        if updated:
            s.update(updated)
    walls = [s for s in walls if s["length"] >= 100]
    for w in walls:
        w["id"] = uid()
    openings = []

    def aperture(points, kind, evidence, hinge=None, radius=None):
        if not walls:
            return
        best = None
        for w in walls:
            u = w["u"]
            n = (-u[1], u[0])
            projection = [dot(sub(p, w["a"]), u) for p in points]
            lo = max(0, min(projection))
            hi = min(w["length"], max(projection))
            center = (
                hinge
                if hinge
                else (
                    (min(p[0] for p in points) + max(p[0] for p in points)) / 2,
                    (min(p[1] for p in points) + max(p[1] for p in points)) / 2,
                )
            )
            distance = abs(dot(sub(center, w["a"]), n))
            if radius:
                h = dot(sub(hinge, w["a"]), u)
                end = max(projection, key=lambda t: abs(t - h))
                lo = max(0, min(h, end))
                hi = min(w["length"], max(h, end))
            if (
                distance > max(350, w["thickness"] / 2 + 150)
                or not 250 <= hi - lo <= 4500
            ):
                continue
            score = distance
            if best is None or score < best[0]:
                best = (score, w, lo, hi)
        if best:
            _, w, lo, hi = best
            for o in openings:
                if (
                    o["wallId"] == w["id"]
                    and min(hi, o["offset"] + o["width"]) - max(lo, o["offset"]) > 20
                ):
                    return
            openings.append(
                {
                    "id": uid(),
                    "wallId": w["id"],
                    "kind": kind,
                    "offset": round(lo, 2),
                    "width": round(hi - lo, 2),
                    "evidence": evidence,
                    "certainty": "possible",
                }
            )

    # Connected graphics on explicit opening layers; never classify furniture as windows.
    for kind, sets in opening_paths.items():
        graphics = [LineString(ps) for ps in sets if len(ps) > 1]
        index = STRtree(graphics)
        parents = list(range(len(graphics)))

        def root(i):
            while parents[i] != i:
                parents[i] = parents[parents[i]]
                i = parents[i]
            return i

        for i, line in enumerate(graphics):
            for j in index.query(line.buffer(25)):
                j = int(j)
                if line.distance(graphics[j]) <= 25:
                    parents[root(j)] = root(i)
        groups = defaultdict(list)
        for i, line in enumerate(graphics):
            groups[root(i)].extend(line.coords)
        for ps in groups.values():
            aperture(
                ps,
                kind,
                "Geometria su un livello CAD dedicato a "
                + ("porte." if kind == "door" else "finestre."),
            )
    for (center, radius, a, b), layer in arcs:
        if WINDOW.search(layer) or EXCLUDE.search(layer):
            continue
        aperture(
            [center, a, b],
            "door",
            "Possibile porta: arco circolare di apertura, da verificare.",
            center,
            radius,
        )
    for w in walls:
        for a, b in w["gaps"]:
            lo = max(0, min(dot(sub(a, w["a"]), w["u"]), dot(sub(b, w["a"]), w["u"])))
            hi = min(
                w["length"],
                max(dot(sub(a, w["a"]), w["u"]), dot(sub(b, w["a"]), w["u"])),
            )
            if not 250 <= hi - lo <= 1800:
                continue
            if any(
                o["wallId"] == w["id"]
                and min(hi, o["offset"] + o["width"]) - max(lo, o["offset"]) > 20
                for o in openings
            ):
                continue
            openings.append(
                {
                    "id": uid(),
                    "wallId": w["id"],
                    "kind": "unknown",
                    "offset": round(lo, 2),
                    "width": round(hi - lo, 2),
                    "evidence": "Interruzione fra tratti di muro allineati; classificare porta, finestra o rimuovere.",
                    "certainty": "possible",
                }
            )
    if len(openings) > 300:
        raise ValueError("Troppe aperture candidate: riduci i livelli selezionati.")
    rooms = find_rooms(walls, warnings)
    if not walls:
        warnings.append(
            "Nessun muro riconosciuto: seleziona i livelli dei muri o aggiungi gli elementi manualmente."
        )
    if walls and not rooms:
        warnings.append(
            "Nessun ambiente chiuso ricostruito. Verifica collegamenti e spessori dei muri."
        )
    if not any(o["kind"] == "window" for o in openings):
        warnings.append(
            "Nessuna finestra identificata con evidenza sufficiente: controllare e aggiungere quelle mancanti."
        )
    result = Recognition.model_validate(
        {
            "referenceFingerprint": fingerprint(reference),
            "reviewed": False,
            "walls": [
                {
                    "id": w["id"],
                    "start": point(w["a"]),
                    "end": point(w["b"]),
                    "thickness": round(w["thickness"], 2),
                    "evidence": w["evidence"],
                    "certainty": w["certainty"],
                }
                for w in walls
            ],
            "openings": openings,
            "rooms": rooms,
            "warnings": list(dict.fromkeys(warnings))[:50],
        }
    )
    return result.validate_reference(reference)


def find_rooms(walls, warnings):
    rooms = []
    if walls:
        axes = [LineString([w["a"], w["b"]]) for w in walls]
        solid = unary_union(
            [
                line.buffer(w["thickness"] / 2, cap_style=2, join_style=2)
                for line, w in zip(axes, walls)
            ]
        )
        for face in polygonize(unary_union(axes)):
            interior = face.difference(solid).simplify(5, preserve_topology=True)
            parts = (
                list(interior.geoms)
                if interior.geom_type == "MultiPolygon"
                else [interior]
            )
            for poly in parts:
                if poly.geom_type != "Polygon" or poly.area < 0.5e6:
                    continue
                if poly.interiors:
                    warnings.append(
                        "Un ambiente con fori o pilastri interni non è stato ricostruito: aggiungerlo manualmente."
                    )
                    continue
                coords = list(poly.exterior.coords)[:-1]
                if len(coords) > 100:
                    continue
                if len(rooms) >= 100:
                    raise ValueError("Troppi ambienti: limitare i livelli del CAD.")
                rooms.append(
                    {
                        "id": uid(),
                        "name": f"Ambiente {len(rooms)+1}",
                        "kind": "unknown",
                        "points": [point(p) for p in coords],
                        "evidence": "Contorno chiuso fra muri candidati; superficie dipendente dagli spessori da verificare.",
                    }
                )
    if len(rooms) > 100:
        raise ValueError("Troppi ambienti candidati: limita l’area del CAD.")
    return rooms


class AnalyzeRequest(Strict):
    reference: CadReference
    wallLayers: list[str] = Field(default_factory=list, max_length=100)


class ValidateRequest(Strict):
    reference: CadReference
    recognition: Recognition


def register_recognition(app, user):
    @app.post("/api/plan/recognize")
    def analyze(data: AnalyzeRequest, u=Depends(user)):
        if any(len(x) > 100 for x in data.wallLayers):
            raise HTTPException(422, "Nome livello troppo lungo")
        if not _lock.acquire(blocking=False):
            raise HTTPException(
                409, "Un’analisi locale è già in corso. Riprova fra poco."
            )
        try:
            return recognize(data.reference, data.wallLayers).model_dump()
        except (ValueError, ArithmeticError, GEOSException):
            raise HTTPException(
                422,
                "Planimetria non ricostruibile con questi livelli. Seleziona i livelli dei muri o correggi il disegno.",
            )
        finally:
            _lock.release()

    @app.post("/api/plan/validate")
    def validate(data: ValidateRequest, u=Depends(user)):
        try:
            result = data.recognition.validate_reference(data.reference)
        except ValueError as error:
            raise HTTPException(422, str(error))
        return result.model_dump()

    @app.post("/api/plan/rooms")
    def recalculate(data: ValidateRequest, u=Depends(user)):
        try:
            result = data.recognition.validate_reference(data.reference)
            warnings = [
                "Ambienti ricalcolati dai muri modificati: verificare i nuovi contorni e assegnare i nomi."
            ]
            walls = [
                {
                    **segment((w.start.x, w.start.y), (w.end.x, w.end.y), "manual"),
                    "thickness": w.thickness,
                }
                for w in result.walls
            ]
            rooms = find_rooms(walls, warnings)
            result = Recognition.model_validate(
                {
                    **result.model_dump(),
                    "rooms": rooms,
                    "reviewed": False,
                    "warnings": warnings,
                }
            )
            return result.validate_reference(data.reference).model_dump()
        except (ValueError, GEOSException):
            raise HTTPException(
                422, "Correggi muri e aperture prima di ricalcolare gli ambienti."
            )
