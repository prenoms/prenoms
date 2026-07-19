#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Build the Prénom list from INSEE's fichier des prénoms.

Reads INSEE's national birth-registration file (one row per
sexe/prénom/année/nombre) and emits a flat CSV of the Prénoms worth showing:

    firstname,male,female
    Camille,true,true
    Louise,false,true

Popularity is used to decide *which* Prénoms make the cut and how the male /
female flags are set, and is then thrown away — the webapp only ever sees the
three columns above.

Rows a developer added by hand are preserved across regenerations: any Prénom
present in the existing CSV but absent from INSEE's output is kept as-is.

Usage:
    ./tools/build_prenoms.py                      # download from insee.fr
    ./tools/build_prenoms.py --input nat2023.zip  # use a local copy
"""

from __future__ import annotations

import argparse
import csv
import datetime
import io
import sys
import unicodedata
import urllib.request
import zipfile
from collections import defaultdict
from collections.abc import Sequence
from pathlib import Path

# INSEE republishes this yearly under a new identifier and has changed the file
# naming scheme before now; override with --url when the edition moves.
INSEE_URL = (
    "https://www.insee.fr/fr/statistiques/fichier/8595130/prenoms-2025-nat_csv.zip"
)

# The 2025 edition renamed every column. Older editions (<= 2023) used the names on
# the right, and still parse.
COLUMNS = {
    "name": ("prenom", "preusuel"),
    "year": ("periode", "annais"),
    "count": ("valeur", "nombre"),
}

# Markers used by older editions for rows that are not actual prénoms. The 2025
# edition contains neither, but the guards cost nothing.
RARE_BUCKET = "_PRENOMS_RARES"
UNKNOWN_YEAR = "XXXX"

DEFAULT_WINDOW = 25  # years of births considered "living naming practice"
DEFAULT_MIN_BIRTHS = 500  # over the whole window, to enter the list at all
DEFAULT_FLAG_SHARE = 0.10  # share of births needed to belong to a sex's Deck

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = REPO_ROOT / "data" / "prenoms.csv"


def fetch(url: str) -> bytes:
    print(f"downloading {url}", file=sys.stderr)
    with urllib.request.urlopen(url) as response:  # noqa: S310 - fixed https host
        return response.read()


def resolve_columns(fieldnames: Sequence[str] | None) -> dict[str, str]:
    """Map our field names onto whichever INSEE column naming this edition uses."""
    present = set(fieldnames or ())
    if "sexe" not in present:
        raise SystemExit(f"no 'sexe' column in {fieldnames!r}")

    resolved = {}
    for field, candidates in COLUMNS.items():
        match = next((c for c in candidates if c in present), None)
        if match is None:
            raise SystemExit(
                f"no column for {field!r} in {fieldnames!r}; "
                f"expected one of {list(candidates)}"
            )
        resolved[field] = match
    return resolved


def rows(payload: bytes):
    """Yield (row, columns) from a zipped or bare INSEE CSV."""
    if payload[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            names = [n for n in archive.namelist() if n.lower().endswith(".csv")]
            if not names:
                raise SystemExit("no .csv inside the archive")
            payload = archive.read(names[0])

    try:
        text = payload.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = payload.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    columns = resolve_columns(reader.fieldnames)
    for row in reader:
        yield row, columns


def strip_accents(raw: str) -> str:
    """MARIE-THÉRÈSE -> MARIE-THERESE.

    INSEE records accented and unaccented spellings as separate names (Zoé, Zoe, Zoë;
    Maël, Mael). Folding them together collapses ~2000 near-duplicates and drops the
    registry's encoding artefacts (Émma, Louïs) into their real spelling.
    """
    expanded = raw.replace("Œ", "OE").replace("œ", "oe")
    expanded = expanded.replace("Æ", "AE").replace("æ", "ae")
    decomposed = unicodedata.normalize("NFD", expanded)
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def titlecase(raw: str) -> str:
    """MARIE-THERESE -> Marie-Therese, keeping hyphens and apostrophes intact."""
    out = []
    capitalise_next = True
    for char in raw.strip():
        out.append(char.upper() if capitalise_next else char.lower())
        capitalise_next = char in "-' "
    return "".join(out)


def sort_key(name: str) -> tuple[str, str]:
    """Sort accent-insensitively so Élodie lands next to Elodie, not after Zoé."""
    stripped = unicodedata.normalize("NFD", name.casefold())
    folded = "".join(c for c in stripped if not unicodedata.combining(c))
    return (folded, name)


def tally(records, window: int) -> dict[str, dict[str, int]]:
    """Sum births per Prénom per sex over the trailing `window` years."""
    cutoff = datetime.date.today().year - window
    counts: dict[str, dict[str, int]] = defaultdict(lambda: {"male": 0, "female": 0})

    for row, columns in records:
        name = (row[columns["name"]] or "").strip()
        year = (row[columns["year"]] or "").strip()

        if not name or name == RARE_BUCKET or len(name) < 2:
            continue
        if year == UNKNOWN_YEAR or not year.isdigit() or int(year) < cutoff:
            continue

        sex = "male" if row["sexe"].strip() == "1" else "female"
        counts[titlecase(strip_accents(name))][sex] += int(row[columns["count"]])

    return counts


def select(
    counts: dict[str, dict[str, int]], min_births: int, flag_share: float
) -> dict[str, tuple[bool, bool]]:
    selected: dict[str, tuple[bool, bool]] = {}
    for name, sexes in counts.items():
        total = sexes["male"] + sexes["female"]
        if total < min_births:
            continue
        selected[name] = (
            sexes["male"] / total >= flag_share,
            sexes["female"] / total >= flag_share,
        )
    return selected


def read_existing(path: Path) -> dict[str, tuple[bool, bool]]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8", newline="") as handle:
        return {
            row["firstname"]: (row["male"] == "true", row["female"] == "true")
            for row in csv.DictReader(handle)
            if row.get("firstname")
        }


def write(path: Path, prenoms: dict[str, tuple[bool, bool]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(["firstname", "male", "female"])
        for name in sorted(prenoms, key=sort_key):
            male, female = prenoms[name]
            writer.writerow([name, str(male).lower(), str(female).lower()])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="local INSEE csv or zip")
    parser.add_argument("--url", default=INSEE_URL, help="INSEE download url")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--window", type=int, default=DEFAULT_WINDOW)
    parser.add_argument("--min-births", type=int, default=DEFAULT_MIN_BIRTHS)
    parser.add_argument("--flag-share", type=float, default=DEFAULT_FLAG_SHARE)
    args = parser.parse_args()

    payload = args.input.read_bytes() if args.input else fetch(args.url)
    counts = tally(rows(payload), args.window)
    generated = select(counts, args.min_births, args.flag_share)

    existing = read_existing(args.output)
    handwritten = {n: v for n, v in existing.items() if n not in generated}

    write(args.output, generated | handwritten)

    both = sum(1 for male, female in generated.values() if male and female)
    print(
        f"{len(counts)} prénoms seen, {len(generated)} kept "
        f"({both} in both decks), {len(handwritten)} hand-written preserved "
        f"-> {args.output}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
