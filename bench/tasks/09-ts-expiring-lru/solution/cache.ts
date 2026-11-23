export class LruCache<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();
  private readonly capacity: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(capacity: number, ttlMs: number, now: () => number = Date.now) {
    if (!Number.isInteger(capacity) || capacity < 1 || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new RangeError("Invalid cache capacity or TTL");
    }
    this.capacity = capacity;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expiresAt <= this.now()) return undefined;
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    const now = this.now();
    this.entries.delete(key);
    if (this.entries.size >= this.capacity) {
      for (const [key, entry] of this.entries) {
        if (entry.expiresAt <= now) this.entries.delete(key);
      }
      if (this.entries.size >= this.capacity) {
        const oldest = this.entries.keys().next();
        if (!oldest.done) this.entries.delete(oldest.value);
      }
    }
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
  }
}
