import math
import pytest
from backend.plan_models import CadReference, Recognition, fingerprint
from backend.recognition import recognize


def reference(paths, width=4200, height=3600):
    return CadReference.model_validate(
        dict(
            filename="prova.dwg",
            sha256="a" * 64,
            format="dwg",
            sourceUnit="Millimetri",
            millimetersPerUnit=1,
            width=width,
            height=height,
            originX=0,
            originY=height,
            paths=paths,
            warnings=[],
        )
    )


def rectangle(layer, x, y, w, h):
    return dict(layer=layer, points=[x, y, x + w, y, x + w, y + h, x, y + h, x, y])


def test_parallel_walls_door_arc_window_and_floor_area():
    arc = [
        v
        for i in range(19)
        for v in (
            1000 + 800 * math.cos(-i * math.pi / 36),
            3500 + 800 * math.sin(-i * math.pi / 36),
        )
    ]
    ref = reference(
        [
            rectangle("MURI_PORTANTI", 0, 0, 4200, 3600),
            rectangle("MURI_PORTANTI", 200, 200, 3800, 3200),
            rectangle("FINESTRE", 1000, 0, 1200, 200),
            dict(layer="0", points=arc),
        ]
    )
    result = recognize(ref)
    assert len(result.walls) == 4
    assert all(w.thickness == 200 for w in result.walls)
    assert [o.kind for o in result.openings].count("window") == 1
    assert [o.kind for o in result.openings].count("door") == 1
    assert sorted(round(o.width) for o in result.openings) == [800, 1200]
    assert len(result.rooms) == 1
    p = result.rooms[0].points
    area = (
        abs(
            sum(
                v.x * p[(i + 1) % len(p)].y - p[(i + 1) % len(p)].x * v.y
                for i, v in enumerate(p)
            )
        )
        / 2e6
    )
    assert area == pytest.approx(12.16)
    assert result.rooms[0].kind == "unknown"
    assert result.reviewed is False
    assert result.referenceFingerprint == fingerprint(ref)


def test_two_rooms_and_rotated_geometry():
    base = [
        rectangle("WALL", 0, 0, 5000, 4000),
        dict(layer="WALL", points=[2500, 0, 2500, 4000]),
    ]
    # A rotated drawing exercises geometry rather than axis-specific templates.
    angle = 0.31
    for path in base:
        ps = []
        for x, y in zip(path["points"][::2], path["points"][1::2]):
            ps.extend(
                [
                    2000 + x * math.cos(angle) - y * math.sin(angle),
                    300 + x * math.sin(angle) + y * math.cos(angle),
                ]
            )
        path["points"] = ps
    result = recognize(reference(base, 8000, 7000))
    assert len(result.walls) == 5
    assert len(result.rooms) == 2
    assert not result.openings


def test_no_fabricated_windows_from_furniture_or_empty_geometry():
    result = recognize(reference([rectangle("ARREDI", 500, 500, 2000, 2000)]))
    assert result.walls == result.openings == result.rooms == []
    assert any("Nessun muro" in s for s in result.warnings)


def test_reject_stale_analysis_and_orphan_opening():
    ref = reference([rectangle("MURI", 0, 0, 4200, 3600)])
    result = recognize(ref)
    ref.paths[0].points[0] = 1
    with pytest.raises(ValueError, match="diversa"):
        result.validate_reference(ref)
    data = result.model_dump()
    data["openings"] = [
        dict(
            id="a",
            wallId="missing",
            kind="door",
            offset=0,
            width=800,
            evidence="Test",
            certainty="manual",
        )
    ]
    with pytest.raises(ValueError, match="senza muro"):
        Recognition.model_validate(data)


def test_gap_kept_as_unknown_and_layer_selection():
    ref = reference(
        [
            dict(layer="MURI", points=[0, 100, 1500, 100]),
            dict(layer="MURI", points=[2300, 100, 4200, 100]),
            rectangle("ARREDI", 100, 100, 2000, 2000),
        ]
    )
    result = recognize(ref, ["MURI"])
    assert len(result.walls) == 1
    assert len(result.openings) == 1
    assert result.openings[0].kind == "unknown"
    assert result.openings[0].width == 800
