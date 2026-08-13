/**
 * Small in-process TTL cache used to keep slow-changing Azure DevOps metadata
 * (project, teams, members, iterations, field catalogue) out of the hot path.
 *
 * Deliberately in-memory only: nothing is persisted to disk, so no Azure DevOps
 * content or credential material outlives the process. Redis can be swapped in
 * behind this same interface if the deployment ever needs shared caching.
 */
interface CacheEntry<T> {
    value: T;
    expiresAt: number;
}

export class TtlCache {
    private readonly store = new Map<string, CacheEntry<unknown>>();

    constructor(private readonly defaultTtlSeconds: number) {}

    get<T>(key: string): T | undefined {
        const entry = this.store.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= Date.now()) {
            this.store.delete(key);
            return undefined;
        }
        return entry.value as T;
    }

    set<T>(key: string, value: T, ttlSeconds?: number): void {
        const ttl = ttlSeconds ?? this.defaultTtlSeconds;
        if (ttl <= 0) return;
        this.store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
    }

    /** Reads through the cache, de-duplicating concurrent misses via the promise itself. */
    async getOrLoad<T>(key: string, loader: () => Promise<T>, ttlSeconds?: number): Promise<T> {
        const cached = this.get<Promise<T> | T>(key);
        if (cached !== undefined) return await cached;

        const pending = loader().catch((error: unknown) => {
            // Never cache a failure: the next call must retry against Azure DevOps.
            this.store.delete(key);
            throw error;
        });
        this.set(key, pending, ttlSeconds);
        const value = await pending;
        this.set(key, value, ttlSeconds);
        return value;
    }

    delete(key: string): void {
        this.store.delete(key);
    }

    /** Drops every entry whose key starts with the given prefix. */
    deletePrefix(prefix: string): number {
        let removed = 0;
        for (const key of [...this.store.keys()]) {
            if (key.startsWith(prefix)) {
                this.store.delete(key);
                removed += 1;
            }
        }
        return removed;
    }

    clear(): number {
        const size = this.store.size;
        this.store.clear();
        return size;
    }

    get size(): number {
        return this.store.size;
    }
}
