from collections import Counter


def word_frequency(text):
    return dict(Counter(text.split()))
