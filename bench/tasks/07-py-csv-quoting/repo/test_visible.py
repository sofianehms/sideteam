import unittest

from reader import read_rows


class ReaderTests(unittest.TestCase):
    def test_simple_records(self):
        self.assertEqual(read_rows("a,b\n1,2\n"), [["a", "b"], ["1", "2"]])
