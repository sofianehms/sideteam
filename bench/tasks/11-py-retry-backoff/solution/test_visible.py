import unittest

from retry import retry


class RetryTests(unittest.TestCase):
    def test_returns_success(self):
        @retry(attempts=2, delay=1, exceptions=(ValueError,), wait=self.fail)
        def add(left, *, right):
            return left + right

        self.assertEqual(add(2, right=3), 5)


    def test_uses_exponential_delays(self):
        waits = []
        results = iter([False, False, True])

        @retry(attempts=3, delay=0.5, exceptions=(ValueError,), wait=waits.append)
        def work():
            if not next(results):
                raise ValueError("try again")
            return "ready"

        self.assertEqual(work(), "ready")
        self.assertEqual(waits, [0.5, 1.0])

    def test_does_not_wait_after_last_failure(self):
        waits = []

        @retry(attempts=2, delay=1, exceptions=(ValueError,), wait=waits.append)
        def work():
            raise ValueError("still failing")

        with self.assertRaisesRegex(ValueError, "still failing"):
            work()
        self.assertEqual(waits, [1])
