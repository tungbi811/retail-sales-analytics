import json
import tempfile
import unittest
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

from ingestion import lake
from ingestion.lake import END, SEED, START, write_jsonl_by_day
from ingestion.lake.orders import make_orders
from ingestion.lake.promotions import make_promotions
from ingestion.lake.reference import load_reference


XLSX = Path(__file__).resolve().parents[2] / 'data/business_sale_test.xlsx'


class OrdersTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ref = load_reference(XLSX)
        rng = np.random.default_rng(SEED)
        cls.promotions = make_promotions(cls.ref, rng)
        cls.orders, cls.churners = make_orders(cls.ref, cls.promotions, rng)
        cls.daily = Counter(date.fromisoformat(order['ts'][:10]) for order in cls.orders)

    def test_ids_match_excel(self):
        for sheet, column, frame, target in [
            ('Products', 'ProductID', self.ref.products, 'product_id'),
            ('Stores', 'StoreID', self.ref.stores, 'store_id'),
            ('Customers', 'CustomerID', self.ref.customers, 'customer_id'),
        ]:
            self.assertEqual(set(frame[target]), set(pd.read_excel(XLSX, sheet)[column].astype(str)))
        self.assertEqual(list(self.ref.products), ['product_id', 'product_name', 'category'])
        self.assertEqual(list(self.ref.stores), ['store_id', 'store_name', 'region', 'city'])
        self.assertEqual(list(self.ref.customers), ['customer_id', 'gender', 'birth_year'])
        products = set(self.ref.products.product_id)
        stores = set(self.ref.stores.store_id)
        customers = set(self.ref.customers.customer_id)
        for order in self.orders:
            self.assertIn(order['store_id'], stores)
            self.assertTrue(order['customer_id'] is None or order['customer_id'] in customers)
            self.assertIn(order['channel'], ['store', 'web', 'app'])
            self.assertTrue(order['lines'])
            for line in order['lines']:
                self.assertIn(line['product_id'], products)

    def test_daily_volume(self):
        days = {START + timedelta(days=i) for i in range((END - START).days + 1)}
        self.assertEqual(set(self.daily), days)
        self.assertGreaterEqual(np.mean(list(self.daily.values())), 250)
        self.assertLessEqual(np.mean(list(self.daily.values())), 350)

    def test_seasonality_and_weekends(self):
        winter = [n for d, n in self.daily.items() if d.year == 2023 and d.month in (11, 12)]
        spring = [n for d, n in self.daily.items() if d.year == 2023 and d.month in (2, 3)]
        self.assertGreater(np.mean(winter), 1.2 * np.mean(spring))
        self.assertGreater(np.mean([n for d, n in self.daily.items() if d.weekday() >= 5]),
                           np.mean([n for d, n in self.daily.items() if d.weekday() < 5]))

    def test_promotions_lift_quantity(self):
        quantities = defaultdict(lambda: {True: [], False: []})
        categories = dict(zip(self.ref.products.product_id, self.ref.products.category))
        for order in self.orders:
            day = order['ts'][:10]
            active = [p for p in self.promotions if p['start'] <= day <= p['end']
                      and (not p['store_ids'] or order['store_id'] in p['store_ids'])]
            for line in order['lines']:
                discounts = [p['discount_pct'] for p in active
                             if line['product_id'] in p['product_ids']
                             or categories[line['product_id']] in p['categories']]
                self.assertEqual(line['discount_pct'], max(discounts, default=0))
                quantities[line['product_id']][bool(discounts)].append(line['qty'])
        paired = [q for q in quantities.values() if q[True] and q[False]]
        self.assertGreater(len(paired), 0)
        for q in paired:
            self.assertGreater(np.mean(q[True]), np.mean(q[False]))
        months = Counter(p['start'][:7] for p in self.promotions)
        self.assertEqual(len(months), 19)
        self.assertTrue(all(n == 3 for n in months.values()))
        for promotion in self.promotions:
            self.assertLessEqual(0.05, promotion['discount_pct'])
            self.assertLessEqual(promotion['discount_pct'], 0.25)
            duration = (date.fromisoformat(promotion['end']) - date.fromisoformat(promotion['start'])).days + 1
            self.assertLessEqual(3, duration)
            self.assertLessEqual(duration, 14)

    def test_churners_fade(self):
        self.assertGreaterEqual(len(self.churners) / len(self.ref.customers), 0.1)
        self.assertLessEqual(len(self.churners) / len(self.ref.customers), 0.2)
        first, last = Counter(), Counter()
        for order in self.orders:
            day = date.fromisoformat(order['ts'][:10])
            if day < START + timedelta(days=90):
                first[order['customer_id']] += 1
            if day > END - timedelta(days=90):
                last[order['customer_id']] += 1
        for customer in self.churners:
            self.assertGreater(first[customer], 0)
            self.assertLess(last[customer], first[customer] / 3)

    def test_walkins_duplicates_and_price_bands(self):
        self.assertAlmostEqual(sum(o['customer_id'] is None for o in self.orders) / len(self.orders), 0.3, delta=0.015)
        unique = {}
        duplicates = 0
        prices = defaultdict(list)
        for order in self.orders:
            if order['order_id'] in unique:
                self.assertEqual(order, unique[order['order_id']])
                duplicates += 1
            unique[order['order_id']] = order
            for line in order['lines']:
                self.assertIsInstance(line['qty'], int)
                self.assertGreater(line['qty'], 0)
                prices[line['product_id']].append(line['unit_price'])
        self.assertAlmostEqual(duplicates / len(self.orders), 0.005, delta=0.0001)
        for values in prices.values():
            self.assertGreater(min(values), 0)
            self.assertLessEqual(max(values) / min(values), 1.11)

    def test_same_seed_same_output(self):
        def generate(seed):
            rng = np.random.default_rng(seed)
            promotions = make_promotions(self.ref, rng)
            return promotions, make_orders(self.ref, promotions, rng)

        with patch.object(lake, 'END', date(2023, 1, 14)):
            self.assertEqual(generate(SEED), generate(SEED))
            self.assertNotEqual(generate(SEED), generate(SEED + 1))
            promotions, (orders, _) = generate(SEED)
        self.assertEqual(len({o['ts'][:10] for o in orders}), 14)
        self.assertTrue(all(START.isoformat() <= o['ts'][:10] <= '2023-01-14' for o in orders))
        self.assertTrue(all('2023-01-01' <= p['start'] <= p['end'] <= '2023-01-14' for p in promotions))

    def test_six_pairs_have_growing_recent_demand(self):
        pairs = list(zip(self.ref.stores.store_id.head(6), self.ref.products.product_id.head(6)))
        earlier, recent = Counter(), Counter()
        for order in self.orders:
            day = order['ts'][:10]
            target = earlier if '2024-02-01' <= day <= '2024-03-31' else recent if '2024-06-01' <= day <= '2024-07-31' else None
            if target is not None:
                for line in order['lines']:
                    target[(order['store_id'], line['product_id'])] += line['qty']
        for pair in pairs:
            self.assertGreater(recent[pair] / 61, 1.3 * earlier[pair] / 60)

    def test_write_jsonl_by_day(self):
        rows = [
            {'created': '2024-07-31T12:00:00+00:00', 'name': 'Đà Nẵng'},
            {'created': '2024-07-30T10:00:00+00:00', 'name': 'Hà Nội'},
            {'created': '2024-07-31T12:00:00+00:00', 'name': 'Đà Nẵng'},
        ]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_jsonl_by_day(rows, root, 'orders', ts_key='created')
            files = sorted(root.rglob('*.jsonl'))
            self.assertEqual([str(p.relative_to(root)) for p in files], [
                'orders/dt=2024-07-30/part-0.jsonl', 'orders/dt=2024-07-31/part-0.jsonl'])
            self.assertEqual([json.loads(line) for line in files[1].read_text().splitlines()], [rows[0], rows[2]])
            write_jsonl_by_day(rows, root, 'orders', ts_key='created')
            self.assertEqual(len(files[1].read_text().splitlines()), 2)
