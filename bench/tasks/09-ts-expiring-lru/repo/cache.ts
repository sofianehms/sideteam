export class LruCache<K, V> {
  constructor(capacity: number, ttlMs: number, now: () => number = Date.now) {}

  get(key: K): V | undefined {
    return undefined;
  }

  set(key: K, value: V): void {}
}
