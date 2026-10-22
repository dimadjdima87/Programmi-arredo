"""Source-backed, offline kitchen reference catalog; never writes to the app DB.

Requires PyMuPDF and Poppler's pdftotext in the extraction environment only.
The two independent text engines must agree on each numeric price cell. That
agreement is a technical check, not approval of commercial/configuration rules.
"""

import argparse
from collections import Counter
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile


VERSION = 1
SOURCE_SHA256 = "ce4a42c404d6c41565d523d1c2ad08f116dbcc4318f6c85dbfcdb34dcecdd2c4"
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
NUMBER = re.compile(r"(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?\Z")


def clean(value):
    return CONTROL.sub("", value).replace("\xad", "").strip()


def display(value):
    # Preserve the original in private evidence; use the studio's identity in UI.
    value = re.sub(r"(?:https?://|www\.)[^\s<>]*nobilia[^\s<>]*|[\w.+-]+@[^\s<>]*nobilia[^\s<>]*",
                   "[riferimento nella fonte originale]", clean(value), flags=re.I)
    return re.sub(r"nobilia(?:-Werke)?", "Albertelli Kitchen", value, flags=re.I)


def points(value):
    """None means unavailable, never zero. Reject malformed/ambiguous numbers."""
    value = clean(value)
    if value in {"—", "–"}:
        return None
    if not NUMBER.fullmatch(value):
        raise ValueError(f"Punti ambigui: {value!r}")
    try:
        return str(Decimal(value.replace(".", "").replace(",", ".")))
    except InvalidOperation as exc:
        raise ValueError("Punti non validi") from exc


def poppler_pages(pdf, destination):
    subprocess.run(["pdftotext", "-bbox-layout", str(pdf), str(destination)], check=True)
    # PDF control glyph U+0003 is emitted literally by Poppler, invalid in XML.
    root = ET.fromstring(CONTROL.sub("", destination.read_text()))
    ns = "{http://www.w3.org/1999/xhtml}"
    return [[(float(w.get("xMin")), float(w.get("yMin")),
              float(w.get("xMax")), float(w.get("yMax")), clean(w.text or ""))
             for w in p.iter(ns + "word")] for p in root.iter(ns + "page")]


def sections(toc, page):
    path = []
    for level, title, start in toc:
        if start < 1 or start > page:
            continue
        path = path[:level - 1] + [display(title)]
    return path


def kitchen_page(page):
    # Explicitly defer the standalone bathroom/living/wardrobe range and the
    # bathroom-specific surcharge page. Preserve all pages in source inventory.
    return page != 187 and not 841 <= page <= 1024


def cell_text(chars, left, right, baseline):
    selected = [c for c in chars if left <= c["x"] < right
                and abs(c["y"] - baseline) < 1.6 and 7.5 <= c["size"] <= 9.1]
    return clean("".join(c["c"] for c in sorted(selected, key=lambda c: c["x"])))


def second_cell(words, left, right, top):
    selected = [w for w in words if left <= w[0] < right and abs(w[1] - top) < 4
                and w[3] - w[1] >= 7]
    return clean("".join(w[4] for w in sorted(selected)))


def material_columns(page, spans, code_x, header_bottom):
    """Use printed vertical rules to group multi-line rotated surface labels."""
    labels = [s for s in spans if abs(s["dir"][0]) < 0.01 and s["bbox"][0] > code_x + 12
              and abs(s["bbox"][3] - header_bottom) < 2 and s["text"]]
    if len(labels) < 2:
        return None
    lines = []
    for drawing in page.get_drawings():
        for item in drawing["items"]:
            if item[0] == "l":
                a, b = item[1:]
                if abs(a.x - b.x) < 0.1 and abs(a.y - b.y) > 50 and min(a.y, b.y) < 60:
                    lines.append(a.x)
            elif item[0] == "re":
                rect = item[1]
                if rect.y0 < 60 and rect.height > 50:
                    lines.extend([rect.x0, rect.x1])
    unique = []
    for x in sorted(lines):
        if not unique or x - unique[-1] > 0.8:
            unique.append(x)
    first = min(s["bbox"][0] for s in labels)
    last = max(s["bbox"][2] for s in labels)
    before, after = [x for x in unique if x < first], [x for x in unique if x > last]
    if not before or not after:
        return None
    bounds = [x for x in unique if max(before) <= x <= min(after)]
    centers = []
    for left, right in zip(bounds, bounds[1:]):
        parts = sorted([s for s in labels if left <= (s["bbox"][0] + s["bbox"][2]) / 2 < right],
                       key=lambda s: s["bbox"][0])
        if not parts:
            return None
        centers.append((" ".join(s["text"] for s in parts), (left + right) / 2))
    return centers, bounds


