from totals import Totals


class Catalog:
    def __init__(self):
        self._entries = {}
        self._totals = Totals()

    def put(self, key, category, amount):
        self._entries[key] = (category, amount)

    def remove(self, key):
        self._entries.pop(key, None)

    def total(self, category):
        return self._totals.get(category, self._entries.values())
