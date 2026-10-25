-- 3. Top 5 sản phẩm (Top 5 products)

WITH product_sales AS (
    SELECT
        p.product_id,
        p.product_name,
        p.category,
        SUM(s.amount) AS revenue,
        SUM(s.quantity) AS quantity,
        RANK() OVER (ORDER BY SUM(s.amount) DESC) AS revenue_rank
    FROM
        {{ ref('fact_sales') }} s
        JOIN {{ ref('dim_product') }} p ON s.product_id = p.product_id
    GROUP BY
        p.product_id, p.product_name, p.category
)

SELECT
    revenue_rank,
    product_id,
    product_name,
    category,
    revenue,
    quantity
FROM
    product_sales
WHERE
    revenue_rank <= 5
ORDER BY
    revenue_rank, product_id
