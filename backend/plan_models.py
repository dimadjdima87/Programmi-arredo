"""Persisted CAD geometry and explicitly reviewed local recognition results."""

import hashlib
import json
import math
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from shapely.geometry import Polygon


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


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


class Point(Strict):
    x: float = Field(ge=0, le=50000)
    y: float = Field(ge=0, le=50000)


class RecognizedWall(Strict):
    id: str = Field(min_length=1, max_length=64)
    start: Point
    end: Point
    thickness: float = Field(ge=50, le=1000)
    evidence: str = Field(max_length=300)
    certainty: Literal["strong", "possible", "manual"] = "possible"

    @model_validator(mode="after")
    def length(self):
        if math.hypot(self.start.x - self.end.x, self.start.y - self.end.y) < 100:
            raise ValueError("Muro riconosciuto inferiore a 100 mm")
        return self


class RecognizedOpening(Strict):
    id: str = Field(min_length=1, max_length=64)
    wallId: str = Field(min_length=1, max_length=64)
    kind: Literal["door", "window", "unknown"]
    offset: float = Field(ge=0, le=50000)
    width: float = Field(ge=100, le=10000)
    evidence: str = Field(max_length=300)
    certainty: Literal["strong", "possible", "manual"] = "possible"


class RecognizedRoom(Strict):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=100)
    kind: Literal[
        "unknown", "kitchen", "living", "bedroom", "bathroom", "circulation", "other"
    ] = "unknown"
    points: list[Point] = Field(min_length=3, max_length=100)
    evidence: str = Field(max_length=300)

    @model_validator(mode="after")
    def polygon(self):
        poly = Polygon([(p.x, p.y) for p in self.points])
        if not poly.is_valid or poly.area < 10000:
            raise ValueError("Contorno ambiente non valido o inferiore a 0,01 m²")
        return self


def fingerprint(reference: CadReference):
    data = reference.model_dump(
        include={"sha256", "width", "height", "paths", "millimetersPerUnit"}
    )
    return hashlib.sha256(
        json.dumps(
            data, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode()
    ).hexdigest()


class Recognition(Strict):
    engine: Literal["cad-geometry-v1"] = "cad-geometry-v1"
    referenceFingerprint: str = Field(pattern="^[a-f0-9]{64}$")
    reviewed: bool = False
    walls: list[RecognizedWall] = Field(max_length=500)
    openings: list[RecognizedOpening] = Field(max_length=300)
    rooms: list[RecognizedRoom] = Field(max_length=100)
    warnings: list[str] = Field(max_length=50)

    @model_validator(mode="after")
    def topology(self):
        ids = [x.id for x in [*self.walls, *self.openings, *self.rooms]]
        if len(ids) != len(set(ids)):
            raise ValueError("Identificativi del riconoscimento duplicati")
        walls = {w.id: w for w in self.walls}
        for o in self.openings:
            w = walls.get(o.wallId)
            if not w:
                raise ValueError("Apertura riconosciuta senza muro associato")
            length = math.hypot(w.end.x - w.start.x, w.end.y - w.start.y)
            if o.offset + o.width > length + 1:
                raise ValueError("Apertura riconosciuta fuori dal muro")
        groups = {}
        for o in self.openings:
            for old in groups.setdefault(o.wallId, []):
                if (
                    min(o.offset + o.width, old.offset + old.width)
                    - max(o.offset, old.offset)
                    > 1
                ):
                    raise ValueError(
                        "Aperture riconosciute sovrapposte sullo stesso muro"
                    )
            groups[o.wallId].append(o)
        if any(len(x) > 300 for x in self.warnings):
            raise ValueError("Nota del riconoscimento troppo lunga")
        return self

    def validate_reference(self, reference: CadReference):
        if self.referenceFingerprint != fingerprint(reference):
            raise ValueError(
                "Il riconoscimento si riferisce a una planimetria diversa: ripetere l’analisi"
            )
        points = [p for w in self.walls for p in [w.start, w.end]] + [
            p for r in self.rooms for p in r.points
        ]
        if any(
            p.x > reference.width + 0.01 or p.y > reference.height + 0.01
            for p in points
        ):
            raise ValueError("Elemento riconosciuto fuori dalla planimetria")
        return self
