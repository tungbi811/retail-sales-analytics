SELECT
    sale_id::INT AS sale_id,
    date::TIMESTAMP AS sale_datetime,
    date::DATE AS sale_date,
    product_id::INT AS product_id,
    store_id::INT AS store_id,
    customer_id::INT AS customer_id,
    quantity::INT AS quantity,
    amount::INT AS amount
FROM
    {{ source('bronze', 'sales') }}
