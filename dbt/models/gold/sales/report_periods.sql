-- The windows the dashboard reports on and what each is compared with: every calendar month, plus MTD, 90D and YTD.
-- "Now" is one second after the last sale, since the data is historical. A window in progress is compared with the
-- same span of the window before, and never past that window's end.

WITH bounds AS (
    SELECT
        MAX(sale_datetime) + INTERVAL '1 second' AS now_at,
        DATE_TRUNC('year', MIN(sale_datetime)) AS first_year
    FROM
        {{ ref('fact_sales') }}
),

months AS (
    SELECT
        TO_CHAR(m, 'YYYY-MM') AS period,
        'month' AS kind,
        m AS from_at,
        LEAST(m + INTERVAL '1 month', b.now_at) AS to_at,
        m - INTERVAL '1 month' AS prev_from_at,
        CASE
            WHEN b.now_at < m + INTERVAL '1 month' THEN LEAST(m, m - INTERVAL '1 month' + (b.now_at - m))
            ELSE m
        END AS prev_to_at,
        b.now_at < m + INTERVAL '1 month' AS is_current
    FROM
        bounds b
        CROSS JOIN GENERATE_SERIES(b.first_year, DATE_TRUNC('month', b.now_at), INTERVAL '1 month') AS m
),

periods AS (
    SELECT
        'MTD' AS period,
        'period' AS kind,
        from_at,
        to_at,
        prev_from_at,
        prev_to_at,
        TRUE AS is_current
    FROM
        months
    WHERE
        is_current

    UNION ALL

    SELECT
        '90D',
        'period',
        now_at - INTERVAL '90 days',
        now_at,
        now_at - INTERVAL '180 days',
        now_at - INTERVAL '90 days',
        TRUE
    FROM
        bounds

    UNION ALL

    SELECT
        'YTD',
        'period',
        DATE_TRUNC('year', now_at),
        now_at,
        DATE_TRUNC('year', now_at) - INTERVAL '1 year',
        -- The same month and day last year; day overflow rolls into the next month, as in the dashboard
        DATE_TRUNC('year', now_at) - INTERVAL '1 year'
            + MAKE_INTERVAL(months => EXTRACT(MONTH FROM now_at)::INT - 1)
            + (now_at - DATE_TRUNC('month', now_at)),
        TRUE
    FROM
        bounds
)

SELECT * FROM months
UNION ALL
SELECT * FROM periods
