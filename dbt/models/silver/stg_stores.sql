SELECT
    store_id::INT AS store_id,
    store_name,
    region,
    address,
    city,
    latitude::NUMERIC(9, 6) AS latitude,
    longitude::NUMERIC(9, 6) AS longitude
FROM
    {{ source('bronze', 'stores') }}