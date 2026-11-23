import tempfile
import unittest
from pathlib import Path

from inventory import Inventory


class InventoryTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory(dir="."))
        self.path = Path(directory) / "inventory.json"

    def test_new_inventory(self):
        stock = Inventory(self.path)
        self.assertEqual(stock.quantity("book"), 0)
        stock.set_quantity("book", 2)
        self.assertEqual(stock.quantity("book"), 2)

    def test_round_trip(self):
        stock = Inventory(self.path)
        stock.set_quantity("book", 2)
        self.assertFalse(self.path.exists())

        stock.save()

        self.assertEqual(Inventory(self.path).quantity("book"), 2)

    def test_surrogate_sku_round_trips_with_existing_stock(self):
        self.path.write_text('{"book": 2}', encoding="utf-8")
        sku = "item\ud800"
        stock = Inventory(self.path)
        stock.set_quantity(sku, 3)
        stock.save()

        reopened = Inventory(self.path)
        self.assertEqual(reopened.quantity("book"), 2)
        self.assertEqual(reopened.quantity(sku), 3)

        reopened.set_quantity("book", 4)
        reopened.save()
        saved = Inventory(self.path)
        self.assertEqual(saved.quantity("book"), 4)
        self.assertEqual(saved.quantity(sku), 3)

    def test_removal_persists(self):
        self.path.write_text('{"book": 2}', encoding="utf-8")
        stock = Inventory(self.path)
        stock.set_quantity("book", 0)
        stock.save()
        self.assertEqual(Inventory(self.path).quantity("book"), 0)
        self.assertEqual(self.path.read_text(encoding="utf-8").strip(), "{}")
