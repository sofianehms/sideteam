import unittest

from reader import read_rows


class ReaderTests(unittest.TestCase):
    def test_quotes_and_empty_fields(self):
        self.assertEqual(read_rows('a,"b,c","say ""hi""",\n\n""'), [
            ["a", "b,c", 'say "hi"', ""], [""],
        ])

    def test_multiline_and_whitespace(self):
        self.assertEqual(read_rows('  a  ,"line 1\r\nline 2"\r\nx,y'), [
            ["  a  ", "line 1\r\nline 2"], ["x", "y"],
        ])
