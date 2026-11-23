import { pageOffset } from "./offset.ts";

export function paginate<T>(items: readonly T[], page: number, size: number): T[] {
  const start = pageOffset(page, size);
  return items.slice(start, start + size);
}
