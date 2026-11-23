export type Interval = { start: Date; end: Date };

export function bounds(interval: Interval): [number, number] {
  const start = interval.start.getTime();
  const end = interval.end.getTime();
  if (start > end) throw new RangeError("Invalid interval");
  return [start, end];
}
