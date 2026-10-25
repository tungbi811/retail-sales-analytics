"""Read the authoritative IDs and dimensions without modifying the workbook."""

from dataclasses import dataclass
from pathlib import Path

import pandas as pd


@dataclass
class Reference:
    products: pd.DataFrame
    stores: pd.DataFrame
    customers: pd.DataFrame


def load_reference(xlsx: Path) -> Reference:
    columns = {
        'Products': {'ProductID': 'product_id', 'ProductName': 'product_name', 'Category': 'category'},
        'Stores': {'StoreID': 'store_id', 'StoreName': 'store_name', 'Region': 'region', 'City': 'city'},
        'Customers': {'CustomerID': 'customer_id', 'Gender': 'gender', 'BirthYear': 'birth_year'},
    }
    frames = []
    with pd.ExcelFile(xlsx) as workbook:
        for sheet, mapping in columns.items():
            frame = pd.read_excel(workbook, sheet, usecols=list(mapping)).rename(columns=mapping)
            frame = frame[list(mapping.values())].copy()
            frame[next(iter(mapping.values()))] = frame[next(iter(mapping.values()))].astype(str)
            frames.append(frame)
    return Reference(*frames)
