-- 1. Doanh thu (Revenue)

SELECT
    d.year,
    d.month,
    d.month_name,
    SUM(s.amount) AS revenue
FROM
    {{ ref('fact_sales') }} s
    JOIN {{ ref('dim_date') }} d ON s.sale_date = d.date_day
GROUP BY
    ROLLUP ((d.year, d.month, d.month_name))
ORDER BY
    d.year, d.month
 