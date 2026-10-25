SELECT
    customer_id,
    customer_name,
    gender,
    birth_year,
    age_group
FROM
    {{ ref('stg_customers') }}
