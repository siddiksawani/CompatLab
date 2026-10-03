export class MetadataBusy extends Error {}

export class MetadataCache {
  private readonly values = new Map<string, { value: unknown; bytes: number; expires: number }>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private bytes = 0;

  constructor(private readonly clock = Date.now) {}

  async get<T>(key: string, load: () => Promise<T>, ttlMs = 60_000): Promise<T> {
    const cached = this.values.get(key);
    if (cached && cached.expires > this.clock()) return cached.value as T;
    this.remove(key);
    const pending = this.pending.get(key);
    if (pending) return pending as Promise<T>;
    if (this.pending.size >= 4) throw new MetadataBusy();
    const result = Promise.resolve()
      .then(load)
      .then((value) => {
        const bytes = Buffer.byteLength(JSON.stringify(value));
        if (bytes <= 4 * 1024 * 1024) {
          while (this.bytes + bytes > 4 * 1024 * 1024 || this.values.size >= 64) {
            const oldest = this.values.keys().next().value;
            if (oldest === undefined) break;
            this.remove(oldest);
          }
          this.values.set(key, { value, bytes, expires: this.clock() + ttlMs });
          this.bytes += bytes;
        }
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, result);
    return result;
  }

  private remove(key: string) {
    const cached = this.values.get(key);
    if (cached) this.bytes -= cached.bytes;
    this.values.delete(key);
  }
}
