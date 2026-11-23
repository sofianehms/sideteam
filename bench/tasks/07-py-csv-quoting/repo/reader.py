from fields import parse_fields


def read_rows(text):
    return [parse_fields(line) for line in text.splitlines() if line]
