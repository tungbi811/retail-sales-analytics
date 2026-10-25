-- The stock rule settings from dbt_project.yml as one row, so the dashboard names the thresholds it was built with.

SELECT
    {{ var('sell_rate_days') }} AS sell_rate_days,
    {{ var('watch_days') }} AS watch_days,
    {{ var('stock_ok_below') }} AS stock_ok_below,
    {{ var('stock_good_below') }} AS stock_good_below
