from totals import Totals


class Catalog:
    def __init__(self):
        self._entries = {}
        self._totals = Totals()

    def put(self, key, category, amount):
        previous = self._entries.get(key)
        self._entries[key] = (category, amount)
        self._totals.invalidate(category)
        if previous is not None and previous[0] != category:
            self._totals.invalidate(previous[0])

    def remove(self, key):
        previous = self._entries.pop(key, None)
        if previous is not None:
            self._totals.invalidate(previous[0])

    def total(self, category):
        return self._totals.get(category, self._entries.values())
