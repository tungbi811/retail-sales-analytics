"""Write the machine-readable map of raw lake sources."""

import json
from pathlib import Path


def write_catalog(root: Path, sources: dict[str, dict]) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / '_catalog.json').write_text(
        json.dumps(sources, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')
