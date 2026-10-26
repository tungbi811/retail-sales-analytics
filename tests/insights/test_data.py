import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

from api.services.insights import data
from ingestion import lake, make_lake


class DataTest(unittest.TestCase):
    def test_describe_lake_is_markdown_with_every_source_column_and_a_sample(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'lake'
            with mock.patch.object(lake, 'START', date(2024, 7, 18)), mock.patch.object(lake, 'END', date(2024, 7, 31)):
                make_lake.main(root)
            result = data.describe_lake(root)
            catalog = json.loads((root / '_catalog.json').read_text())
            self.assertTrue(result.startswith('## Data lake'))
            for source, entry in catalog.items():
                with self.subTest(source=source):
                    self.assertIn(f'### {source}', result)
                    self.assertIn(f"read_{'json_auto' if entry['format'] in ('json', 'jsonl') else 'csv_auto' if entry['format'] == 'csv' else 'parquet'}('{{LAKE}}/{entry['path']}')", result)
                    self.assertIn(entry['notes'], result)
                    for column in entry['columns']:
                        self.assertIn(f'| `{column}` |', result)
            self.assertRegex(result, r'### orders\n.*\d[\d,]* rows')
            self.assertEqual(result.count('Sample row:'), 6)
            # Read the whole thing as the model would: no JSON blobs it has to unpack.
            self.assertNotIn('"sample_rows"', result)

    def test_describe_lake_without_catalog_says_how_to_make_it(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertIn('uv run python -m ingestion.make_lake', data.describe_lake(Path(directory)))

    def test_describe_gold_lists_only_gold_tables_and_columns(self):
        connection = mock.MagicMock()
        connection.__enter__.return_value.execute.return_value.fetchall.return_value = [
            {'table_name': 'fact_sales', 'column_name': 'revenue', 'data_type': 'numeric'},
            {'table_name': 'dim_store', 'column_name': 'store_id', 'data_type': 'bigint'},
        ]
        result = data.describe_gold(lambda: connection)
        self.assertIn('- `gold.fact_sales`: revenue (numeric)', result)
        self.assertIn('- `gold.dim_store`: store_id (bigint)', result)
        query = connection.__enter__.return_value.execute.call_args.args[0]
        self.assertIn('information_schema.columns', query)
        self.assertIn("table_schema = 'gold'", query)

    def test_data_info_combines_lake_and_gold(self):
        with mock.patch.object(data, 'describe_lake', return_value='lake sample'), \
             mock.patch.object(data, 'describe_gold', return_value='gold columns'), \
             mock.patch.object(data, 'lake_span', return_value=('2023-01-01', '2024-07-31')):
            result = data.data_info(object())
        self.assertIn('lake sample', result)
        self.assertIn('gold columns', result)
        # Says which data suits forecasts and where names live, so the agents don't forecast from a snapshot.
        self.assertTrue(result.startswith('## Which data to use'))
        self.assertIn('daily history from 2023-01-01 to 2024-07-31', result)
        self.assertIn('cast them to integers to join gold', result)

    def test_lake_span_reads_the_order_days(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'lake'
            with mock.patch.object(lake, 'START', date(2024, 7, 18)), mock.patch.object(lake, 'END', date(2024, 7, 31)):
                make_lake.main(root)
            self.assertEqual(data.lake_span(root), ('2024-07-18', '2024-07-31'))
            self.assertIsNone(data.lake_span(Path(directory) / 'missing'))
