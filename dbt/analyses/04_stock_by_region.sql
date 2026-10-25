-- 4. Tồn kho theo Miền (Stock by region)

SELECT
    st.region,
    COUNT(DISTINCT st.store_id) AS stores,
    SUM(i.stock_qty) AS stock_qty,
    SUM(i.stock_value) AS stock_value
FROM
    {{ ref('fact_inventory') }} i
    JOIN {{ ref('dim_store') }} st ON i.store_id = st.store_id
GROUP BY
    ROLLUP (st.region)
ORDER BY
    st.region
