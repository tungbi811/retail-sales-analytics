import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

from api.services.insights import data
from ingestion import lake, make_lake


class DataTest(unittest.TestCase):
    def test_describe_lake_lists_six_sources_with_samples(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'lake'
            with mock.patch.object(lake, 'START', date(2024, 7, 18)), mock.patch.object(lake, 'END', date(2024, 7, 31)):
                make_lake.main(root)
            result = json.loads(data.describe_lake(root))
            self.assertEqual(set(result), {'orders', 'web_events', 'stock_snapshots',
                                           'supplier_deliveries', 'promotions', 'support_tickets'})
            catalog = json.loads((root / '_catalog.json').read_text())
            for source, entry in result.items():
                with self.subTest(source=source):
                    self.assertEqual(entry['catalog'], catalog[source])
                    self.assertEqual(len(entry['sample_rows']), 3)
                    self.assertTrue(set(catalog[source]['columns']) <= set(entry['sample_rows'][0]))
            self.assertIsInstance(result['orders']['sample_rows'][0]['lines'], list)
            self.assertGreater(result['supplier_deliveries']['sample_rows'][0]['qty'], 0)

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
        for value in ('fact_sales', 'revenue', 'numeric', 'dim_store', 'store_id', 'bigint'):
            self.assertIn(value, result)
        query = connection.__enter__.return_value.execute.call_args.args[0]
        self.assertIn('information_schema.columns', query)
        self.assertIn("table_schema = 'gold'", query)

    def test_data_info_combines_lake_and_gold(self):
        with mock.patch.object(data, 'describe_lake', return_value='lake sample'), \
             mock.patch.object(data, 'describe_gold', return_value='gold columns'):
            result = data.data_info(object())
        self.assertIn('lake sample', result)
        self.assertIn('gold columns', result)
