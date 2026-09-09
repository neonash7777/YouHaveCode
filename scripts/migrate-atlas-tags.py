#!/usr/bin/env python3
"""Export personal Atlas tags and later import them into YouHaveCode.

Examples:
  python3 scripts/migrate-atlas-tags.py export
  python3 scripts/migrate-atlas-tags.py import
  python3 scripts/migrate-atlas-tags.py import --apply
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_SOURCE = ROOT / "data" / "unicode.db"
DEFAULT_EXPORT = ROOT / "data" / "youhavecode-custom-tags.json"
DEFAULT_STATE = Path.home() / "Library/Application Support/Code/User/globalStorage/state.vscdb"
EXPORT_KIND = "youhavecode.customGlyphTags"
EXPORT_VERSION = 1


def normalize_tag(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip().lower()
    parts: list[str] = []
    separator = False
    for character in normalized:
        if character.isalnum() or character in "_-":
            parts.append(character)
            separator = False
        elif not separator:
            parts.append("-")
            separator = True
    return "".join(parts).strip("-_")


def load_atlas_assignments(source: Path) -> tuple[dict[str, list[str]], dict[str, str]]:
    query = """
        SELECT st.symbol_codepoint, t.name
        FROM symbol_tags st
        JOIN tags t ON t.id = st.tag_id
        WHERE lower(t.name) = 'favorite'
           OR NOT EXISTS (SELECT 1 FROM groups g WHERE g.name = t.name)
              AND t.name NOT LIKE 'AUTO:%'
              AND t.name NOT LIKE 'Shape:%'
              AND t.name NOT LIKE 'Ordinal:Group:%'
              AND t.name <> 'Numeric:HasValue'
        ORDER BY st.symbol_codepoint, t.name COLLATE NOCASE
    """
    assignments: dict[str, set[str]] = defaultdict(set)
    source_tags: dict[str, str] = {}
    with sqlite3.connect(f"file:{source}?mode=ro", uri=True) as connection:
        for codepoint, source_tag in connection.execute(query):
            source_name = str(source_tag)
            tag = "favorite" if source_name.casefold() == "favorite" else normalize_tag(source_name)
            if tag:
                assignments[f"{int(codepoint):X}"].add(tag)
                source_tags[source_name] = tag
    return {hex_value: sorted(tags) for hex_value, tags in assignments.items()}, source_tags


def write_export(source: Path, output: Path) -> None:
    if not source.is_file():
        raise SystemExit(f"Source database not found: {source}")
    assignments, source_tags = load_atlas_assignments(source)
    payload = {
        "schemaVersion": EXPORT_VERSION,
        "kind": EXPORT_KIND,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "source": str(source),
        "tagMappings": source_tags,
        "customGlyphTags": assignments,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(f"{output.suffix}.tmp")
    temporary.write_text(f"{json.dumps(payload, ensure_ascii=False, indent=2)}\n", encoding="utf-8")
    temporary.replace(output)
    print(f"Exported {sum(map(len, assignments.values()))} assignments across {len(source_tags)} tags to {output}")
    print("Tag mappings: " + ", ".join(f"{source} -> {target}" for source, target in sorted(source_tags.items())))


def load_export(path: Path) -> dict[str, list[str]]:
    if not path.is_file():
        raise SystemExit(f"Export file not found: {path}")
    payload: Any = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("schemaVersion") != EXPORT_VERSION or payload.get("kind") != EXPORT_KIND:
        raise SystemExit(f"Unsupported YouHaveCode tag export: {path}")
    assignments = payload.get("customGlyphTags")
    if not isinstance(assignments, dict):
        raise SystemExit(f"Export has no customGlyphTags object: {path}")
    result: dict[str, list[str]] = {}
    for hex_value, tags in assignments.items():
        if not isinstance(hex_value, str) or not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
            raise SystemExit(f"Invalid assignment in export for {hex_value!r}")
        try:
            canonical_hex = f"{int(hex_value, 16):X}"
        except ValueError as error:
            raise SystemExit(f"Invalid code point in export: {hex_value!r}") from error
        normalized = {normalize_tag(tag) for tag in tags}
        result[canonical_hex] = sorted(tag for tag in normalized if tag)
    return result


def merge_assignments(existing: object, imported: dict[str, list[str]]) -> tuple[dict[str, list[str]], int]:
    merged: dict[str, list[str]] = {}
    if isinstance(existing, dict):
        for hex_value, tags in existing.items():
            if isinstance(tags, list):
                normalized = {normalize_tag(str(tag)) for tag in tags}
                merged[str(hex_value).upper()] = sorted(tag for tag in normalized if tag)
    additions = 0
    for hex_value, tags in imported.items():
        current = set(merged.get(hex_value, []))
        additions += len(set(tags) - current)
        merged[hex_value] = sorted(current | set(tags))
    return dict(sorted(merged.items(), key=lambda item: int(item[0], 16))), additions


def resolve_state_key(connection: sqlite3.Connection, requested: str | None) -> str:
    if requested:
        keys = [requested]
    else:
        keys = [row[0] for row in connection.execute("SELECT key FROM ItemTable WHERE key LIKE '%.youhavecode' ORDER BY key")]
    if len(keys) != 1:
        detail = "none found" if not keys else f"multiple found: {', '.join(keys)}"
        raise SystemExit(f"Could not auto-detect one YouHaveCode state key ({detail}). Launch the installed extension once or pass --state-key.")
    return keys[0]


def read_memento(connection: sqlite3.Connection, state_key: str) -> dict[str, object]:
    row = connection.execute("SELECT value FROM ItemTable WHERE key = ?", (state_key,)).fetchone()
    if row is None:
        raise SystemExit(f"State key {state_key!r} does not exist. Launch YouHaveCode once, then rerun.")
    value = json.loads(row[0])
    if not isinstance(value, dict):
        raise SystemExit(f"State key {state_key!r} does not contain a JSON object.")
    return value


def import_export(path: Path, state_db: Path, requested_key: str | None, apply: bool) -> None:
    imported = load_export(path)
    if not state_db.is_file():
        raise SystemExit(f"VS Code state database not found: {state_db}")
    with sqlite3.connect(state_db) as connection:
        state_key = resolve_state_key(connection, requested_key)
        memento = read_memento(connection, state_key)
        existing = memento.get("customGlyphTags")
        merged, additions = merge_assignments(existing, imported)
        existing_count = sum(len(tags) for tags in existing.values()) if isinstance(existing, dict) else 0
        print(f"Import: {path}")
        print(f"Target: {state_db} [{state_key}]")
        print(f"Assignments: {sum(map(len, imported.values()))} imported, {existing_count} existing, {additions} new")
        if not apply:
            print("Dry run only. Close the target VS Code window and rerun with --apply.")
            return

        backup = state_db.with_name(f"{state_db.name}.bak-tags-{datetime.now().strftime('%Y%m%d-%H%M%S')}")
        connection.commit()
        with sqlite3.connect(backup) as backup_connection:
            connection.backup(backup_connection)
        memento["customGlyphTags"] = merged
        connection.execute("UPDATE ItemTable SET value = ? WHERE key = ?", (json.dumps(memento, separators=(",", ":"), ensure_ascii=False), state_key))
        connection.commit()
        if read_memento(connection, state_key).get("customGlyphTags") != merged:
            raise SystemExit("Verification failed after writing YouHaveCode state.")
        print(f"Migrated {additions} new assignments. Backup: {backup}")
        print("Restart the target VS Code window to load the migrated tags.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    export_parser = commands.add_parser("export", help="Create a portable JSON export from Unicode Atlas")
    export_parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="Unicode Atlas SQLite database")
    export_parser.add_argument("--output", type=Path, default=DEFAULT_EXPORT, help="Portable JSON output")
    import_parser = commands.add_parser("import", help="Merge a portable export into an installed YouHaveCode profile")
    import_parser.add_argument("--input", type=Path, default=DEFAULT_EXPORT, help="Portable JSON export")
    import_parser.add_argument("--state-db", type=Path, default=DEFAULT_STATE, help="VS Code globalStorage/state.vscdb")
    import_parser.add_argument("--state-key", help="YouHaveCode memento key; auto-detected by default")
    import_parser.add_argument("--apply", action="store_true", help="Write the merge; without this flag the import is a dry run")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.command == "export":
        write_export(args.source, args.output)
    else:
        import_export(args.input, args.state_db, args.state_key, args.apply)


if __name__ == "__main__":
    main()
