SELECT
    customer_id::INT AS customer_id,
    customer_name,
    gender,
    birth_year::INT AS birth_year,
    CASE
        WHEN {{ var('reference_year') }} - birth_year::INT BETWEEN 20 AND 24 THEN '20-24'
        WHEN {{ var('reference_year') }} - birth_year::INT BETWEEN 25 AND 29 THEN '25-29'
        WHEN {{ var('reference_year') }} - birth_year::INT BETWEEN 30 AND 34 THEN '30-34'
        WHEN {{ var('reference_year') }} - birth_year::INT BETWEEN 35 AND 39 THEN '35-39'
        ELSE 'Other'
    END AS age_group
FROM
    {{ source('bronze', 'customers') }}
