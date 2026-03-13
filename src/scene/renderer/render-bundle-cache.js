/**
 * Manages a cache of WebGPU Render Bundles for opaque draw call groups.
 *
 * Render bundles pre-record GPU command sequences (pipeline, bindGroups, vertex/index buffers,
 * draw calls) and replay them with a single `executeBundles()` call, drastically reducing
 * per-frame CPU encoding overhead for static or slowly-changing opaque geometry.
 *
 * Inspired by Orillusion's bundle caching pattern.
 *
 * @ignore
 */
class RenderBundleCache {
    /**
     * Cached bundles keyed by group key.
     *
     * @type {Map<string, GPURenderBundle>}
     */
    _cache = new Map();

    /**
     * Global version counter. Incremented on full invalidation so that stale lookups can be
     * detected quickly.
     *
     * @type {number}
     */
    _version = 0;

    /**
     * The version at which each cached bundle was recorded, keyed identically to `_cache`.
     *
     * @type {Map<string, number>}
     */
    _versions = new Map();

    /**
     * Performance counters.
     *
     * @type {{ hits: number, misses: number }}
     */
    stats = { hits: 0, misses: 0 };

    /**
     * Look up a cached bundle for the given group key.  Returns `null` on a miss.
     *
     * @param {string} groupKey - The draw-call-group key.
     * @returns {GPURenderBundle|null} The cached bundle, or null.
     */
    get(groupKey) {
        const ver = this._versions.get(groupKey);
        if (ver !== undefined && ver === this._version) {
            const bundle = this._cache.get(groupKey);
            if (bundle) {
                this.stats.hits++;
                return bundle;
            }
        }
        this.stats.misses++;
        return null;
    }

    /**
     * Store a newly recorded bundle.
     *
     * @param {string} groupKey - The draw-call-group key.
     * @param {GPURenderBundle} bundle - The finished GPURenderBundle.
     */
    set(groupKey, bundle) {
        this._cache.set(groupKey, bundle);
        this._versions.set(groupKey, this._version);
    }

    /**
     * Invalidate a single group so that it will be re-recorded next frame.
     *
     * @param {string} groupKey - The draw-call-group key.
     */
    invalidateGroup(groupKey) {
        this._cache.delete(groupKey);
        this._versions.delete(groupKey);
    }

    /**
     * Invalidate every cached bundle (e.g. render-target format change, layer restructure).
     */
    invalidateAll() {
        this._cache.clear();
        this._versions.clear();
        this._version++;
    }

    /**
     * Release all GPU resources.
     */
    destroy() {
        this._cache.clear();
        this._versions.clear();
    }
}

export { RenderBundleCache };
