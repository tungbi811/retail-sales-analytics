"""Generate pure order events with seasonality, campaign lift and fading cohorts."""

from copy import deepcopy
from datetime import date, datetime, time, timedelta, timezone

import numpy as np

from ingestion import lake


def make_orders(ref, promotions, rng) -> tuple[list[dict], set[str]]:
    products = ref.products.product_id.to_list()
    stores = ref.stores.store_id.to_list()
    customers = ref.customers.customer_id.to_list()
    categories = ref.products.category.to_list()
    days = [lake.START + timedelta(days=i) for i in range((lake.END - lake.START).days + 1)]
    if not days:
        return [], set()

    month_weights = [0.92, 0.82, 0.86, 0.96, 1, 1, 0.95, 0.98, 1, 1.05, 1.27, 1.40]
    weights = np.array([month_weights[d.month - 1] * (1.20 if d.weekday() >= 5 else 0.92) for d in days])
    counts = rng.poisson(300 * weights / weights.mean())
    churn_indices = rng.choice(len(customers), size=max(1, round(0.15 * len(customers))), replace=False)
    churners = {customers[i] for i in churn_indices}
    # Stable per-product bases, with each transaction within 5% of its base.
    bases = rng.integers(8, 61, size=len(products)) * 10_000
    store_indices = rng.integers(0, len(stores), size=int(counts.sum()))
    walkins = rng.random(int(counts.sum())) < 0.30
    channels = rng.choice(['store', 'web', 'app'], p=[0.72, 0.16, 0.12], size=int(counts.sum()))
    seconds = rng.integers(8 * 3600, 22 * 3600, size=int(counts.sum()))
    line_counts = rng.choice([1, 2, 3], p=[0.45, 0.40, 0.15], size=int(counts.sum()))
    total_lines = int(line_counts.sum())
    product_indices = rng.integers(0, len(products), size=total_lines)
    baseline_qty = 1 + rng.poisson(0.5, size=total_lines)
    promo_extra = 1 + rng.poisson(1.2, size=total_lines)
    prices = np.round(bases[product_indices] * rng.uniform(0.95, 1.05, size=total_lines), 2)
    growth_draws = rng.random(int(counts.sum()))
    events = []
    order_index = line_index = 0
    growth_start = date(2024, 1, 1)
    growth_span = max(1, (lake.END - growth_start).days)
    span = (lake.END - lake.START).days
    for elapsed, (day, count) in enumerate(zip(days, counts)):
        customer_weights = np.ones(len(customers))
        fade = max(0.03, 1 - 0.97 * max(0, elapsed - 89) / max(1, span - 179))
        customer_weights[churn_indices] = fade
        customer_weights /= customer_weights.sum()
        buyers = rng.choice(customers, size=int(count), p=customer_weights)
        day_string = day.isoformat()
        discounts = np.zeros((len(stores), len(products)))
        for promotion in promotions:
            if promotion['start'] <= day_string <= promotion['end']:
                for si, store in enumerate(stores):
                    if promotion['store_ids'] and store not in promotion['store_ids']:
                        continue
                    for pi, product in enumerate(products):
                        if product in promotion['product_ids'] or categories[pi] in promotion['categories']:
                            discounts[si, pi] = max(discounts[si, pi], promotion['discount_pct'])
        # Six positional pairs (first six stores/products) grow gradually into July.
        # This provides observed demand growth for downstream stock projections.
        growth = np.clip((day - growth_start).days / growth_span, 0, 1)
        midnight = datetime.combine(day, time(), tzinfo=timezone.utc)
        for buyer in buyers:
            si = int(store_indices[order_index])
            lines = []
            for offset in range(int(line_counts[order_index])):
                pi = int(product_indices[line_index])
                if offset == 0 and si < min(6, len(products)) and growth_draws[order_index] < 0.28 * growth:
                    pi = si
                discount = float(discounts[si, pi])
                # Reuse the sampled relative price when the growth pair changes a product.
                unit_price = round(float(prices[line_index] * bases[pi] / bases[product_indices[line_index]]), 2)
                lines.append({
                    'product_id': products[pi],
                    'qty': int(baseline_qty[line_index] + (promo_extra[line_index] if discount else 0)),
                    'unit_price': unit_price,
                    'discount_pct': discount,
                })
                line_index += 1
            events.append({
                'order_id': f'ORD-{order_index + 1:09d}',
                'ts': (midnight + timedelta(seconds=int(seconds[order_index]))).isoformat(),
                'store_id': stores[si],
                'customer_id': None if walkins[order_index] else str(buyer),
                'channel': 'store' if walkins[order_index] else str(channels[order_index]),
                'lines': lines,
            })
            order_index += 1
    # Copies form 0.5% of the final event stream and retain the original event IDs.
    duplicate_count = round(len(events) * 0.005 / 0.995)
    duplicates = [deepcopy(events[i]) for i in rng.choice(len(events), size=duplicate_count, replace=False)]
    events.extend(duplicates)
    events.sort(key=lambda order: (order['ts'], order['order_id']))
    return events, churners
