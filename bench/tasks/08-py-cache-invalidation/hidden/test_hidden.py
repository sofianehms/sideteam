import unittest

from catalog import Catalog


class CatalogTests(unittest.TestCase):
    def test_insert_and_replace_refresh_cached_total(self):
        catalog = Catalog()
        self.assertEqual(catalog.total("fruit"), 0)
        catalog.put("a", "fruit", 3)
        self.assertEqual(catalog.total("fruit"), 3)
        catalog.put("a", "fruit", 9)
        self.assertEqual(catalog.total("fruit"), 9)

    def test_move_and_remove(self):
        catalog = Catalog()
        catalog.put("a", "fruit", 3)
        self.assertEqual(catalog.total("fruit"), 3)
        self.assertEqual(catalog.total("vegetables"), 0)
        catalog.put("a", "vegetables", 4)
        self.assertEqual(catalog.total("fruit"), 0)
        self.assertEqual(catalog.total("vegetables"), 4)
        catalog.remove("a")
        catalog.remove("missing")
        self.assertEqual(catalog.total("vegetables"), 0)
