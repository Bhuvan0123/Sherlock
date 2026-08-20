import { TtlCache } from '../utils/cache.js';
import { getConfig } from '../config/env.js';
import type { ExecutionContext } from './context-manager.js';
import { Telemetry } from './telemetry.js';

/** Shared cross-request cache for data that changes infrequently (members, sprint dates) */
export const sharedCache = new TtlCache(getConfig().cacheTtlSeconds);

export class CacheManager {
    /**
     * Executes a loader function, deduplicating via the ExecutionContext request cache
     * (fast, lives only for one request) and falling back to the cross-request shared cache.
     */
    static async getOrLoad<T>(
        context: ExecutionContext,
        key: string,
        loader: () => Promise<T>,
        ttlSeconds?: number
    ): Promise<T> {
        if (context.cache.has(key)) {
            Telemetry.recordCacheHit();
            return context.cache.get(key) as Promise<T> | T;
        }

        const sharedHit = sharedCache.get<T>(key);
        if (sharedHit !== undefined) {
            Telemetry.recordCacheHit();
            context.cache.set(key, sharedHit);
            return sharedHit;
        }

        Telemetry.recordCacheMiss();
        const loadAndCache = async (): Promise<T> => {
            return await sharedCache.getOrLoad(key, loader, ttlSeconds);
        };

        // Cache the promise immediately in the request scope to dedupe concurrent calls
        const pending = loadAndCache();
        context.cache.set(key, pending);

        try {
            const result = await pending;
            context.cache.set(key, result);
            return result;
        } catch (error) {
            context.cache.delete(key);
            throw error;
        }
    }
}
