from io import StringIO

from fields import parse_fields


def read_rows(text):
    return [row for row in parse_fields(StringIO(text, newline="")) if row]
