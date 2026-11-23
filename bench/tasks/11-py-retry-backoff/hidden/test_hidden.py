import unittest

from retry import retry


class RetryTests(unittest.TestCase):
    def test_backoff_restarts_for_each_call(self):
        waits = []
        outcomes = iter([False, False, True, False, True])

        @retry(attempts=4, delay=0.25, exceptions=(OSError,), wait=waits.append)
        def work(value, *, scale):
            if not next(outcomes):
                raise OSError("retry")
            return value * scale

        try:
            result = work(3, scale=2)
        except OSError as error:
            self.fail(f"retryable exception escaped: {error}")
        self.assertEqual(result, 6)
        self.assertEqual(work.__name__, "work")
        self.assertEqual(work(5, scale=3), 15)
        self.assertEqual(waits, [0.25, 0.5, 0.25])

    def test_reraises_final_exception(self):
        waits = []
        errors = [ValueError("first"), ValueError("last")]
        failures = iter(errors)

        @retry(attempts=2, delay=0, exceptions=(ValueError,), wait=waits.append)
        def work():
            raise next(failures)

        with self.assertRaises(ValueError) as raised:
            work()
        self.assertIs(raised.exception, errors[-1])
        self.assertEqual(waits, [0])

    def test_other_exception_is_immediate(self):
        @retry(attempts=3, delay=1, exceptions=(ValueError,), wait=self.fail)
        def work():
            raise TypeError("unexpected")

        with self.assertRaises(TypeError):
            work()

    def test_invalid_options(self):
        for attempts, delay in [(0, 1), (1.5, 1), (True, 1), (1, -1), (1, float("inf")), (1, float("nan"))]:
            with self.subTest(attempts=attempts, delay=delay), self.assertRaises(ValueError):
                retry(attempts=attempts, delay=delay, exceptions=(ValueError,), wait=self.fail)
