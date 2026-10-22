import json
from pathlib import Path
import sqlite3

import pytest

from scripts.kitchen_catalog import (
    display, extract_handles, extract_table, kitchen_page, points, poppler_pages, sections,
    split_merged_words, write_sqlite,
)


@pytest.mark.parametrize("raw,expected", [
    ("1.006\x03", "1006"), ("27,6", "27.6"), ("10,1", "10.1"),
    ("0", "0"), ("—", None), ("–", None), ("1.000.000,25", "1000000.25"),
])
def test_points_preserve_decimal_units_and_unavailability(raw, expected):
    assert points(raw) == expected


@pytest.mark.parametrize("raw", ["", "1.1341", "23.8", "27,6¹", "23,8 1", "1) 127", "-12", "NaN"])
def test_ambiguous_price_is_not_silently_repaired(raw):
    with pytest.raises(ValueError):
        points(raw)


def test_later_domains_remain_outside_kitchen_scope():
    assert kitchen_page(840)
    assert not kitchen_page(841)
    assert not kitchen_page(1024)
    assert kitchen_page(1025)
    assert not kitchen_page(187)


def test_section_boundaries_and_invalid_bookmark():
    toc = [(1, "Manuale", 1), (1, "Basi", 10), (2, "XL", 12),
           (2, "Rimando non risolto", -1), (1, "Colonne", 20)]
    assert sections(toc, 11) == ["Basi"]
    assert sections(toc, 12) == ["Basi", "XL"]
    assert sections(toc, 20) == ["Colonne"]


def test_studio_identity_does_not_change_article_codes():
    assert display("NOBILIA · codice 00123") == "Albertelli Kitchen · codice 00123"


def test_private_evidence_and_searchable_display_are_distinct(tmp_path):
    data = {"manifest": {"commerciallyApproved": 0}, "pages": [
        {"page": 200, "kitchen": True, "reference": "M 3.6", "sections": ["Basi"],
         "sourceText": "Fonte originale privata", "text": "Albertelli Kitchen base",
         "tableStatus": "extracted"}], "rows": [
        {"id": "p0200-r001", "page": 200, "code": "00123", "numericStatus": "cross_checked",
         "commercialStatus": "needs_review", "usableForPricing": False}]}
    path = tmp_path / "catalog.sqlite"
    write_sqlite(path, data)
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT code FROM occurrences").fetchone() == ("00123",)
        assert db.execute("SELECT source_text FROM pages").fetchone() == ("Fonte originale privata",)
        assert db.execute("SELECT rowid,display_text FROM page_search WHERE page_search MATCH 'base'").fetchone() == (200, "Albertelli Kitchen base")
        payload = json.loads(db.execute("SELECT payload FROM occurrences").fetchone()[0])
        assert payload["usableForPricing"] is False
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)


def test_html_renders_data_as_text_and_uses_no_external_dependencies():
    html = Path("scripts/kitchen_catalog.html").read_text()
    assert "connect-src 'none'" in html
    assert "innerHTML" not in html
    assert "textContent" in html
    assert "__CATALOG_DATA__" in html


def test_two_pdf_engines_handle_cropbox_leading_zero_and_superscript(tmp_path):
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=640, height=850)
    page.insert_text((315, 105), "Cod. articolo", fontsize=8, rotate=90)
    page.insert_text((333, 40), "Punti", fontsize=8)
    page.insert_text((380, 45), "Gruppo prezzi", fontsize=22)
    for i in range(10):
        page.insert_text((335 + i * 22, 90), str(i + 1), fontsize=21.5)
        page.insert_text((335 + i * 22, 150), str(100 + i), fontsize=8)
    page.insert_text((307, 150), "00123", fontsize=8)
    page.insert_text((373, 147), "1", fontsize=5)  # superscript for group 2
    page.set_cropbox(fitz.Rect(13, 21, 613, 821))
    source = tmp_path / "source.pdf"
    doc.save(source)
    doc.close()
    doc = fitz.open(source)
    second = poppler_pages(source, tmp_path / "source.xml")
    rows, status = extract_table(doc[0], 1, second[0])
    assert status == "extracted"
    assert len(rows) == 1
    row = rows[0]
    assert row["code"] == "00123"
    assert row["numericStatus"] == "cross_checked"
    assert row["hasFootnoteMarker"] is True
    assert [c["points"] for c in row["cells"]] == [str(n) for n in range(100, 110)]
    assert row["commercialStatus"] == "needs_review"
    assert not row["usableForPricing"]
    # Disagreement must survive as an explicit issue, retaining the raw evidence.
    tampered = [(*w[:4], "999" if w[4] == "100" else w[4]) for w in second[0]]
    changed, _ = extract_table(doc[0], 1, tampered)
    assert changed[0]["numericStatus"] == "needs_review"
    assert changed[0]["cells"][0]["raw"] == "100"
    assert changed[0]["cells"][0]["points"] == "100"
    assert changed[0]["cells"][0]["secondEngineRaw"] == "999"
    assert not changed[0]["cells"][0]["crossChecked"]


