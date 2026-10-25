import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

import duckdb
import numpy as np

from ingestion import lake
from ingestion.lake.orders import make_orders
from ingestion.lake.promotions import make_promotions
from ingestion.lake.reference import load_reference
from ingestion.make_lake import main


XLSX = Path(__file__).resolve().parents[2] / 'data/business_sale_test.xlsx'


class MakeLakeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name) / 'lake'
        main(out=cls.root, xlsx=XLSX)
        cls.db = duckdb.connect()
        cls.db.execute("SET TimeZone = 'UTC'")
        cls.addClassCleanup(cls.db.close)
        for source, reader, glob in [
            ('orders', 'read_json_auto', 'orders/dt=*/part-0.jsonl'),
            ('web_events', 'read_json_auto', 'web_events/dt=*/part-0.jsonl'),
            ('stock_snapshots', 'read_parquet', 'stock_snapshots/month=*/part-0.parquet'),
            ('supplier_deliveries', 'read_csv_auto', 'supplier_deliveries/deliveries.csv'),
            ('support_tickets', 'read_json_auto', 'support_tickets/tickets.json'),
            ('promotions', 'read_json_auto', 'promotions/promotions.json'),
        ]:
            cls.db.execute(f"CREATE VIEW {source} AS SELECT * FROM {reader}('{cls.root / glob}')")
        cls.db.execute('''CREATE VIEW demand AS
            SELECT CAST(ts AS DATE) AS day, store_id, line.product_id AS product_id, sum(line.qty) AS qty
            FROM (SELECT DISTINCT ON (order_id) * FROM orders), UNNEST(lines) AS item(line)
            GROUP BY ALL''')
        rng = np.random.default_rng(lake.SEED)
        ref = load_reference(XLSX)
        _, churners = make_orders(ref, make_promotions(ref, rng), rng)
        cls.db.execute('CREATE TABLE churners (customer_id VARCHAR)')
        cls.db.executemany('INSERT INTO churners VALUES (?)', [(c,) for c in sorted(churners)])

    def test_all_sources_and_catalog(self):
        catalog = json.loads((self.root / '_catalog.json').read_text())
        self.assertEqual(set(catalog), {'orders', 'web_events', 'stock_snapshots',
                                      'supplier_deliveries', 'promotions', 'support_tickets'})
        for name, metadata in catalog.items():
            self.assertTrue(metadata['columns'])
            self.assertTrue(metadata['grain'])
            self.assertTrue(metadata['notes'])
            self.assertGreater(self.db.execute(f'SELECT count(*) FROM {name}').fetchone()[0], 0)
            columns = {row[0] for row in self.db.execute(f'DESCRIBE {name}').fetchall()}
            self.assertTrue(set(metadata['columns']).issubset(columns))
        self.assertEqual({v['format'] for v in catalog.values()}, {'jsonl', 'parquet', 'csv', 'json'})
        # The agents read the catalog, so it describes the data, never the findings planted in it.
        text = (self.root / '_catalog.json').read_text().lower()
        for giveaway in ['churn', 'fading', 'growing', 'limited', 'poorer', 'forward cover', 'stock-out']:
            self.assertNotIn(giveaway, text)
        self.assertEqual(len(list((self.root / 'orders').glob('dt=*/part-0.jsonl'))), 578)
        self.assertEqual(len(list((self.root / 'stock_snapshots').glob('month=*/part-0.parquet'))), 19)
        self.assertLess(sum(p.stat().st_size for p in self.root.rglob('*') if p.is_file()), 200_000_000)

    def test_stockouts_in_august(self):
        rows = self.db.execute('''WITH recent AS (
                SELECT store_id, product_id, sum(qty) / 30.0 AS daily
                FROM demand WHERE day BETWEEN DATE '2024-07-02' AND DATE '2024-07-31' GROUP BY ALL
            ), inbound AS (
                SELECT store_id, product_id, sum(qty) AS qty FROM supplier_deliveries
                WHERE delivered_date IS NULL AND promised_date BETWEEN DATE '2024-08-01' AND DATE '2024-08-31'
                GROUP BY ALL
            ) SELECT s.store_id, s.product_id, s.on_hand, r.daily, coalesce(i.qty, 0)
            FROM stock_snapshots s JOIN recent r USING (store_id, product_id)
            LEFT JOIN inbound i USING (store_id, product_id)
            WHERE s.snapshot_date = DATE '2024-07-31'
              AND r.daily > (s.on_hand + coalesce(i.qty, 0)) / 31.0''').fetchall()
        pairs = {(str(row[0]), str(row[1])) for row in rows}
        expected = {(str(101 + i), str(1 + i)) for i in range(6)}
        self.assertTrue(expected.issubset(pairs), (pairs, rows))
        self.assertGreaterEqual(len(pairs), 4)
        self.assertLessEqual(len(pairs), 8)
        self.assertTrue(all(row[2] > 0 for row in rows if (str(row[0]), str(row[1])) in expected))

    def test_stock_follows_orders_and_received_deliveries(self):
        violations = self.db.execute('''WITH stocks AS (
                SELECT *, lag(on_hand) OVER (PARTITION BY store_id, product_id ORDER BY snapshot_date) AS previous
                FROM stock_snapshots
            ), received AS (
                SELECT store_id, product_id, delivered_date AS day, sum(qty) AS qty
                FROM supplier_deliveries WHERE delivered_date IS NOT NULL GROUP BY ALL
            ) SELECT count(*) FROM stocks s
            LEFT JOIN demand d ON s.snapshot_date=d.day AND s.store_id=d.store_id AND s.product_id=d.product_id
            LEFT JOIN received r ON s.snapshot_date=r.day AND s.store_id=r.store_id AND s.product_id=r.product_id
            WHERE previous IS NOT NULL AND on_hand <> greatest(0, previous + coalesce(r.qty,0) - coalesce(d.qty,0))''').fetchone()[0]
        self.assertEqual(violations, 0)
        self.assertEqual(self.db.execute('''SELECT count(*) FROM supplier_deliveries WHERE qty <= 0
            OR promised_date <= ordered_date OR delivered_date < ordered_date
            OR delivered_date > DATE '2024-07-31' ''').fetchone()[0], 0)

    def test_churners_have_worse_experience(self):
        metrics = self.db.execute('''SELECT c.customer_id IS NOT NULL AS churner,
            avg(rating), avg(CASE WHEN category='late_delivery' THEN 1.0 ELSE 0 END)
            FROM support_tickets t LEFT JOIN churners c ON CAST(t.customer_id AS VARCHAR)=c.customer_id
            GROUP BY 1 ORDER BY 1''').fetchall()
        self.assertEqual(len(metrics), 2)
        self.assertLess(metrics[1][1], metrics[0][1])
        self.assertGreater(metrics[1][2], metrics[0][2])
        rows = json.loads((self.root / 'support_tickets/tickets.json').read_text())
        self.assertTrue(any('/' in r['opened_at'] for r in rows))
        self.assertTrue(any('T' in r['opened_at'] for r in rows))
        self.assertTrue(all(r['rating'] is None or 1 <= r['rating'] <= 5 for r in rows))
        self.assertEqual({r['kind'] for r in rows}, {'ticket', 'review'})
        self.assertTrue(all(r['order_id'] is None or self.db.execute(
            'SELECT count(*) FROM orders WHERE order_id=? AND CAST(customer_id AS VARCHAR)=? AND CAST(store_id AS VARCHAR)=?',
            [r['order_id'], r['customer_id'], r['store_id']]).fetchone()[0] > 0 for r in rows[:30]))

    def test_churners_web_activity_fades(self):
        metrics = self.db.execute('''SELECT c.customer_id,
            count(*) FILTER (WHERE CAST(ts AS DATE) < DATE '2023-04-01') AS early,
            count(*) FILTER (WHERE CAST(ts AS DATE) > DATE '2024-05-02') AS recent
            FROM web_events e JOIN churners c ON CAST(e.customer_id AS VARCHAR)=c.customer_id GROUP BY 1''').fetchall()
        self.assertEqual(len(metrics), 15)
        self.assertTrue(all(early > 0 and recent < early / 3 for _, early, recent in metrics), metrics)
        self.assertEqual({r[0] for r in self.db.execute('SELECT DISTINCT type FROM web_events').fetchall()},
                         {'visit', 'view', 'cart', 'checkout', 'login'})

    def test_rerun_is_identical(self):
        other = Path(self.temporary.name) / 'second'
        other.mkdir()
        (other / 'stale.txt').write_text('remove on rebuild')
        main(out=other, xlsx=XLSX)
        self.assertFalse((other / 'stale.txt').exists())
        for relative in ['supplier_deliveries/deliveries.csv', '_catalog.json']:
            self.assertEqual((self.root / relative).read_bytes(), (other / relative).read_bytes())

    def test_short_interval(self):
        other = Path(self.temporary.name) / 'short'
        with patch.object(lake, 'END', date(2023, 1, 14)):
            main(out=other, xlsx=XLSX)
        self.assertEqual(len(list((other / 'orders').glob('dt=*'))), 14)
        snapshot_range = self.db.execute(
            'SELECT min(snapshot_date), max(snapshot_date), count(*) FROM read_parquet(?)',
            [str(other / 'stock_snapshots/month=*/part-0.parquet')]).fetchone()
        self.assertEqual(snapshot_range, (date(2023, 1, 1), date(2023, 1, 14), 14 * 10 * 20))
        for source, name in [('support_tickets', 'tickets.json'), ('promotions', 'promotions.json')]:
            self.assertTrue(json.loads((other / source / name).read_text()))
