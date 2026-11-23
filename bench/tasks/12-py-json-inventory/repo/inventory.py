class Inventory:
    def __init__(self, path):
        self._path = path
        self._items = {}

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
        pass
