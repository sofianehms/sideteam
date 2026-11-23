class Totals:
    def __init__(self):
        self._cache = {}

    def get(self, category, entries):
        if category not in self._cache:
            self._cache[category] = sum(
                amount for entry_category, amount in entries if entry_category == category
            )
        return self._cache[category]

    def invalidate(self, category):
        self._cache.pop(category, None)
