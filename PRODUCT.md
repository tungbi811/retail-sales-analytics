# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React + Vite (user choice, 2026-10-24). Dashboard lives in `dashboard/`, separate from the Python pipeline.

## Users

Internal team: analysts and ops staff who read the Pantio sales warehouse (dbt gold models) to track sales, stores, products and inventory.

## Product Purpose

A dashboard over the Pantio retail sales pipeline (Airflow → Postgres bronze → dbt silver/gold). Success: a team member opens it and sees how sales, stores and stock are doing without writing SQL.

## Operating Context

- Data comes from the dbt star schema: `fact_sales`, `fact_inventory`, `dim_product`, `dim_store`, `dim_customer`, `dim_date`.
- Source entities: products (name, category), stores (name, region), customers (gender, birth year), sales (date, quantity, amount), inventory (stock qty, safety stock, unit cost, stock value).
- First phase uses mock data shaped like the gold models, so a real API can replace it later.

## Capabilities and Constraints

- Phase 1: Dashboard page only, mock data.
- Later pages (from the reference): Messages, Kanban board, Settings with colour themes. Undecided whether they fit an internal tool.
- Undecided: how the dashboard will read Postgres (API layer not chosen).

## Brand Commitments

- Layout and look follow the reference video `/Users/tung/Downloads/corbel.mp4` (user-binding): pill top nav, left icon rail, KPI card row, gauge score card, striped monthly revenue bars with tooltip, visits-by-time heatmap, soft gradient background, colour themes (Mono, Pastel, Ocean, Sage).
- Default palette: Pastel, the video's pastel theme (user choice, 2026-10-24). Mono, Ocean and Sage stay available.
- Name: Pantio. The "Corbel Supply Co." brand in the video is not ours.

## Evidence on Hand

- No real metrics wired yet. All numbers in phase 1 are mock and must be labelled as sample data.

## Product Principles

1. Every number traces to a gold model column.
2. Scanable in five seconds: KPIs first, detail below.
3. Mock data has the same shape as the real data, so the swap is a data-layer change only.
