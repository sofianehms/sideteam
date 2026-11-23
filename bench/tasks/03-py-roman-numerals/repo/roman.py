VALUES = (
    (1000, "M"), (500, "D"), (100, "C"), (50, "L"),
    (10, "X"), (5, "V"), (1, "I"),
)


def to_roman(number):
    if not 1 <= number <= 3999:
        raise ValueError("number must be between 1 and 3999")
    parts = []
    for value, symbol in VALUES:
        count, number = divmod(number, value)
        parts.append(symbol * count)
    return "".join(parts)
