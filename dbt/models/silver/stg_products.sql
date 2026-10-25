SELECT
    product_id::int AS product_id,
    product_name,
    category
FROM
    {{ source('bronze', 'products') }}