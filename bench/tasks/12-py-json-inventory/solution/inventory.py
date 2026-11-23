import json
from pathlib import Path


class Inventory:
    def __init__(self, path):
        self._path = Path(path)
        try:
            with self._path.open(encoding="utf-8") as source:
                items = json.load(source)
        except FileNotFoundError:
            items = {}

        if not isinstance(items, dict) or any(
            not sku or type(quantity) is not int or quantity <= 0
            for sku, quantity in items.items()
        ):
            raise ValueError("expected an object mapping SKUs to positive integers")
        self._items = items

    def quantity(self, sku):
        return self._items.get(sku, 0)

    def set_quantity(self, sku, quantity):
        if not isinstance(sku, str) or not sku:
            raise ValueError("sku must be a nonempty string")
        if type(quantity) is not int or quantity < 0:
            raise ValueError("quantity must be a nonnegative integer")
        if quantity == 0:
            self._items.pop(sku, None)
        else:
            self._items[sku] = quantity

    def save(self):
        self._path.write_text(json.dumps(self._items, ensure_ascii=False) + "\n", encoding="utf-8")
