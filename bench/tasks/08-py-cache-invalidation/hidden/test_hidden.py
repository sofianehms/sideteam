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

    def test_reuses_unaffected_total_across_edits(self):
        additions = []

        class CountedAmount(int):
            def __radd__(self, subtotal):
                additions.append(subtotal)
                return subtotal + int(self)

        catalog = Catalog()
        catalog.put("a", "fruit", 3)
        catalog.put("b", "grains", CountedAmount(7))
        self.assertEqual(catalog.total("grains"), 7)
        initial_additions = len(additions)

        edits = (
            ("repeat read", lambda: None),
            ("insert", lambda: catalog.put("c", "fruit", 2)),
            ("replace", lambda: catalog.put("a", "fruit", 5)),
            ("move", lambda: catalog.put("a", "vegetables", 4)),
            ("remove", lambda: catalog.remove("a")),
            ("remove missing", lambda: catalog.remove("missing")),
        )
        for operation, edit in edits:
            with self.subTest(operation=operation):
                edit()
                self.assertEqual(catalog.total("grains"), 7)
                self.assertEqual(len(additions), initial_additions)
