from functools import wraps
from time import sleep


def retry(*, attempts, delay, exceptions, wait=sleep):
    def decorate(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            return function(*args, **kwargs)

        return wrapped

    return decorate
