-- One row per product per region, plus region 'All': stock, sell rate, days of cover and stock board lane.
-- The watch threshold comes from the watch_days var in dbt_project.yml.

WITH grouped AS (
    SELECT
        p.product_id,
        CASE WHEN GROUPING(st.region) = 1 THEN 'All' ELSE st.region END AS region,
        SUM(p.stock_qty) AS stock_qty,
        SUM(p.units_per_day) AS units_per_day,
        BOOL_OR(p.below_safety_stock) AS any_short,
        BOOL_OR(p.below_safety_stock AND p.is_out_of_stock) AS any_out
    FROM
        {{ ref('stock_position') }} p
        JOIN {{ ref('dim_store') }} st ON st.store_id = p.store_id
    GROUP BY
        GROUPING SETS ((p.product_id, st.region), (p.product_id))
),

covered AS (
    SELECT
        *,
        stock_qty / NULLIF(units_per_day, 0) AS days_of_cover
    FROM
        grouped
)

SELECT
    product_id,
    region,
    stock_qty,
    units_per_day,
    days_of_cover,
    CASE
        WHEN any_out THEN 'out'
        WHEN any_short THEN 'low'
        WHEN days_of_cover < {{ var('watch_days') }} THEN 'watch'
        ELSE 'ok'
    END AS lane,
    {{ var('watch_days') }} AS watch_days
FROM
    covered
