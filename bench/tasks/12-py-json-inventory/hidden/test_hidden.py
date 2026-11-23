import json
import tempfile
import unittest
from pathlib import Path

from inventory import Inventory


class InventoryTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory(dir="."))
        self.path = Path(directory) / "inventory.json"

    def test_load_edit_and_save(self):
        self.path.write_text('{"café": 4, "pen": 1}', encoding="utf-8")
        stock = Inventory(str(self.path))
        self.assertEqual(stock.quantity("café"), 4)
        stock.set_quantity("café", 6)
        stock.set_quantity("pen", 0)
        stock.set_quantity("paper", 3)
        self.assertEqual(Inventory(self.path).quantity("café"), 4)
        stock.save()
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8")), {"café": 6, "paper": 3})

    def test_invalid_file(self):
        for document in ("{", "[]", '{"": 1}', '{"pen": 0}', '{"pen": -1}', '{"pen": true}', '{"pen": 1.5}'):
            with self.subTest(document=document):
                self.path.write_text(document, encoding="utf-8")
                with self.assertRaises(ValueError):
                    Inventory(self.path)

    def test_invalid_update_leaves_existing_quantity(self):
        stock = Inventory(self.path)
        stock.set_quantity("pen", 3)
        for sku, quantity in [("pen", -1), ("pen", True), ("pen", 1.5), ("", 2)]:
            with self.subTest(sku=sku, quantity=quantity), self.assertRaises(ValueError):
                stock.set_quantity(sku, quantity)
        self.assertEqual(stock.quantity("pen"), 3)
