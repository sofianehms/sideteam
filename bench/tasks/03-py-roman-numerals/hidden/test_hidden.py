import unittest

from roman import to_roman


class RomanTests(unittest.TestCase):
    def test_subtractive_numbers(self):
        for number, expected in [(4, "IV"), (9, "IX"), (944, "CMXLIV"), (3999, "MMMCMXCIX"), (444, "CDXLIV")]:
            with self.subTest(number=number):
                self.assertEqual(to_roman(number), expected)

    def test_out_of_range(self):
        for number in (0, 4000):
            with self.subTest(number=number), self.assertRaises(ValueError):
                to_roman(number)
