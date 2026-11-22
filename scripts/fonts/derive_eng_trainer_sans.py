"""Prepares "Eng Trainer Sans": a renamed derivative of four Source Sans 3 web subsets.

Source Sans 3 is licensed under the SIL Open Font License 1.1 with the Reserved
Font Name "Source". A subset is a Modified Version under the OFL, so it may not be
distributed under the reserved name without permission. This script renames the
four Google Fonts WOFF2 subsets used by eng-trainer and changes nothing else:
glyphs, character mapping, shaping, metrics, variation data and all notices stay
as they are. The copyright notice that names the reserved font name is kept.

This is an offline preparation tool. The application build does not run it and
needs no font tooling.

Usage (Python 3.14, in an isolated environment with requirements.txt installed):
  python derive_eng_trainer_sans.py --input-dir DIR --output-dir DIR
      Derives the four files from verified originals in DIR (named as in ORIGINALS).
  python derive_eng_trainer_sans.py --download --input-dir DIR --output-dir DIR
      Downloads the originals into DIR first (exact URLs and hashes below).
  python derive_eng_trainer_sans.py --check --input-dir DIR --output-dir DIR [--report FILE]
      Compares originals and derivatives table by table and writes a JSON report.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import urllib.request
from pathlib import Path

import fontTools
from fontTools.ttLib import TTFont

FAMILY_OLD = "Source Sans 3"
FAMILY_NEW = "Eng Trainer Sans"
POSTSCRIPT_OLD = "SourceSans3"
POSTSCRIPT_NEW = "EngTrainerSans"

# Google Fonts, Source Sans 3 version 20 (font version 3.052), the exact files eng-trainer served before.
ORIGINALS = {
    "latin": {
        "file": "source-sans-3-latin.woff2",
        "url": "https://fonts.gstatic.com/s/sourcesans3/v20/nwpStKy2OAdR1K-IwhWudF-R3w8aZQ.woff2",
        "sha256": "19143dca075972bc84e3fd9eab7416dd40cc565dccb2435a044bdfabe060c7d5",
    },
    "latin-ext": {
        "file": "source-sans-3-latin-ext.woff2",
        "url": "https://fonts.gstatic.com/s/sourcesans3/v20/nwpStKy2OAdR1K-IwhWudF-R3wEaZfrc.woff2",
        "sha256": "a85a7459bdb3cdc1136751e151a506bae653fc29ada3ca86237477df6f1b59e6",
    },
    "cyrillic": {
        "file": "source-sans-3-cyrillic.woff2",
        "url": "https://fonts.gstatic.com/s/sourcesans3/v20/nwpStKy2OAdR1K-IwhWudF-R3wsaZfrc.woff2",
        "sha256": "b6b721e08d0324b9e743858e8260463085d4c5e1e684f036f9d4a8ca6c62996f",
    },
    "greek": {
        "file": "source-sans-3-greek.woff2",
        "url": "https://fonts.gstatic.com/s/sourcesans3/v20/nwpStKy2OAdR1K-IwhWudF-R3wwaZfrc.woff2",
        "sha256": "dd6ec3878cf37dc8b864562acf1a37bd8c9e0ca638d7f75a7cd6b6f7ae16cf3d",
    },
}

# Naming records that carry the family name. Everything else in `name` is kept,
# including the copyright notice (ID 0) that states the reserved font name.
RENAMED_IDS = {
    1: lambda text: text.replace(FAMILY_OLD, FAMILY_NEW),  # family: "Source Sans 3 ExtraLight"
    3: lambda text: f"{text.split(';')[0]};ENGT;{POSTSCRIPT_NEW}-Roman",  # unique id: version;vendor;PostScript name
    4: lambda text: text.replace(FAMILY_OLD, FAMILY_NEW),  # full name: "Source Sans 3"
    6: lambda text: text.replace(POSTSCRIPT_OLD, POSTSCRIPT_NEW),  # PostScript name: "SourceSans3-Roman"
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def output_name(subset: str) -> str:
    return f"eng-trainer-sans-{subset}.woff2"


def load(path: Path) -> TTFont:
    # No recalculation: bounding boxes, maxp values and timestamps stay exactly as published.
    return TTFont(str(path), recalcBBoxes=False, recalcTimestamp=False)


def verified_original(input_dir: Path, subset: str) -> Path:
    spec = ORIGINALS[subset]
    path = input_dir / spec["file"]
    actual = sha256(path.read_bytes())
    if actual != spec["sha256"]:
        raise SystemExit(f"{path}: SHA-256 {actual} does not match the recorded original {spec['sha256']}")
    return path


def download(input_dir: Path) -> None:
    input_dir.mkdir(parents=True, exist_ok=True)
    for spec in ORIGINALS.values():
        request = urllib.request.Request(spec["url"], headers={"User-Agent": "eng-trainer-font-preparation"})
        with urllib.request.urlopen(request, timeout=60) as response:
            (input_dir / spec["file"]).write_bytes(response.read())


def names(font: TTFont) -> list[dict]:
    return [
        {"platformID": r.platformID, "platEncID": r.platEncID, "langID": r.langID, "nameID": r.nameID, "string": r.toUnicode()}
        for r in font["name"].names
    ]


def derive(input_dir: Path, output_dir: Path) -> list[dict]:
    output_dir.mkdir(parents=True, exist_ok=True)
    changes = []
    for subset in ORIGINALS:
        source = verified_original(input_dir, subset)
        font = load(source)
        for record in font["name"].names:
            rename = RENAMED_IDS.get(record.nameID)
            if rename is None:
                continue
            before = record.toUnicode()
            after = rename(before)
            if after != before:
                record.string = after
                changes.append({"subset": subset, "nameID": record.nameID, "platformID": record.platformID, "langID": record.langID, "before": before, "after": after})
        leftover = [r for r in names(font) if r["nameID"] != 0 and ("Source" in r["string"] or POSTSCRIPT_OLD in r["string"])]
        if leftover:
            raise SystemExit(f"{subset}: reserved name still present in {leftover}")
        target = output_dir / output_name(subset)
        font.flavor = "woff2"
        font.save(str(target))
    return changes


def table_xml(font: TTFont, tag: str) -> str:
    buffer = io.StringIO()
    font.saveXML(buffer, tables=[tag])
    text = buffer.getvalue()
    if tag == "head":
        # The checksum adjustment covers the whole file, so it changes with any name change.
        text = "\n".join(line for line in text.splitlines() if "checkSumAdjustment" not in line)
    return text


def decoded_size(font: TTFont) -> int:
    clone = io.BytesIO()
    flavor = font.flavor
    font.flavor = None
    font.save(clone)
    font.flavor = flavor
    return len(clone.getvalue())


def check(input_dir: Path, output_dir: Path) -> dict:
    report = {"tool": {"python": sys.version.split()[0], "fontTools": fontTools.version}, "family": FAMILY_NEW, "subsets": {}}
    ok = True
    for subset in ORIGINALS:
        original_path = verified_original(input_dir, subset)
        derived_path = output_dir / output_name(subset)
        original, derived = load(original_path), load(derived_path)
        tags = sorted(set(original.keys()) | set(derived.keys()))
        identical, different = [], []
        for tag in tags:
            if tag in ("GlyphOrder", "name"):
                continue
            (identical if tag in original and tag in derived and table_xml(original, tag) == table_xml(derived, tag) else different).append(tag)
        glyph_order_same = original.getGlyphOrder() == derived.getGlyphOrder()
        before, after = names(original), names(derived)
        key = lambda r: (r["platformID"], r["platEncID"], r["langID"], r["nameID"])  # noqa: E731
        before_by_key, after_by_key = {key(r): r for r in before}, {key(r): r for r in after}
        same_records = before_by_key.keys() == after_by_key.keys() and len(before) == len(after)
        name_changes = [
            {"nameID": k[3], "platformID": k[0], "langID": k[2], "before": before_by_key[k]["string"], "after": after_by_key[k]["string"]}
            for k in sorted(before_by_key)
            if k in after_by_key and before_by_key[k]["string"] != after_by_key[k]["string"]
        ]
        unexpected_name_changes = [c for c in name_changes if c["nameID"] not in RENAMED_IDS]
        copyright_kept = [r["string"] for r in before if r["nameID"] == 0] == [r["string"] for r in after if r["nameID"] == 0]
        leftover = [r["string"] for r in after if r["nameID"] != 0 and "Source" in r["string"]]
        subset_ok = not different and glyph_order_same and not unexpected_name_changes and same_records and copyright_kept and not leftover
        ok = ok and subset_ok
        original_bytes, derived_bytes = original_path.read_bytes(), derived_path.read_bytes()
        report["subsets"][subset] = {
            "ok": subset_ok,
            "original": {"file": original_path.name, "url": ORIGINALS[subset]["url"], "bytes": len(original_bytes), "sha256": sha256(original_bytes), "decodedBytes": decoded_size(original)},
            "derived": {"file": derived_path.name, "bytes": len(derived_bytes), "sha256": sha256(derived_bytes), "decodedBytes": decoded_size(derived)},
            "glyphs": len(original.getGlyphOrder()),
            "codepoints": len(original.getBestCmap()),
            "axes": [{"tag": a.axisTag, "min": a.minValue, "default": a.defaultValue, "max": a.maxValue} for a in original["fvar"].axes] if "fvar" in original else [],
            "identicalTables": identical,
            "differentTables": different,
            "glyphOrderIdentical": glyph_order_same,
            "nameChanges": name_changes,
            "unexpectedNameChanges": unexpected_name_changes,
            "copyrightNoticeKept": copyright_kept,
            "reservedNameLeftInOtherRecords": leftover,
            "namesAfter": after,
        }
    report["ok"] = ok
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--download", action="store_true", help="download the recorded originals into --input-dir first")
    parser.add_argument("--check", action="store_true", help="compare originals and derivatives instead of deriving")
    parser.add_argument("--report", type=Path, help="write the --check report as JSON")
    args = parser.parse_args()
    if args.download:
        download(args.input_dir)
    if args.check:
        report = check(args.input_dir, args.output_dir)
        text = json.dumps(report, ensure_ascii=False, indent=2)
        if args.report:
            args.report.write_text(text + "\n", encoding="utf-8")
        print(json.dumps({subset: {"ok": data["ok"], "different": data["differentTables"], "renamed": sorted({c["nameID"] for c in data["nameChanges"]})} for subset, data in report["subsets"].items()}))
        if not report["ok"]:
            raise SystemExit("check failed")
        return
    for change in derive(args.input_dir, args.output_dir):
        print(json.dumps(change, ensure_ascii=False))


if __name__ == "__main__":
    main()
