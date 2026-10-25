SELECT
    inventory_id,
    store_id,
    product_id,
    last_updated,
    stock_qty,
    safety_stock,
    unit_cost,
    stock_value,
    -- Flags for the Part 4 stock alert
    stock_qty = 0 AS is_out_of_stock,
    stock_qty < safety_stock AS below_safety_stock
FROM
    {{ ref('stg_inventory') }}
