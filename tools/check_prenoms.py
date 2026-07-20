#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Validate and normalise the Prénom List.

The Prénom List is hand-edited, so it drifts: duplicates creep in, flags get typo'd,
casing goes inconsistent. This checks it and — unless --check is passed — rewrites it
sorted by firstname so duplicates sit next to each other in the diff.

Checks:
  - exactly the columns firstname, male, female
  - no duplicate Prénom (accent- and case-insensitively: Zoe and Zoé collide)
  - male/female are literally true or false
  - at least one of male/female is true (a Prénom in no Deck is unreachable)
  - firstname is non-empty, title-cased, and free of stray whitespace

Usage:
    ./tools/check_prenoms.py            # validate, then rewrite sorted
    ./tools/check_prenoms.py --check    # validate only, exit 1 on any problem
"""

from __future__ import annotations

import argparse
import csv
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATH = REPO_ROOT / "frontend" / "data" / "prenoms.csv"

HEADER = ["firstname", "male", "female"]
BOOLEANS = {"true", "false"}


def fold(name: str) -> str:
    """Collapse case and accents so Zoé and ZOE are recognised as the same Prénom."""
    decomposed = unicodedata.normalize("NFD", name.casefold())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def sort_key(name: str) -> tuple[str, str]:
    return (fold(name), name)


def titlecase(raw: str) -> str:
    out = []
    capitalise_next = True
    for char in raw:
        out.append(char.upper() if capitalise_next else char.lower())
        capitalise_next = char in "-' "
    return "".join(out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", type=Path, default=DEFAULT_PATH)
    parser.add_argument(
        "--check", action="store_true", help="validate only, do not rewrite"
    )
    args = parser.parse_args()

    if not args.path.exists():
        raise SystemExit(f"{args.path} does not exist — run tools/build_prenoms.py")

    with args.path.open(encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        try:
            header = next(reader)
        except StopIteration:
            raise SystemExit(f"{args.path} is empty") from None
        rows = list(reader)

    problems: list[str] = []
    if header != HEADER:
        problems.append(f"header is {header}, expected {HEADER}")

    seen: dict[str, list[int]] = defaultdict(list)
    entries: dict[str, tuple[str, str]] = {}

    for offset, row in enumerate(rows):
        line = offset + 2  # header is line 1
        if len(row) != 3:
            problems.append(f"line {line}: {len(row)} columns, expected 3 — {row}")
            continue

        name, male, female = row
        if name != name.strip() or not name:
            problems.append(f"line {line}: blank or padded firstname {name!r}")
            continue
        if name != titlecase(name):
            problems.append(f"line {line}: {name!r} should be {titlecase(name)!r}")
        if male not in BOOLEANS or female not in BOOLEANS:
            problems.append(
                f"line {line}: {name} has non-boolean flags {male}/{female}"
            )
            continue
        if male == "false" and female == "false":
            problems.append(f"line {line}: {name} belongs to no deck")

        seen[fold(name)].append(line)
        entries.setdefault(name, (male, female))

    for lines in seen.values():
        if len(lines) > 1:
            names = ", ".join(rows[n - 2][0] for n in lines)
            problems.append(f"duplicate across lines {lines}: {names}")

    for problem in problems:
        print(f"error: {problem}", file=sys.stderr)

    if problems:
        raise SystemExit(f"{len(problems)} problem(s) in {args.path}")

    if args.check:
        print(f"{len(rows)} prénoms, no problems", file=sys.stderr)
        return

    ordered = sorted(entries, key=sort_key)
    already_sorted = ordered == [row[0] for row in rows]

    with args.path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(HEADER)
        for name in ordered:
            writer.writerow([name, *entries[name]])

    state = "already sorted" if already_sorted else "reordered"
    print(f"{len(ordered)} prénoms, no problems, {state}", file=sys.stderr)


if __name__ == "__main__":
    main()
