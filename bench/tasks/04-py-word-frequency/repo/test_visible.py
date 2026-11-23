import unittest

from words import word_frequency


class WordFrequencyTests(unittest.TestCase):
    def test_repeated_words(self):
        self.assertEqual(word_frequency("red blue red"), {"red": 2, "blue": 1})
