"""Generate customer sessions and linked service experiences from sales."""

from datetime import date, datetime, timedelta

import pandas as pd

from ingestion import lake


def make_engagement(ref, orders, deliveries, churners, rng) -> tuple[list[dict], list[dict]]:
    # A late store replenishment provides a plausible service issue for linked
    # customer orders at that store, without inventing order shipment fields.
    late_windows = {}
    for delivery in deliveries.to_dict('records'):
        promised = date.fromisoformat(delivery['promised_date'])
        received = delivery['delivered_date'] if pd.notna(delivery['delivered_date']) else None
        if (received is not None and received > delivery['promised_date']) or (received is None and promised < lake.END):
            end = date.fromisoformat(received) if received else lake.END
            late_windows.setdefault(delivery['store_id'], []).append((promised, end + timedelta(days=7)))
    events, tickets, seen = [], [], set()
    customer_ids = set(ref.customers.customer_id)
    for order in orders:
        if order['order_id'] in seen:
            continue
        seen.add(order['order_id'])
        customer = order['customer_id']
        if customer not in customer_ids:
            continue
        timestamp = datetime.fromisoformat(order['ts'])
        day = timestamp.date()
        churner = customer in churners
        elapsed = (day - lake.START).days / max(1, (lake.END - lake.START).days)
        activity = 0.35 * (1 - 0.8 * elapsed if churner else 1)
        if rng.random() < activity:
            session = f'SESSION-{order["order_id"]}'
            types = ['visit', 'view']
            if rng.random() < 0.15:
                types.append('login')
            if rng.random() < 0.50:
                types.append('cart')
                if rng.random() < 0.70:
                    types.append('checkout')
            for step, kind in enumerate(types):
                events.append({
                    'event_id': f'WEB-{len(events) + 1:09d}',
                    'ts': (timestamp - timedelta(minutes=10 - step)).isoformat(),
                    'customer_id': customer, 'session_id': session, 'type': kind,
                    'product_id': order['lines'][0]['product_id'] if kind in {'view', 'cart', 'checkout'} else None,
                })
        if rng.random() < (0.15 if churner else 0.025):
            late = any(start <= day <= end for start, end in late_windows.get(order['store_id'], []))
            category = ('late_delivery' if late and rng.random() < (0.85 if churner else 0.15)
                        else str(rng.choice(['product_quality', 'service', 'general'])))
            kind = 'review' if rng.random() < 0.45 else 'ticket'
            opened = timestamp + timedelta(minutes=30)
            close = opened + timedelta(days=int(rng.integers(1, 8)))
            rating = int(rng.choice([1, 2, 3], p=[0.45, 0.40, 0.15]) if churner
                         else rng.choice([3, 4, 5], p=[0.10, 0.35, 0.55]))
            tickets.append({
                'ticket_id': f'TICKET-{len(tickets) + 1:07d}', 'kind': kind,
                'customer_id': customer, 'store_id': order['store_id'], 'order_id': order['order_id'],
                'category': category, 'rating': rating if kind == 'review' or rng.random() < 0.75 else None,
                # This source intentionally retains an upstream format inconsistency.
                'opened_at': opened.strftime('%Y/%m/%d %H:%M:%S') if len(tickets) % 3 == 0 else opened.isoformat(),
                'closed_at': close.isoformat() if close.date() <= lake.END and rng.random() < 0.85 else None,
            })
    events.sort(key=lambda event: (event['ts'], event['event_id']))
    return events, tickets
