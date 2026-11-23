import unittest

from catalog import Catalog


class CatalogTests(unittest.TestCase):
    def test_initial_total(self):
        catalog = Catalog()
        catalog.put("a", "fruit", 3)
        catalog.put("b", "fruit", 2)
        self.assertEqual(catalog.total("fruit"), 5)
