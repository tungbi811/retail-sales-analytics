"""Rebuild the deterministic six-source synthetic data lake."""

import json
import shutil
from pathlib import Path

import numpy as np

from ingestion import lake
from ingestion.lake.catalog import write_catalog
from ingestion.lake.engagement import make_engagement
from ingestion.lake.orders import make_orders
from ingestion.lake.promotions import make_promotions
from ingestion.lake.reference import load_reference
from ingestion.lake.stock import make_stock


def main(out: Path = Path('lake'), xlsx: Path = Path('data/business_sale_test.xlsx')) -> None:
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    ref = load_reference(xlsx)
    rng = np.random.default_rng(lake.SEED)
    promotions = make_promotions(ref, rng)
    orders, churners = make_orders(ref, promotions, rng)
    snapshots, deliveries = make_stock(ref, orders, rng)
    events, tickets = make_engagement(ref, orders, deliveries, churners, rng)
    lake.write_jsonl_by_day(orders, out, 'orders')
    lake.write_jsonl_by_day(events, out, 'web_events')
    for month, frame in snapshots.groupby(snapshots.snapshot_date.map(lambda day: day.strftime('%Y-%m'))):
        directory = out / 'stock_snapshots' / f'month={month}'
        directory.mkdir(parents=True)
        frame.to_parquet(directory / 'part-0.parquet', index=False)
    directory = out / 'supplier_deliveries'
    directory.mkdir()
    deliveries.to_csv(directory / 'deliveries.csv', index=False, lineterminator='\n')
    for source, filename, rows in [('promotions', 'promotions.json', promotions),
                                   ('support_tickets', 'tickets.json', tickets)]:
        directory = out / source
        directory.mkdir()
        (directory / filename).write_text(json.dumps(rows, ensure_ascii=False) + '\n', encoding='utf-8')
    write_catalog(out, {
        'orders': {
            'path': 'orders/dt=*/part-0.jsonl', 'format': 'jsonl', 'grain': 'order event, with nested order lines',
            'columns': {'order_id': 'Order ID; deduplicate before aggregating', 'ts': 'Order timestamp with UTC offset',
                        'store_id': 'Workbook store ID', 'customer_id': 'Workbook customer ID; null for walk-ins',
                        'channel': 'store, web or app', 'lines': 'List of product_id, qty, unit_price and fractional discount_pct'},
            'notes': 'Synthetic orders, about 300/day; 0.5% exact duplicate events. IDs are strings in the raw source. '
                     'Order-day partitions and stock demand use UTC calendar dates; set the query session timezone to UTC before casting ts to DATE.'},
        'web_events': {
            'path': 'web_events/dt=*/part-0.jsonl', 'format': 'jsonl', 'grain': 'customer session event',
            'columns': {'event_id': 'Unique event ID', 'ts': 'Event timestamp with UTC offset',
                        'customer_id': 'Workbook customer ID', 'session_id': 'Session ID',
                        'type': 'visit, view, cart, checkout or login', 'product_id': 'Workbook product ID or null'},
            'notes': 'Synthetic sessions follow recognized buyers; fading customers have less recent activity.'},
        'stock_snapshots': {
            'path': 'stock_snapshots/month=*/part-0.parquet', 'format': 'parquet', 'grain': 'end of day, store and product',
            'columns': {'snapshot_date': 'Inventory date', 'store_id': 'Workbook store ID',
                        'product_id': 'Workbook product ID', 'on_hand': 'Nonnegative units after receipts and sales',
                        'safety_stock': 'Desired buffer in units'},
            'notes': 'Demand uses deduplicated orders. Six growing pairs have limited supplier allocations and low forward cover.'},
        'supplier_deliveries': {
            'path': 'supplier_deliveries/deliveries.csv', 'format': 'csv', 'grain': 'supplier replenishment shipment',
            'columns': {'delivery_id': 'Unique shipment ID', 'supplier': 'Supplier name', 'store_id': 'Workbook store ID',
                        'product_id': 'Workbook product ID', 'ordered_date': 'Reorder date', 'promised_date': 'Supplier promised arrival date',
                        'delivered_date': 'Actual receipt date; blank if still in transit at the observation end', 'qty': 'Shipment units'},
            'notes': 'ISO dates. Some receipts are late. A blank delivered_date means a known open shipment still in transit at the observation end, '
                     'not missing historical receipt data. Use promised_date to schedule inbound; an overdue open shipment remains uncertain. '
                     'Future promised receipts are inbound, not historical stock. Forward cover uses only known shipments and assumes no unplaced future reorders.'},
        'promotions': {
            'path': 'promotions/promotions.json', 'format': 'json', 'grain': 'promotion campaign',
            'columns': {'promotion_id': 'Unique campaign ID', 'name': 'Campaign name', 'product_ids': 'Target product IDs',
                        'categories': 'Target product categories', 'store_ids': 'Target stores; empty means all stores',
                        'start': 'Inclusive ISO start date', 'end': 'Inclusive ISO end date', 'discount_pct': 'Fractional discount, e.g. 0.15'},
            'notes': 'Product OR category matching; overlapping campaigns take the maximum discount without stacking.'},
        'support_tickets': {
            'path': 'support_tickets/tickets.json', 'format': 'json', 'grain': 'customer support ticket or review',
            'columns': {'ticket_id': 'Unique experience ID', 'kind': 'ticket or review', 'customer_id': 'Workbook customer ID',
                        'store_id': 'Workbook store ID', 'order_id': 'Related order ID or null', 'category': 'Issue category',
                        'rating': 'Integer 1–5 or null', 'opened_at': 'Opened timestamp; mixed ISO and YYYY/MM/DD HH:MM:SS',
                        'closed_at': 'Closed ISO timestamp or null'},
            'notes': 'Synthetic fading customers have poorer ratings and more late-delivery complaints; normalize mixed opened_at formats.'},
    })


if __name__ == '__main__':
    main()
