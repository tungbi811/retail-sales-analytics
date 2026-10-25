---
version: 1
slug: "dashboard-src-app-tsx"
primary_target: "dashboard/src/App.tsx"
related_targets: []
---

# Surface: Dashboard (dashboard/src/App.tsx)

Mode: Operate. Audience: internal analysts and ops staff reading the Pantio sales warehouse. Job: see how sales, stores and stock are doing this month in five seconds. Content: mock data shaped like dbt gold models (fact_sales, fact_inventory, dim_store, dim_product, dim_date), labelled as sample data. Constraint: layout pinned by the user to the reference video (corbel.mp4). The user picked the video's pastel theme as the default ("i like pastel theme in the video", 2026-10-24).

## Direction contract

THESIS: A soft pastel sales desk where one month at a time is lifted out of a hatched year; refuses the grey card grid with coloured accent chips.

OWN-WORLD: Default Pastel: pale blue-to-pink wash ground fading to green at the foot, translucent white cards, KPI fields in blue, green, yellow and coral, dark teal year card, deep-teal active bar and tooltip, red dashed average line. Urbanist throughout, pill nav and pill segmented controls, floating dark icon rail. Mono (black hero card, white and grey cards), Ocean and Sage are alternate palettes; dark theme inverts neutrals.

STORY: The analyst sees revenue, orders, units and stock health, checks this year against last year's total (the reference's "target" score became "% of 2025 revenue", because the warehouse holds no target table), scans the year by month, spots busy hours and category mix, checks stores and low stock.

FIRST VIEWPORT: Brand left, pill nav centre, team avatars right; "Dashboard" H1 with sync-freshness pill; region tabs, period label, Full analytics and Export; four KPI cards; year-to-date gauge card (left) beside the year revenue chart (right).

FORM: brief-pinned reference clone (user-pinned, no direction roll); signature move: hover a month and its hatched bar fills solid with a gradient and a dark tooltip. seed: none (pinned)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
