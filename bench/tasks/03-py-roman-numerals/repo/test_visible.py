import unittest

from roman import to_roman


class RomanTests(unittest.TestCase):
    def test_additive_number(self):
        self.assertEqual(to_roman(388), "CCCLXXXVIII")
