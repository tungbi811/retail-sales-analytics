-- One row per store x product: stock, sell rate, days of cover, stock level and restock cost.
-- The rules come from vars in dbt_project.yml (sell_rate_days, stock_ok_below, stock_good_below).

WITH last_sale AS (
    -- The data is historical, so the window ends at the last sale rather than today
    SELECT
        MAX(sale_datetime) AS sale_datetime
    FROM
        {{ ref('fact_sales') }}
),

recent_sales AS (
    SELECT
        s.store_id,
        s.product_id,
        SUM(s.quantity) AS units
    FROM
        {{ ref('fact_sales') }} s
        CROSS JOIN last_sale l
    WHERE
        s.sale_datetime > l.sale_datetime - MAKE_INTERVAL(days => {{ var('sell_rate_days') }})
    GROUP BY
        s.store_id,
        s.product_id
),

rates AS (
    SELECT
        i.*,
        COALESCE(r.units, 0)::FLOAT8 / {{ var('sell_rate_days') }} AS units_per_day,
        GREATEST(i.safety_stock - i.stock_qty, 0) AS shortfall
    FROM
        {{ ref('fact_inventory') }} i
        LEFT JOIN recent_sales r ON r.store_id = i.store_id AND r.product_id = i.product_id
)

SELECT
    inventory_id,
    store_id,
    product_id,
    last_updated,
    stock_qty,
    safety_stock,
    unit_cost,
    stock_value,
    is_out_of_stock,
    below_safety_stock,
    units_per_day,
    stock_qty / NULLIF(units_per_day, 0) AS days_of_cover,
    CASE
        WHEN stock_qty = 0 THEN 'out'
        WHEN stock_qty < safety_stock THEN 'low'
        WHEN stock_qty < {{ var('stock_ok_below') }} * safety_stock THEN 'ok'
        WHEN stock_qty < {{ var('stock_good_below') }} * safety_stock THEN 'good'
        ELSE 'deep'
    END AS stock_level,
    shortfall,
    shortfall * unit_cost AS restock_cost
FROM
    rates
