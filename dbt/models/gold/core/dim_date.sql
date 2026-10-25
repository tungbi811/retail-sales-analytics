-- Covers all of 2024: sales run Jan-Jul, inventory last_updated runs Oct-Dec
WITH days AS (
    SELECT
        generate_series('2024-01-01'::DATE, '2024-12-31'::DATE, INTERVAL '1 day')::DATE AS date_day
)

SELECT
    date_day,
    EXTRACT(YEAR FROM date_day)::INT AS year,
    EXTRACT(QUARTER FROM date_day)::INT AS quarter,
    EXTRACT(MONTH FROM date_day)::INT AS month,
    TO_CHAR(date_day, 'FMMonth') AS month_name,
    EXTRACT(DAY FROM date_day)::INT AS day,
    EXTRACT(ISODOW FROM date_day)::INT AS weekday_num,
    TO_CHAR(date_day, 'FMDay') AS weekday_name,
    EXTRACT(ISODOW FROM date_day) IN (6, 7) AS is_weekend
FROM
    days
