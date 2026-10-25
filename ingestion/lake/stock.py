"""Simulate replenishment and end-of-day inventory from deduplicated sales."""

from collections import defaultdict
from datetime import date, timedelta
from math import ceil

import numpy as np
import pandas as pd

from ingestion import lake


SUPPLIERS = ['Saigon Beauty Supply', 'Hanoi Cosmetics Trading', 'Delta Distribution', 'Central Goods Co']


def make_stock(ref, orders, rng) -> tuple[pd.DataFrame, pd.DataFrame]:
    pairs = [(store, product) for store in ref.stores.store_id for product in ref.products.product_id]
    indexes = {pair: i for i, pair in enumerate(pairs)}
    days = (lake.END - lake.START).days + 1
    demand = np.zeros((days, len(pairs)), dtype=np.int64)
    seen = set()
    for order in orders:
        if order['order_id'] in seen:
            continue
        seen.add(order['order_id'])
        offset = (date.fromisoformat(order['ts'][:10]) - lake.START).days
        for line in order['lines']:
            demand[offset, indexes[(order['store_id'], line['product_id'])]] += line['qty']
    # The constrained supplier serves the same observed growth pairs as orders.
    constrained = set(zip(ref.stores.store_id.head(6), ref.products.product_id.head(6)))
    initial_daily = np.maximum(1, demand[:min(30, days)].mean(axis=0))
    on_hand = np.ceil(initial_daily * 65).astype(np.int64)
    pipeline = np.zeros(len(pairs), dtype=np.int64)
    arrivals = defaultdict(list)
    deliveries, snapshots = [], []
    for offset in range(days):
        day = lake.START + timedelta(days=offset)
        for index, quantity in arrivals[offset]:
            on_hand[index] += quantity
            pipeline[index] -= quantity
        on_hand = np.maximum(0, on_hand - demand[offset])
        for index, (store, product) in enumerate(pairs):
            limited = (store, product) in constrained
            window = 90 if limited else 30
            daily = max(1, float(demand[max(0, offset - window + 1):offset + 1, index].mean()))
            safety = ceil(daily * (3 if limited else 14))
            # A slower forecast and small shipment allocation lag the six pairs'
            # rising demand; other suppliers carry more than a month's cover.
            reorder_point = ceil(daily * (14 if limited else 45))
            if on_hand[index] + pipeline[index] < reorder_point:
                quantity = ceil(daily * (7 if limited else 35))
                lead = int(rng.integers(7, 11))
                delay = int(rng.integers(2, 6)) if rng.random() < (0.40 if limited else 0.15) else 0
                promised = day + timedelta(days=lead)
                arrival = promised + timedelta(days=delay)
                arrivals[offset + lead + delay].append((index, quantity))
                pipeline[index] += quantity
                deliveries.append({
                    'delivery_id': f'DEL-{len(deliveries) + 1:07d}',
                    'supplier': 'Lotus Imports' if limited else SUPPLIERS[index % len(SUPPLIERS)],
                    'store_id': store, 'product_id': product,
                    'ordered_date': day.isoformat(), 'promised_date': promised.isoformat(),
                    'delivered_date': arrival.isoformat() if arrival <= lake.END else None,
                    'qty': quantity,
                })
            snapshots.append({'snapshot_date': day, 'store_id': store, 'product_id': product,
                              'on_hand': int(on_hand[index]), 'safety_stock': safety})
    return pd.DataFrame(snapshots, columns=[
        'snapshot_date', 'store_id', 'product_id', 'on_hand', 'safety_stock']), pd.DataFrame(deliveries, columns=[
        'delivery_id', 'supplier', 'store_id', 'product_id', 'ordered_date', 'promised_date', 'delivered_date', 'qty'])
