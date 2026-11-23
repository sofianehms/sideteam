import unittest

from words import word_frequency


class WordFrequencyTests(unittest.TestCase):
    def test_case_and_separators(self):
        self.assertEqual(word_frequency("One,ONE!two2Two caféONE"), {"one": 3, "two": 2, "caf": 1})

    def test_only_separators(self):
        self.assertEqual(word_frequency(" 123 ! é "), {})
