SELECT
    sale_id,
    sale_datetime,
    sale_date,
    product_id,
    store_id,
    customer_id,
    quantity,
    amount
FROM
    {{ ref('stg_sales') }}
