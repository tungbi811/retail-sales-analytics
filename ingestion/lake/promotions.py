"""Three bounded campaigns per month, using product or category targeting."""

from datetime import date, timedelta

import pandas as pd

from ingestion import lake


def make_promotions(ref, rng) -> list[dict]:
    products = ref.products.product_id.to_list()
    stores = ref.stores.store_id.to_list()
    categories = ref.products.category.drop_duplicates().to_list()
    promotions = []
    for month in pd.period_range(lake.START, lake.END, freq='M'):
        first = max(lake.START, date(month.year, month.month, 1))
        last = min(lake.END, month.end_time.date())
        available = (last - first).days + 1
        for number in range(3):
            duration = min(int(rng.integers(3, 15)), available)
            start = first + timedelta(days=int(rng.integers(0, available - duration + 1)))
            by_category = number == 2
            promotions.append({
                'promotion_id': f'PROMO-{month.year}{month.month:02d}-{number + 1}',
                'name': f'{month} campaign {number + 1}',
                'product_ids': [] if by_category else rng.choice(products, size=min(4, len(products)), replace=False).tolist(),
                'categories': [str(rng.choice(categories))] if by_category else [],
                'store_ids': [] if number == 0 else rng.choice(stores, size=min(5, len(stores)), replace=False).tolist(),
                'start': start.isoformat(),
                'end': (start + timedelta(days=duration - 1)).isoformat(),
                'discount_pct': int(rng.integers(1, 6)) / 20,
            })
    return promotions