def split_merged_words(words, bounds):
    """Poppler can retain tab glyphs inside a word spanning several cells.

    Split only if both printed endpoints and token count agree with the grid.
    Otherwise retain the word and let the disagreement block verification.
    """
    expanded = []
    for w in words:
        tokens = w[4].split()
        first = next((i for i in range(len(bounds) - 1) if bounds[i] <= w[0] < bounds[i + 1]), None)
        last = next((i for i in range(len(bounds) - 1) if bounds[i] <= w[2] - 0.1 < bounds[i + 1]), None)
        # A trailing tab has a bounding box but no number. Permit that blank
        # tail only in the left half of the immediately following cell.
        if (first is not None and last is not None and w[4] != w[4].rstrip()
                and last - first == len(tokens)
                and w[2] < (bounds[last] + bounds[last + 1]) / 2):
            last -= 1
        valid = all(NUMBER.fullmatch(t) or t in {"—", "–"} for t in tokens)
        if len(tokens) > 1 and valid and first is not None and last is not None and last - first + 1 == len(tokens):
            for i, token in enumerate(tokens, first):
                x = (bounds[i] + bounds[i + 1]) / 2
                expanded.append((x - 1, w[1], x + 1, w[3], token))
        else:
            expanded.append(w)
    return expanded


def extract_handles(page, number, second_words):
    """Handle number and surcharge code are different identifiers; retain both."""
    import fitz

    spans = [s for b in page.get_text("dict", flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES)["blocks"]
             if b["type"] == 0 for line in b["lines"] for s in line["spans"]]
    anchors = [s for s in spans if re.fullmatch(r"N\.\s*\d{3}", clean(s["text"]))]
    columns = sorted({round(s["bbox"][0] / 5) * 5 for s in anchors})
    # Minor alignment variations belong to the same printed card column.
    columns = [x for i, x in enumerate(columns) if i == 0 or x - columns[i - 1] > 15]
    if not columns:
        return [], "no_handle_cards"
    aligned = [(w[0] - page.cropbox.x0, w[1] - page.cropbox.y0,
                w[2] - page.cropbox.x0, w[3] - page.cropbox.y0, w[4]) for w in second_words]
    rows = []
    for anchor in sorted(anchors, key=lambda s: (s["bbox"][0], s["bbox"][1])):
        column = min(range(len(columns)), key=lambda i: abs(columns[i] - anchor["bbox"][0]))
        left = 0 if column == 0 else (columns[column - 1] + columns[column]) / 2
        right = page.rect.width if column == len(columns) - 1 else (columns[column] + columns[column + 1]) / 2
        top = anchor["bbox"][1] - 0.5
        following = [s["bbox"][1] for s in anchors if left <= s["bbox"][0] < right and s["bbox"][1] > top + 2]
        bottom = min(following) if following else min(top + 100, page.rect.height - 35)
        card = sorted([s for s in spans if left <= s["bbox"][0] < right and top <= s["bbox"][1] < bottom],
                      key=lambda s: (round(s["bbox"][1], 1), s["bbox"][0]))
        text = "\n".join(clean(s["text"]) for s in card)
        other = " ".join(w[4] for w in aligned if left <= w[0] < right and top - 4 <= w[1] < bottom - 4)
        code = re.search(r"\d{3}", anchor["text"])[0]
        surcharge = re.search(r"Cod\.\s*supplemento\s*:\s*(\d+)", text)
        price = re.search(r"Punti\s*:\s*([\d.,]+)", text) if number >= 162 else None
        other_price = re.search(r"Punti\s*:\s*([\d.,]+)", other) if number >= 162 else None
        other_surcharge = re.search(r"Cod\.\s*supplemento\s*:\s*(\d+)", other)
        issues, cells = [], []
        code_agrees = bool(re.search(r"N\.\s*" + code + r"\b", other))
        if not code_agrees:
            issues.append("handle_code_engine_disagreement")
        if price:
            raw, other_raw = price[1], other_price[1] if other_price else ""
            try:
                value = points(raw)
                match = bool(other_raw) and value == points(other_raw)
            except ValueError:
                value, match = None, False
            if not match:
                issues.append("handle_price_engine_disagreement")
            if not surcharge or not other_surcharge or surcharge[1] != other_surcharge[1]:
                issues.append("surcharge_code_engine_disagreement")
            cells = [{"group": "Supplemento", "raw": raw, "points": value, "available": True,
                      "crossChecked": match, "secondEngineRaw": other_raw}]
        status = ("cross_checked" if not issues else "needs_review") if price else "not_listed"
        if not price and number >= 162:
            issues.append("handle_price_not_recognized")
            status = "needs_review"
        rows.append({"id": f"p{number:04d}-h{len(rows) + 1:03d}", "page": number,
                     "code": code, "codeKind": "handle_number", "variant": "",
                     "supplementCode": surcharge[1] if surcharge else None,
                     "rowLabel": "Maniglia / pomello " + code, "groupKind": "surcharge",
                     "cells": cells, "bbox": list(anchor["bbox"]), "context": display(text),
                     "hasFootnoteMarker": False, "numericStatus": status, "issues": issues,
                     "commercialStatus": "needs_review", "usableForPricing": False})
    return rows, "extracted_handle_cards"