def test_poppler_tab_tokens_require_both_count_and_printed_endpoints():
    word = (12, 100, 57, 111, "92\t\t101\t\t104")
    split = split_merged_words([word], [10, 30, 50, 70])
    assert [w[4] for w in split] == ["92", "101", "104"]
    assert split_merged_words([word], [10, 70]) == [word]
    assert split_merged_words([(*word[:4], "92 not-a-price 104")], [10, 30, 50, 70])[0][4] == "92 not-a-price 104"


def test_surface_prices_follow_printed_grid_and_rotated_labels(tmp_path):
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=600, height=800)
    page.insert_text((315, 105), "Cod. articolo", fontsize=8, rotate=90)
    page.insert_text((380, 30), "Punti", fontsize=8)
    page.insert_text((360, 105), "Opaco", fontsize=8, rotate=90)
    page.insert_text((400, 105), "Extralucido", fontsize=8, rotate=90)
    for x in [340, 380, 420]:
        page.draw_line((x, 15), (x, 500))
    page.insert_text((307, 150), "00123", fontsize=8)
    page.insert_text((350, 150), "27,6", fontsize=8)
    page.insert_text((390, 150), "48,2", fontsize=8)
    source = tmp_path / "materials.pdf"
    doc.save(source)
    second = poppler_pages(source, tmp_path / "materials.xml")
    rows, _ = extract_table(doc[0], 1, second[0])
    assert rows[0]["groupKind"] == "surface"
    assert [(c["group"], c["points"]) for c in rows[0]["cells"]] == [("Opaco", "27.6"), ("Extralucido", "48.2")]
    assert rows[0]["numericStatus"] == "cross_checked"


def test_nested_color_variants_inherit_their_code_without_merging_prices(tmp_path):
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=640, height=850)
    page.insert_text((315, 105), "Cod. articolo", fontsize=8, rotate=90)
    page.insert_text((333, 40), "Punti", fontsize=8)
    page.insert_text((380, 45), "Gruppo prezzi", fontsize=22)
    page.insert_text((307, 150), "00123", fontsize=8)
    page.insert_text((300, 170), "DG1", fontsize=8)
    page.insert_text((300, 190), "DG2", fontsize=8)
    for i in range(10):
        page.insert_text((335 + i * 22, 90), str(i + 1), fontsize=21.5)
        page.insert_text((335 + i * 22, 170), str(100 + i), fontsize=8)
        page.insert_text((335 + i * 22, 190), str(200 + i), fontsize=8)
    source = tmp_path / "variants.pdf"
    doc.save(source)
    second = poppler_pages(source, tmp_path / "variants.xml")
    rows, _ = extract_table(doc[0], 1, second[0])
    assert [(r["code"], r["variant"]) for r in rows] == [("00123", "DG1"), ("00123", "DG2")]
    assert all(r["numericStatus"] == "cross_checked" for r in rows)
    assert rows[0]["cells"][0]["points"] == "100"
    assert rows[1]["cells"][0]["points"] == "200"


def test_display_never_fabricates_studio_email_or_website():
    text = display("www.nobilia.de e nome@nobilia.de; Nobilia")
    assert "nobilia" not in text.lower()
    assert "www.Albertelli" not in text and "@Albertelli" not in text


def test_handle_number_surcharge_code_and_split_price_label_are_distinct(tmp_path):
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=600, height=800)
    page.insert_text((200, 100), "N. 300", fontsize=9)
    page.insert_text((200, 120), "Maniglia a listello", fontsize=8)
    page.insert_text((200, 140), "Cod. supplemento: 7946", fontsize=8)
    page.insert_text((200, 160), "Punti", fontsize=8)
    page.insert_text((200, 172), ": 102,6", fontsize=8)
    source = tmp_path / "handle.pdf"
    doc.save(source)
    second = poppler_pages(source, tmp_path / "handle.xml")
    rows, _ = extract_handles(doc[0], 166, second[0])
    assert len(rows) == 1
    assert rows[0]["code"] == "300"
    assert rows[0]["supplementCode"] == "7946"
    assert rows[0]["cells"][0]["points"] == "102.6"
    assert rows[0]["numericStatus"] == "cross_checked"
