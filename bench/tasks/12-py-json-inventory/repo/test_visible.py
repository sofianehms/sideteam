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
