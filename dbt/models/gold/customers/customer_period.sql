-- One row per customer who ordered in a page period (current window) or in the window it is compared with
-- (previous window), per region and for 'All': spend, favourites, whether they are returning, and spend tier.

WITH windows AS (
    SELECT period, 'current' AS time_window, from_at, to_at FROM {{ ref('report_periods') }} WHERE kind = 'period'
    UNION ALL
    SELECT period, 'previous', prev_from_at, prev_to_at FROM {{ ref('report_periods') }} WHERE kind = 'period'
),

regions AS (
    SELECT DISTINCT region FROM {{ ref('dim_store') }}
    UNION ALL
    SELECT 'All'
),

sales AS (
    SELECT
        s.customer_id,
        s.store_id,
        s.sale_datetime,
        s.amount,
        s.quantity,
        st.region,
        p.category
    FROM
        {{ ref('fact_sales') }} s
        JOIN {{ ref('dim_store') }} st ON st.store_id = s.store_id
        JOIN {{ ref('dim_product') }} p ON p.product_id = s.product_id
),

in_window AS (
    SELECT
        w.period,
        w.time_window,
        r.region,
        w.from_at,
        s.customer_id,
        s.store_id,
        s.sale_datetime,
        s.amount,
        s.quantity,
        s.category
    FROM
        windows w
        CROSS JOIN regions r
        JOIN sales s ON (r.region = 'All' OR s.region = r.region)
            AND s.sale_datetime >= w.from_at
            AND s.sale_datetime < w.to_at
),

customers AS (
    SELECT
        period,
        time_window,
        region,
        customer_id,
        MIN(from_at) AS from_at,
        SUM(amount) AS revenue,
        COUNT(*) AS orders,
        SUM(quantity) AS units,
        MAX(sale_datetime) AS last_order_at
    FROM
        in_window
    GROUP BY
        period,
        time_window,
        region,
        customer_id
),

-- The category with the most revenue; a tie goes to the one bought first
favourite AS (
    SELECT DISTINCT ON (period, time_window, region, customer_id)
        period,
        time_window,
        region,
        customer_id,
        category AS favourite_category
    FROM (
        SELECT period, time_window, region, customer_id, category, SUM(amount) AS revenue, MIN(sale_datetime) AS first_at
        FROM in_window
        GROUP BY period, time_window, region, customer_id, category
    ) c
    ORDER BY period, time_window, region, customer_id, revenue DESC, first_at
),

-- The store with the most orders; a tie goes to the one visited first
home AS (
    SELECT DISTINCT ON (period, time_window, region, customer_id)
        period,
        time_window,
        region,
        customer_id,
        store_id AS home_store_id
    FROM (
        SELECT period, time_window, region, customer_id, store_id, COUNT(*) AS orders, MIN(sale_datetime) AS first_at
        FROM in_window
        GROUP BY period, time_window, region, customer_id, store_id
    ) s
    ORDER BY period, time_window, region, customer_id, orders DESC, first_at
),

ranked AS (
    SELECT
        c.*,
        f.favourite_category,
        h.home_store_id,
        -- An order in the same region (or anywhere, for 'All') before the window began
        EXISTS (
            SELECT 1
            FROM sales s
            WHERE s.customer_id = c.customer_id
                AND (c.region = 'All' OR s.region = c.region)
                AND s.sale_datetime < c.from_at
        ) AS is_returning,
        ROW_NUMBER() OVER w AS revenue_rank,
        COUNT(*) OVER (PARTITION BY c.period, c.time_window, c.region) AS active
    FROM
        customers c
        JOIN favourite f USING (period, time_window, region, customer_id)
        JOIN home h USING (period, time_window, region, customer_id)
    WINDOW w AS (PARTITION BY c.period, c.time_window, c.region ORDER BY c.revenue DESC, c.customer_id::TEXT)
),

tiered AS (
    SELECT
        *,
        -- The top 10% (at least one customer), then up to half of customers
        GREATEST(1, ROUND(active * 0.1)) AS top_size,
        GREATEST(GREATEST(1, ROUND(active * 0.1)), ROUND(active * 0.5)) AS half_size
    FROM
        ranked
)

SELECT
    period,
    time_window,
    region,
    customer_id,
    revenue,
    orders,
    units,
    last_order_at,
    favourite_category,
    home_store_id,
    is_returning,
    revenue_rank,
    CASE
        WHEN revenue_rank <= top_size THEN 'top'
        WHEN revenue_rank <= half_size THEN 'next'
        ELSE 'rest'
    END AS spend_tier
FROM
    tiered
