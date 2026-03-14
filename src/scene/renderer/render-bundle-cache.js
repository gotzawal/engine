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
     * Build a composite cache key from a group key and optional pass type.
     *
     * @param {string} groupKey - The draw-call-group key.
     * @param {number} [passType] - The shader pass type (e.g. shadow, depth prepass).
     * @returns {string} The composite key.
     * @private
     */
    _compositeKey(groupKey, passType) {
        return passType !== undefined ? `${groupKey}:p${passType}` : groupKey;
    }

    /**
     * Look up a cached bundle for the given group key and pass type.  Returns `null` on a miss.
     *
     * @param {string} groupKey - The draw-call-group key.
     * @param {number} [passType] - The shader pass type.
     * @returns {GPURenderBundle|null} The cached bundle, or null.
     */
    get(groupKey, passType) {
        const ckey = this._compositeKey(groupKey, passType);
        const ver = this._versions.get(ckey);
        if (ver !== undefined && ver === this._version) {
            const bundle = this._cache.get(ckey);
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
     * @param {number} [passType] - The shader pass type.
     */
    set(groupKey, bundle, passType) {
        const ckey = this._compositeKey(groupKey, passType);
        this._cache.set(ckey, bundle);
        this._versions.set(ckey, this._version);
    }

    /**
     * Invalidate a single group so that it will be re-recorded next frame.
     * If passType is provided, only invalidates that specific pass; otherwise all passes.
     *
     * @param {string} groupKey - The draw-call-group key.
     * @param {number} [passType] - Optional pass type to invalidate.
     */
    invalidateGroup(groupKey, passType) {
        if (passType !== undefined) {
            const ckey = this._compositeKey(groupKey, passType);
            this._cache.delete(ckey);
            this._versions.delete(ckey);
        } else {
            // invalidate all pass types for this group by scanning keys
            const prefix = groupKey;
            for (const key of this._cache.keys()) {
                if (key === prefix || key.startsWith(prefix + ':p')) {
                    this._cache.delete(key);
                    this._versions.delete(key);
                }
            }
        }
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
