"""Audit a generated catalog against the original PDF and visually read samples."""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sqlite3
import zipfile


REFERENCE_SHA256 = "ce4a42c404d6c41565d523d1c2ad08f116dbcc4318f6c85dbfcdb34dcecdd2c4"
# Transcribed from rendered PDF pages 200 (M 3.6) and 295 (M 4.1).
# This is a numeric sample, not approval of all configurations or notes.
VISUAL_REFERENCE = {
    (188, "7904"): [0],
    (188, "7913"): [0],
    (189, "7994"): [0],
    (189, "7906"): [0],
    (200, "21008"): [1006, 1028, 1057, 1088, 1091, 1111, 1129, None, 1152, None],
    (200, "22008"): [1050, 1073, 1089, 1129, 1134, 1152, 1169, None, None, None],
    (200, "20129"): [1247, 1275, 1291, 1324, 1333, 1348, 1365, None, 1388, None],
    (200, "23129"): [1278, 1302, 1320, 1355, 1365, 1384, 1400, None, None, None],
    (200, "20140"): [1783, 1810, 1828, 1860, 1867, 1883, 1901, None, 1921, None],
    (200, "22140"): [1815, 1835, 1857, 1892, 1902, 1917, 1930, None, None, None],
    (200, "22270"): [623, 635, 673, 683, 685, 688, 689, None, 708, None],
    (200, "21111"): [656, 688, 707, 715, 717, 721, 724, None, 758, None],
    (200, "21125"): [968, 999, 1021, 1028, 1031, 1041, 1051, None, 1086, None],
    (200, "128"): [679, 694, 724, 736, 737, 739, 740, None, 762, None],
    (200, "21123"): [908, 943, 965, 972, 975, 987, 994, None, 1022, None],
    (295, "7410"): ["23.8", None],
    (295, "7668"): ["32.4", None],
    (295, "7669"): ["32.9", None],
    (295, "7412"): ["33", None],
    (295, "7670"): ["40.6", None],
    (295, "7671"): ["41.2", None],
    (295, "7413"): ["41.5", None],
    (295, "7460"): ["27.6", "47.7"],
    (295, "7701"): ["36.5", "75.8"],
    (295, "7702"): ["36.6", "75.9"],
    (295, "7462"): ["43.8", "81"],
    (295, "7703"): ["44.4", "81.5"],
    (295, "7704"): ["44.5", "81.8"],
    (295, "7463"): ["44.8", "81.9"],
}


def audit(pdf, folder):
    if not __debug__:
        raise RuntimeError("Eseguire l'audit senza -O: tutti i controlli devono restare attivi")
    data = json.loads((folder / "catalogo.json").read_text())
    digest = hashlib.file_digest(pdf.open("rb"), "sha256").hexdigest()
    if digest != REFERENCE_SHA256 or digest != data["manifest"]["sourceSha256"]:
        raise ValueError("La fonte non corrisponde al manuale del campione verificato")
    assert len(data["pages"]) == 1086
    assert [p["page"] for p in data["pages"]] == list(range(1, 1087))
    assert len({r["id"] for r in data["rows"]}) == len(data["rows"])
    by_key = {(r["page"], r["code"]): r for r in data["rows"]}
    for key, expected in VISUAL_REFERENCE.items():
        row = by_key[key]
        actual = [c["points"] for c in row["cells"]]
        expected = [None if v is None else str(v) for v in expected]
        assert actual == expected, (key, actual, expected)
    assert by_key[(400, "084")]["code"] == "084", "Codice con zero iniziale perso"
    for row in data["rows"]:
        assert row["commercialStatus"] == "needs_review" and not row["usableForPricing"]
        if row["numericStatus"] == "cross_checked":
            assert not row["issues"] and all(c["crossChecked"] for c in row["cells"])
        for cell in row["cells"]:
            if cell["raw"] in {"—", "–"}:
                assert cell["points"] is None and cell["available"] is False
    with sqlite3.connect(folder / "catalogo.sqlite") as db:
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert db.execute("SELECT count(*) FROM pages").fetchone()[0] == 1086
        assert db.execute("SELECT count(*) FROM occurrences").fetchone()[0] == len(data["rows"])
        assert db.execute("SELECT count(*) FROM page_search WHERE page_search MATCH 'profondità'").fetchone()[0] > 0
    unresolved = [{"page": p["page"], "reference": p["reference"], "section": p["sections"][-1],
                   "reason": p["tableStatus"]}
                  for p in data["pages"] if p["kitchen"] and not p["rowCount"] and "punti" in p["text"].lower()]
    result = {"sourceHashMatches": True, "pageInventoryComplete": True,
              "databaseIntegrity": "ok", "visualNumericSampleRows": len(VISUAL_REFERENCE),
              "visualNumericSampleCells": sum(map(len, VISUAL_REFERENCE.values())),
              "numericCellsCompared": sum(len(r["cells"]) for r in data["rows"]),
              "numericCellsAgree": sum(c["crossChecked"] for r in data["rows"] for c in r["cells"]),
              "graphicCellsVisuallyVerified": sum(c.get("visuallyVerified", False) for r in data["rows"] for c in r["cells"]),
              "percentageRulesCrossChecked": sum(rule["crossChecked"] for r in data["rows"] for rule in r.get("pricingRules", [])),
              "unstructuredPricePages": unresolved,
              "unstructuredPricePageCount": len(unresolved),
              "issues": dict(Counter(i for r in data["rows"] for i in r["issues"])),
              "completeCommercialVerification": False,
              "notice": "Campione visivo verificato; inventario completo; verifica commerciale integrale ancora da completare."}
    (folder / "verifica.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    names = ["catalogo.html", "catalogo.json", "catalogo.sqlite", "rapporto.json", "LEGGIMI.txt", "verifica.json"]
    checksums = []
    for name in names:
        with (folder / name).open("rb") as stream:
            checksums.append(hashlib.file_digest(stream, "sha256").hexdigest() + "  " + name)
    (folder / "SHA256SUMS.txt").write_text("\n".join(checksums) + "\n")
    target = folder / "Albertelli-Kitchen-Catalogo-2026.zip"
    temporary = target.with_suffix(".partial")
    with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in [*names, "SHA256SUMS.txt"]:
            archive.write(folder / name, name)
    temporary.replace(target)
    print(json.dumps({k: v for k, v in result.items() if k != "unstructuredPricePages"}, ensure_ascii=False, indent=2))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("folder", type=Path)
    args = parser.parse_args()
    audit(args.pdf, args.folder)
