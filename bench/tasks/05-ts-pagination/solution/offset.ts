export function pageOffset(page: number, size: number): number {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(size) || size < 1) {
    throw new RangeError("Invalid pagination");
  }
  return (page - 1) * size;
}
