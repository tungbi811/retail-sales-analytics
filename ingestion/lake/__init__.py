"""Deterministic synthetic source events derived from the Excel reference IDs."""

import json
from collections import defaultdict
from datetime import date
from pathlib import Path


START = date(2023, 1, 1)
END = date(2024, 7, 31)
SEED = 811


def write_jsonl_by_day(rows, root: Path, source: str, ts_key='ts'):
    """Replace each supplied day's partition, preserving exact duplicate events."""
    partitions = defaultdict(list)
    for row in rows:
        day = str(row[ts_key])[:10]
        date.fromisoformat(day)
        partitions[day].append(row)
    for day, events in sorted(partitions.items()):
        directory = root / source / f'dt={day}'
        directory.mkdir(parents=True, exist_ok=True)
        with (directory / 'part-0.jsonl').open('w', encoding='utf-8') as output:
            for event in events:
                output.write(json.dumps(event, ensure_ascii=False) + '\n')