def extract_table(page, number, second_words):
    """Extract conservative table occurrences, with no inferred product geometry."""
    import fitz

    spans, chars = [], []
    textpage = page.get_textpage(flags=fitz.TEXTFLAGS_RAWDICT & ~fitz.TEXT_PRESERVE_IMAGES)
    for block in page.get_text("rawdict", textpage=textpage)["blocks"]:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                text = clean("".join(c["c"] for c in span["chars"]))
                spans.append({**span, "text": text, "dir": line["dir"]})
                if line["dir"] == (1.0, 0.0):
                    chars.extend({"c": c["c"], "x": c["origin"][0],
                                  "y": c["origin"][1], "size": span["size"]}
                                 for c in span["chars"])
    headers = [s for s in spans if s["text"].rstrip(".") in {"Cod. articolo", "Codice articolo"}
               and s["bbox"][1] < 130]
    if len(headers) != 1:
        return [], "no_single_code_header"
    header = headers[0]
    code_x = (header["bbox"][0] + header["bbox"][2]) / 2
    bottom = header["bbox"][3]
    words = page.get_text("words", textpage=textpage)
    price_headers = [s for s in spans if s["text"] == "Punti" and s["bbox"][1] < 130]
    if not price_headers:
        return [], "no_price_header"
    labels = [s for s in spans if re.fullmatch(r"Gruppo colori \d+", s["text"])
              and s["bbox"][1] < 110]
    centers = []
    printed_bounds = None
    group_kind = "single"
    if any(s["text"] == "Gruppo prezzi" for s in spans):
        labels_num = sorted([w for w in words if re.fullmatch(r"(?:[1-9]|10)", w[4])
                             and w[0] > code_x and 35 < w[1] < 90
                             and w[3] - w[1] > 20], key=lambda w: w[0])
        if [w[4] for w in labels_num] != [str(n) for n in range(1, 11)]:
            return [], "ambiguous_price_groups"
        centers = [(w[4], (w[0] + w[2]) / 2) for w in labels_num]
        group_kind = "price_group"
    elif labels:
        labels.sort(key=lambda s: s["bbox"][0])
        centers = [(s["text"].split()[-1], (s["bbox"][0] + s["bbox"][2]) / 2)
                   for s in labels]
        group_kind = "color_group"
    else:
        if len(price_headers) != 1 or price_headers[0]["bbox"][0] < code_x:
            return [], "ambiguous_single_price"
        s = price_headers[0]
        materials = material_columns(page, spans, code_x, bottom) if s["dir"] == (1.0, 0.0) else None
        if materials:
            centers, printed_bounds = materials
            group_kind = "surface"
        else:
            centers = [("single", (s["bbox"][0] + s["bbox"][2]) / 2)]
    if centers[0][1] <= code_x:
        return [], "reversed_columns"
    bounds = [(code_x + centers[0][1]) / 2]
    bounds.extend((centers[i][1] + centers[i + 1][1]) / 2
                  for i in range(len(centers) - 1))
    bounds.append(min(page.rect.width, centers[-1][1] + (
        (centers[-1][1] - centers[-2][1]) / 2 if len(centers) > 1 else 22)))
    if printed_bounds:
        bounds = printed_bounds
    elif group_kind == "single":
        dimensions = [(s["bbox"][0] + s["bbox"][2]) / 2 for s in spans
                      if abs(s["dir"][0]) < 0.01 and abs(s["bbox"][3] - bottom) < 2
                      and code_x + 10 < (s["bbox"][0] + s["bbox"][2]) / 2 < centers[0][1] - 10]
        if dimensions:
            bounds[0] = (max(dimensions) + centers[0][1]) / 2
    anchors = [s for s in spans if re.fullmatch(r"\d{1,6}", s["text"])
               and s["dir"] == (1.0, 0.0) and 7.5 <= s["size"] <= 9.1
               and abs((s["bbox"][0] + s["bbox"][2]) / 2 - code_x) < 10
               and bottom < s["bbox"][1] < page.rect.height - 35]
    anchors.sort(key=lambda s: s["origin"][1])
    expanded_anchors = []
    for index, anchor in enumerate(anchors):
        baseline = anchor["origin"][1]
        direct_price = cell_text(chars, bounds[0], bounds[-1], baseline)
        next_top = anchors[index + 1]["bbox"][1] if index + 1 < len(anchors) else page.rect.height - 35
        variants = [s for s in spans if re.fullmatch(r"DG\s*\d+", s["text"])
                    and anchor["bbox"][1] < s["bbox"][1] < next_top
                    and code_x - 60 < s["bbox"][0] < bounds[0]]
        if not direct_price and variants:
            for variant in variants:
                expanded_anchors.append({**anchor, "origin": variant["origin"], "bbox": variant["bbox"],
                                         "codeOrigin": anchor, "variant": variant["text"]})
        else:
            expanded_anchors.append(anchor)
    anchors = sorted(expanded_anchors, key=lambda s: s["origin"][1])
    offset_x, offset_y = page.cropbox.x0, page.cropbox.y0
    aligned = [(w[0] - offset_x, w[1] - offset_y,
                w[2] - offset_x, w[3] - offset_y, w[4]) for w in second_words]
    aligned = split_merged_words(aligned, bounds)
    rows = []
    for index, anchor in enumerate(anchors):
        y = anchor["origin"][1]
        baseline_chars = [c for c in chars if abs(c["y"] - y) < 1.6
                          and 7.5 <= c["size"] <= 9.1]
        baseline_words = [w for w in aligned if abs(w[1] - anchor["bbox"][1]) < 4
                          and w[3] - w[1] >= 7]
        ordered_tokens = [token for w in sorted(baseline_words)
                          if bounds[0] <= w[0] < bounds[-1] for token in w[4].split()]
        ordered_row = len(ordered_tokens) == len(centers) and all(
            NUMBER.fullmatch(t) or t in {"—", "–"} for t in ordered_tokens)
        cells, issues = [], []
        for i, (label, _) in enumerate(centers):
            raw = cell_text(baseline_chars, bounds[i], bounds[i + 1], y)
            other = second_cell(baseline_words, bounds[i], bounds[i + 1], anchor["bbox"][1])
            method = "cell_coordinates"
            if ordered_row:
                other = ordered_tokens[i]
                method = "ordered_row_with_exact_column_count"
            try:
                value = points(raw)
            except ValueError:
                value = None
                issues.append(f"ambiguous_cell_{label}")
            try:
                match = bool(raw) and points(other) == value and f"ambiguous_cell_{label}" not in issues
            except ValueError:
                match = False
            if not match:
                issues.append(f"engine_disagreement_{label}")
            cells.append({"group": label, "raw": raw, "points": value,
                          "available": None if not raw else raw not in {"—", "–"},
                          "crossChecked": match, "secondEngineRaw": other,
                          "crossCheckMethod": method})
        original_anchor = anchor.get("codeOrigin", anchor)
        cross_code = second_cell(aligned, code_x - 14, code_x + 14, original_anchor["bbox"][1])
        if cross_code != anchor["text"]:
            issues.append("code_engine_disagreement")
        # Full table header, row context and complete page retained separately.
        # Row context may include inherited descriptions from preceding rows;
        # it is evidence, not an asserted normalized product description.
        next_y = anchors[index + 1]["bbox"][1] if index + 1 < len(anchors) else page.rect.height - 35
        context_top = max(bottom, anchor["bbox"][1] - 4)
        context_spans = sorted([s for s in spans if s["dir"] == (1.0, 0.0)
                                and context_top <= s["bbox"][1] < next_y],
                               key=lambda s: (round(s["bbox"][1], 1), s["bbox"][0]))
        context = "\n".join(s["text"] for s in context_spans if s["text"])
        row_words = sorted([w for w in words if w[0] < code_x - 12
                            and abs(w[1] - anchor["bbox"][1]) < 3], key=lambda w: w[0])
        row_label = " ".join(w[4] for w in row_words)
        if anchor.get("variant"):
            row_label = anchor["variant"] + " · " + row_label
        note = any(c["size"] < 7 and abs(c["y"] - y) < 5 and c["x"] > bounds[0]
                   and clean(c["c"]) for c in chars)
        rows.append({"id": f"p{number:04d}-r{index + 1:03d}", "page": number,
                     "code": anchor["text"], "rowLabel": display(row_label),
                     "variant": anchor.get("variant", ""),
                     "groupKind": group_kind, "cells": cells,
                     "bbox": [round(v, 3) for v in anchor["bbox"]],
                     "context": display(context), "hasFootnoteMarker": note,
                     "numericStatus": "cross_checked" if not issues else "needs_review",
                     "issues": sorted(set(issues)),
                     "commercialStatus": "needs_review", "usableForPricing": False})
        row = rows[-1]
        # These four zero glyphs are graphic content, absent from both text
        # layers. Visually read from rendered pages of SOURCE_SHA256. Never
        # promote them to an agreement between text engines.
        if (number, row["code"]) in {(188, "7904"), (188, "7913"), (189, "7994"), (189, "7906")}:
            if any(c["raw"] or c["secondEngineRaw"] for c in cells):
                raise ValueError("Il contenuto della cella grafica è cambiato: riesaminare la fonte")
            row["cells"] = [{"group": "single", "raw": "0", "points": "0", "available": True,
                             "crossChecked": False, "secondEngineRaw": "",
                             "visuallyVerified": True, "crossCheckMethod": "rendered_source_visual_review"}]
            row["numericStatus"] = "visual_checked"
            row["issues"] = []
            row["visualReview"] = {"sourceSha256": SOURCE_SHA256, "page": number,
                                   "scope": "Cella punti 0; condizioni nel testo originale"}
        elif row["code"] == "9312" and not any(c["raw"] for c in cells):
            other_context = " ".join(w[4] for w in aligned if context_top - 4 <= w[1] < next_y)
            percent = re.findall(r"\b(\d+(?:,\d+)?)\s*%", context)
            other_percent = re.findall(r"\b(\d+(?:,\d+)?)\s*%", other_context)
            if percent and set(percent) == {"30"} and set(other_percent) == {"30"}:
                row["cells"] = []
                row["pricingRules"] = [{"type": "percentage_surcharge", "percent": "30",
                                        "basisReference": {"page": 189, "code": "9312"},
                                        "crossChecked": True, "automaticApplication": False}]
                row["numericStatus"] = "rule_checked"
                row["issues"] = []
    return rows, "extracted" if rows else "no_rows_extracted"


