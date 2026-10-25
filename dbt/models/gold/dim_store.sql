SELECT
    store_id,
    store_name,
    region,
    address,
    city,
    latitude,
    longitude
FROM
    {{ ref('stg_stores') }}
