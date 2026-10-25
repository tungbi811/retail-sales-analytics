-- One row per store: its stock, sell rate and days of cover, for the Stores page.

SELECT
    store_id,
    SUM(stock_qty) AS stock_qty,
    SUM(units_per_day) AS units_per_day,
    SUM(stock_qty) / NULLIF(SUM(units_per_day), 0) AS days_of_cover
FROM
    {{ ref('stock_position') }}
GROUP BY
    store_id
