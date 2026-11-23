import unittest

from retry import retry


class RetryTests(unittest.TestCase):
    def test_returns_success(self):
        @retry(attempts=2, delay=1, exceptions=(ValueError,), wait=self.fail)
        def add(left, *, right):
            return left + right

        self.assertEqual(add(2, right=3), 5)
