SELECT
    inventory_id::INT AS inventory_id,
    store_id::INT AS store_id,
    product_id::INT AS product_id,
    stock_qty::INT AS stock_qty,
    safety_stock::INT AS safety_stock,
    unit_cost::INT AS unit_cost,
    -- Recomputed instead of trusting the value cached from the Excel formula
    stock_qty::INT * unit_cost::INT AS stock_value,
    last_updated::DATE AS last_updated
FROM
    {{ source('bronze', 'inventory') }}
