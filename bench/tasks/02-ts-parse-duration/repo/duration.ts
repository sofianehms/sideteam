const seconds = { h: 3600, m: 60, s: 1 };

export function parseDuration(input: string): number {
  const match = /^(\d+)([hms])/.exec(input);
  if (!match) throw new RangeError("Invalid duration");
  return Number(match[1]) * seconds[match[2] as keyof typeof seconds];
}
