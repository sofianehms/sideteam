from functools import wraps
from math import isfinite
from time import sleep


def retry(*, attempts, delay, exceptions, wait=sleep):
    if type(attempts) is not int or attempts < 1:
        raise ValueError("attempts must be a positive integer")
    if not isinstance(delay, (int, float)) or delay < 0 or (
        isinstance(delay, float) and not isfinite(delay)
    ):
        raise ValueError("delay must be finite and nonnegative")

    def decorate(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            next_delay = delay
            for _ in range(attempts - 1):
                try:
                    return function(*args, **kwargs)
                except exceptions:
                    wait(next_delay)
                    next_delay *= 2
            return function(*args, **kwargs)

        return wrapped

    return decorate
