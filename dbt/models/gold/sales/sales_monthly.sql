-- One row per month per region, plus region 'All': the Dashboard's KPI numbers, compared like for like with the month
-- before using the windows in report_periods.

WITH months AS (
    SELECT
        *
    FROM
        {{ ref('report_periods') }}
    WHERE
        kind = 'month'
),

regions AS (
    SELECT DISTINCT region FROM {{ ref('dim_store') }}
    UNION ALL
    SELECT 'All'
),

sales AS (
    SELECT
        s.sale_datetime,
        s.amount,
        s.quantity,
        st.region
    FROM
        {{ ref('fact_sales') }} s
        JOIN {{ ref('dim_store') }} st ON st.store_id = s.store_id
),

totals AS (
    SELECT
        m.period AS month,
        r.region,
        m.is_current,
        COALESCE(SUM(s.amount) FILTER (WHERE s.sale_datetime >= m.from_at AND s.sale_datetime < m.to_at), 0) AS revenue,
        COUNT(s.sale_datetime) FILTER (WHERE s.sale_datetime >= m.from_at AND s.sale_datetime < m.to_at) AS orders,
        COALESCE(SUM(s.quantity) FILTER (WHERE s.sale_datetime >= m.from_at AND s.sale_datetime < m.to_at), 0) AS units,
        -- The same span of the month before
        COALESCE(SUM(s.amount) FILTER (WHERE s.sale_datetime >= m.prev_from_at AND s.sale_datetime < m.prev_to_at), 0) AS comparable_revenue,
        COUNT(s.sale_datetime) FILTER (WHERE s.sale_datetime >= m.prev_from_at AND s.sale_datetime < m.prev_to_at) AS comparable_orders,
        COALESCE(SUM(s.quantity) FILTER (WHERE s.sale_datetime >= m.prev_from_at AND s.sale_datetime < m.prev_to_at), 0) AS comparable_units,
        -- The whole month before
        COUNT(s.sale_datetime) FILTER (WHERE s.sale_datetime >= m.prev_from_at AND s.sale_datetime < m.from_at) AS prev_month_orders,
        COALESCE(SUM(s.quantity) FILTER (WHERE s.sale_datetime >= m.prev_from_at AND s.sale_datetime < m.from_at), 0) AS prev_month_units
    FROM
        months m
        CROSS JOIN regions r
        LEFT JOIN sales s ON (r.region = 'All' OR s.region = r.region)
            AND s.sale_datetime >= m.prev_from_at
            AND s.sale_datetime < m.to_at
    GROUP BY
        m.period,
        r.region,
        m.is_current
),

averaged AS (
    SELECT
        *,
        COALESCE(revenue::FLOAT8 / NULLIF(orders, 0), 0) AS avg_order,
        COALESCE(comparable_revenue::FLOAT8 / NULLIF(comparable_orders, 0), 0) AS comparable_avg_order,
        prev_month_orders > 0 AS has_previous
    FROM
        totals
)

SELECT
    month,
    region,
    is_current,
    revenue,
    orders,
    units,
    avg_order,
    comparable_revenue,
    comparable_orders,
    comparable_units,
    comparable_avg_order,
    prev_month_orders,
    prev_month_units,
    has_previous,
    -- Percent change against the comparable span: null in the first month, 0 when the span was empty
    CASE WHEN has_previous THEN COALESCE((revenue - comparable_revenue)::FLOAT8 / NULLIF(comparable_revenue, 0) * 100, 0) END AS revenue_change_pct,
    CASE WHEN has_previous THEN COALESCE((orders - comparable_orders)::FLOAT8 / NULLIF(comparable_orders, 0) * 100, 0) END AS orders_change_pct,
    CASE WHEN has_previous THEN COALESCE((units - comparable_units)::FLOAT8 / NULLIF(comparable_units, 0) * 100, 0) END AS units_change_pct,
    CASE WHEN has_previous THEN COALESCE((avg_order - comparable_avg_order) / NULLIF(comparable_avg_order, 0) * 100, 0) END AS avg_order_change_pct,
    CASE WHEN has_previous THEN units::FLOAT8 / NULLIF(prev_month_units, 0) END AS units_of_prev_month
FROM
    averaged
