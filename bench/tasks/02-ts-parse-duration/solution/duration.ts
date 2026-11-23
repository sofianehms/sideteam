const seconds = { h: 3600, m: 60, s: 1 };

export function parseDuration(input: string): number {
  const segments = /(\d+)([hms])/gy;
  const seen = new Set<string>();
  let offset = 0;
  let total = 0;
  while (offset < input.length) {
    const match = segments.exec(input);
    if (!match || seen.has(match[2])) throw new RangeError("Invalid duration");
    seen.add(match[2]);
    total += Number(match[1]) * seconds[match[2] as keyof typeof seconds];
    offset = segments.lastIndex;
  }
  if (seen.size === 0 || !Number.isSafeInteger(total)) throw new RangeError("Invalid duration");
  return total;
}