def build(pdf, output):
    import fitz

    output.mkdir(parents=True, exist_ok=True)
    if any((output / name).exists() for name in ["catalogo.sqlite", "catalogo.json", "catalogo.html"]):
        raise ValueError("La destinazione contiene già un catalogo: scegli una nuova cartella")
    digest = hashlib.file_digest(pdf.open("rb"), "sha256").hexdigest()
    if digest != SOURCE_SHA256:
        raise ValueError("Fonte diversa dal manuale 2026 verificato: aggiornare mappatura e controlli prima di importare")
    doc = fitz.open(pdf)
    if len(doc) != 1086:
        raise ValueError("Inventario delle pagine diverso dal manuale verificato")
    toc = doc.get_toc()
    with tempfile.TemporaryDirectory() as temporary:
        second = poppler_pages(pdf, Path(temporary) / "bbox.html")
    if len(second) != len(doc):
        raise ValueError("Numero di pagine diverso nei due lettori PDF")
    pages, rows = [], []
    for n, page in enumerate(doc, 1):
        text = clean(page.get_text(sort=True))
        paths = sections(toc, n)
        selected = kitchen_page(n)
        if not selected:
            table, status = [], "deferred_scope"
        elif 160 <= n <= 167:
            table, status = extract_handles(page, n, second[n - 1])
        else:
            table, status = extract_table(page, n, second[n - 1])
        refs = re.findall(r"\bM\s+\d+\.\d+\b", text)
        item = {"page": n, "reference": refs[-1] if refs else "",
                "sections": paths, "kitchen": selected, "text": display(text),
                "sourceText": text, "tableStatus": status,
                "rowCount": len(table), "lowText": len(text) < 100}
        for row in table:
            row["section"] = paths[-1] if paths else "Informazioni generali"
            row["reference"] = item["reference"]
        pages.append(item)
        rows.extend(table)
        if n % 100 == 0:
            print(f"Pagine {n}/{len(doc)}; occorrenze {len(rows)}", flush=True)
    report = {"version": VERSION, "displayName": "Albertelli Kitchen",
              "edition": "2026", "sourceSha256": digest, "pages": len(pages),
              "kitchenPages": sum(p["kitchen"] for p in pages),
              "deferredPages": sum(not p["kitchen"] for p in pages),
              "articleOccurrences": len(rows), "distinctCodes": len({r["code"] for r in rows}),
              "numericCrossChecked": sum(r["numericStatus"] == "cross_checked" for r in rows),
              "numericNeedsReview": sum(r["numericStatus"] == "needs_review" for r in rows),
              "withoutExplicitPoints": sum(r["numericStatus"] == "not_listed" for r in rows),
              "visuallyCheckedGraphicRows": sum(r["numericStatus"] == "visual_checked" for r in rows),
              "percentageRuleRowsChecked": sum(r["numericStatus"] == "rule_checked" for r in rows),
              "commerciallyApproved": 0, "usableForPricing": 0,
              "pageStatus": dict(Counter(p["tableStatus"] for p in pages)),
              "notice": "Confronto numerico automatico con due lettori PDF; non è approvazione commerciale. Nessun costo calcolato."}
    data = {"manifest": report, "pages": pages, "rows": rows}
    (output / "catalogo.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    (output / "rapporto.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    write_sqlite(output / "catalogo.sqlite", data)
    template = Path(__file__).with_name("kitchen_catalog.html").read_text()
    # Source text with the supplier's original identity remains only in the
    # private JSON/SQLite evidence. Visible HTML uses the studio identity.
    public = {**data, "pages": [{k: v for k, v in p.items() if k != "sourceText"} for p in pages]}
    payload = json.dumps(public, ensure_ascii=False).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    (output / "catalogo.html").write_text(template.replace("__CATALOG_DATA__", payload), encoding="utf-8")
    (output / "LEGGIMI.txt").write_text(
        "ALBERTELLI KITCHEN — CATALOGO 2026\n\n"
        "Apri catalogo.html nel browser: funziona senza installazione e senza Internet.\n"
        "Cerca codice, sigla o testo. Ogni occorrenza rimanda alla pagina di riferimento.\n"
        "Il controllo numerico confronta due lettori PDF indipendenti. Note, compatibilità,\n"
        "geometrie e completezza delle righe richiedono ancora verifica. Nessuna approvazione\n"
        "commerciale e nessun calcolo costi. Le righe non sono importate nel programma Windows.\n"
        "Il testo completo delle pagine cucina resta ricercabile anche quando una tabella\n"
        "non è stata riconosciuta. Living, bagno e guardaroba sono esclusi dalla consultazione.\n"
        "Non modificare o eliminare il PDF originale: è la fonte primaria.\n"
        "catalogo.json e catalogo.sqlite contengono le evidenze originali private.\n",
        encoding="utf-8")
    with zipfile.ZipFile(output / "Albertelli-Kitchen-Catalogo-2026.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for name in ["catalogo.html", "catalogo.json", "catalogo.sqlite", "rapporto.json", "LEGGIMI.txt"]:
            archive.write(output / name, name)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return data


def write_sqlite(path, data):
    with sqlite3.connect(path) as db:
        db.executescript("""
          CREATE TABLE manifest (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE pages (page INTEGER PRIMARY KEY, kitchen INTEGER NOT NULL,
            reference TEXT NOT NULL, sections TEXT NOT NULL, source_text TEXT NOT NULL,
            display_text TEXT NOT NULL, table_status TEXT NOT NULL);
          CREATE TABLE occurrences (id TEXT PRIMARY KEY, page INTEGER NOT NULL REFERENCES pages(page),
            code TEXT NOT NULL, numeric_status TEXT NOT NULL, commercial_status TEXT NOT NULL,
            payload TEXT NOT NULL);
          CREATE INDEX occurrences_code ON occurrences(code);
          CREATE VIRTUAL TABLE page_search USING fts5(display_text, content='pages', content_rowid='page');
        """)
        db.execute("PRAGMA foreign_keys=ON")
        db.executemany("INSERT INTO manifest VALUES (?,?)", [(k, json.dumps(v, ensure_ascii=False))
                                                             for k, v in data["manifest"].items()])
        for p in data["pages"]:
            db.execute("INSERT INTO pages VALUES (?,?,?,?,?,?,?)", (
                p["page"], p["kitchen"], p["reference"], json.dumps(p["sections"], ensure_ascii=False),
                p["sourceText"], p["text"], p["tableStatus"]))
            db.execute("INSERT INTO page_search(rowid,display_text) VALUES (?,?)", (p["page"], p["text"]))
        for r in data["rows"]:
            db.execute("INSERT INTO occurrences VALUES (?,?,?,?,?,?)", (
                r["id"], r["page"], r["code"], r["numericStatus"], r["commercialStatus"],
                json.dumps(r, ensure_ascii=False)))
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Catalogo SQLite non integro")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Catalogo cucina con evidenze e doppio controllo PDF")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build(args.pdf, args.output)
