import { bounds, type Interval } from "./interval.ts";

export function overlaps(left: Interval, right: Interval): boolean {
  const [leftStart, leftEnd] = bounds(left);
  const [rightStart, rightEnd] = bounds(right);
  return Math.max(leftStart, rightStart) < Math.min(leftEnd, rightEnd);
}
