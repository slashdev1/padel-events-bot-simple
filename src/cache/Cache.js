const Config = require('../config/Config');

class Cache {
    constructor(options = {}) {
        const config = new Config();
        const defaultTtlMs = Number(options.defaultTtlMs || config.cacheDefaultTTL);
        this.defaultTtlMs = isNaN(defaultTtlMs) ? 60_000 : defaultTtlMs;
        const cleanupIntervalMs = Number(options.cleanupIntervalMs || config.cacheCleanupInterval);
        this.cleanupIntervalMs = isNaN(cleanupIntervalMs) ? 120_000 : cleanupIntervalMs;
        this.map = new Map(); // Map<key, { value, expiresAt }>

        if (this.cleanupIntervalMs > 0) {
            this._startCleanup();
        }
    }

    _startCleanup() {
        this._cleanupTimer = setInterval(() => {
            const now = Date.now();
            for (const [key, entry] of this.map.entries()) {
                if (!entry || entry.expiresAt <= now) {
                    this.map.delete(key);
                }
            }
        }, this.cleanupIntervalMs);
        if (this._cleanupTimer && this._cleanupTimer.unref) {
            this._cleanupTimer.unref();
        }
    }

    stopCleanup() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = null;
        }
    }

    _computeExpiry(ttlMs) {
        const ttl = Number(ttlMs || this.defaultTtlMs);
        return Date.now() + (isNaN(ttl) ? this.defaultTtlMs : ttl);
    }

    get(key) {
        const entry = this.map.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= Date.now()) {
            this.map.delete(key);
            return undefined;
        }
        return entry.value;
    }

    set(key, value, ttlMs) {
        this.map.set(key, { value, expiresAt: this._computeExpiry(ttlMs) });
        return value;
    }

    async getOrSet(key, fetcher, ttlMs) {
        const existing = this.get(key);
        if (existing !== undefined) return existing;
        const value = await fetcher();
        this.set(key, value, ttlMs);
        return value;
    }

    has(key) {
        return this.get(key) !== undefined;
    }

    delete(key) {
        this.map.delete(key);
    }

    clear() {
        this.map.clear();
    }
}

module.exports = Cache;


