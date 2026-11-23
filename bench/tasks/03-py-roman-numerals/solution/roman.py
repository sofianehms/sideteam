VALUES = (
    (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"),
    (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
    (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),
)


def to_roman(number):
    if not 1 <= number <= 3999:
        raise ValueError("number must be between 1 and 3999")
    parts = []
    for value, symbol in VALUES:
        count, number = divmod(number, value)
        parts.append(symbol * count)
    return "".join(parts)
