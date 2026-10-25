-- 5. Tỷ lệ tồn kho (Stock ratio)

SELECT
    st.region,
    SUM(i.stock_qty) AS stock_qty,
    SUM(i.safety_stock) AS safety_stock,
    ROUND(SUM(i.stock_qty)::NUMERIC / NULLIF(SUM(i.safety_stock), 0), 2) AS coverage_ratio,
    ROUND(100.0 * AVG(i.is_out_of_stock::INT), 1) AS out_of_stock_pct,
    ROUND(100.0 * AVG(i.below_safety_stock::INT), 1) AS below_safety_pct
FROM
    {{ ref('fact_inventory') }} i
    JOIN {{ ref('dim_store') }} st ON i.store_id = st.store_id
GROUP BY
    ROLLUP (st.region)
ORDER BY
    st.region
