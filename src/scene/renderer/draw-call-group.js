import { SHADERDEF_SKIN, SHADERDEF_MORPH_POSITION, SHADERDEF_MORPH_NORMAL, SHADERDEF_MORPH_TEXTURE_BASED_INT } from '../constants.js';

/**
 * @import { MeshInstance } from '../mesh-instance.js'
 */

/**
 * Bit masks used to detect dynamic mesh instances that cannot be bundled.
 *
 * @type {number}
 * @private
 */
const DYNAMIC_DEFS = SHADERDEF_SKIN | SHADERDEF_MORPH_POSITION | SHADERDEF_MORPH_NORMAL | SHADERDEF_MORPH_TEXTURE_BASED_INT;

/**
 * A lightweight descriptor for a group of draw calls that share the same render pipeline state
 * (mesh geometry, shader variant, blend/depth/stencil state) and can therefore be recorded into
 * a single GPURenderBundle.
 *
 * @ignore
 */
class DrawGroup {
    /**
     * The group key (used as cache key in RenderBundleCache).
     *
     * @type {string}
     */
    key;

    /**
     * Indices into the prepared draw-call list for this group.
     *
     * @type {number[]}
     */
    indices = [];

    /**
     * Whether any member of this group has changed since the last bundle recording, meaning
     * the bundle must be re-recorded.
     *
     * @type {boolean}
     */
    needsRebundle = true;

    /**
     * Sum of material._bundleVersion values at the time the bundle was last recorded.
     * Used to detect material changes.
     *
     * @type {number}
     */
    _lastMaterialVersionSum = -1;

    /**
     * @param {string} key - The group key.
     */
    constructor(key) {
        this.key = key;
    }
}

/**
 * Groups draw calls by shared GPU pipeline state (mesh id + shader id + blend/depth/stencil)
 * so that each group can be recorded into a single GPURenderBundle.
 *
 * Inspired by Orillusion's EntityBatchCollect pattern.
 *
 * @ignore
 */
class DrawCallGrouper {
    /**
     * Groups keyed by their pipeline-state string.
     *
     * @type {Map<string, DrawGroup>}
     */
    groups = new Map();

    /**
     * Previous frame's group key set, used for change detection.
     *
     * @type {Map<string, number>}
     * @private
     */
    _prevGroupCounts = new Map();

    /**
     * When true, material property changes are stored in a global StorageBuffer and do not
     * require bundle re-recording. Only pipeline state changes (blend, depth, shader) invalidate.
     *
     * @type {boolean}
     */
    materialStorageBufferEnabled = false;

    /**
     * Hash of the last transparent sort order, used to detect when transparent bundles need
     * re-recording due to depth sort changes.
     *
     * @type {number}
     * @private
     */
    _lastTransparentSortHash = 0;

    /**
     * Generate a group key for a draw call + shader combination.
     *
     * The key encodes:
     *  - mesh.id              – geometry identity
     *  - shader.id            – shader variant
     *  - blendState key       – blend mode
     *  - depthState key       – depth test/write
     *  - stencil ref          – stencil reference value
     *
     * @param {MeshInstance} drawCall - The mesh instance.
     * @param {object} shaderInstance - The shader instance (must have .shader.id).
     * @returns {string} The group key.
     */
    static generateKey(drawCall, shaderInstance) {
        const material = drawCall.material;
        return `${drawCall.mesh.id}:${shaderInstance.shader.id}:${material.blendState.key}:${material.depthState.key}:${drawCall.stencilFront?.ref ?? material.stencilFront?.ref ?? 0}`;
    }

    /**
     * Whether a draw call is eligible for bundle recording.
     * Skinned meshes, morph targets are excluded because their vertex buffers change per frame.
     *
     * @param {MeshInstance} drawCall - The mesh instance.
     * @returns {boolean} True if the draw call can be bundled.
     */
    static isBundleable(drawCall) {
        // exclude skinned and morphed meshes (their vertex data is dynamic)
        if (drawCall._shaderDefs & DYNAMIC_DEFS) {
            return false;
        }
        return true;
    }

    /**
     * Group prepared draw calls by shared pipeline state.
     *
     * @param {object} preparedCalls - The prepared calls from renderForwardPrepareMaterials().
     * Must have .drawCalls[] and .shaderInstances[].
     * @returns {Map<string, DrawGroup>} The groups map (same reference as this.groups).
     */
    groupDrawCalls(preparedCalls) {
        const groups = this.groups;

        // save previous counts for change detection
        this._prevGroupCounts.clear();
        for (const [key, group] of groups) {
            this._prevGroupCounts.set(key, group.indices.length);
        }

        // clear existing groups
        for (const group of groups.values()) {
            group.indices.length = 0;
        }

        const { drawCalls, shaderInstances } = preparedCalls;
        const count = drawCalls.length;

        for (let i = 0; i < count; i++) {
            const drawCall = drawCalls[i];

            if (!DrawCallGrouper.isBundleable(drawCall)) {
                continue;
            }

            const shaderInstance = shaderInstances[i];
            const key = DrawCallGrouper.generateKey(drawCall, shaderInstance);

            let group = groups.get(key);
            if (!group) {
                group = new DrawGroup(key);
                groups.set(key, group);
            }
            group.indices.push(i);
        }

        // detect changes: mark groups that differ from previous frame
        for (const [key, group] of groups) {
            const prevCount = this._prevGroupCounts.get(key);
            if (prevCount === undefined || prevCount !== group.indices.length) {
                group.needsRebundle = true;
            }

            // When materialStorageBufferEnabled, material property changes are written to
            // the global StorageBuffer and don't affect recorded pipeline state, so we skip
            // the material version check to avoid unnecessary bundle re-recording.
            if (!this.materialStorageBufferEnabled) {
                let versionSum = 0;
                for (let g = 0; g < group.indices.length; g++) {
                    const dc = drawCalls[group.indices[g]];
                    versionSum += dc.material._bundleVersion;
                }
                if (versionSum !== group._lastMaterialVersionSum) {
                    group.needsRebundle = true;
                    group._lastMaterialVersionSum = versionSum;
                }
            }
        }

        // remove empty groups
        for (const [key, group] of groups) {
            if (group.indices.length === 0) {
                groups.delete(key);
            }
        }

        return groups;
    }

    /**
     * Compute a lightweight hash of the draw call order to detect sort order changes
     * for transparent bundling.
     *
     * @param {MeshInstance[]} drawCalls - The draw calls in sorted order.
     * @returns {number} Hash value.
     */
    static computeSortHash(drawCalls) {
        let hash = 0;
        for (let i = 0; i < drawCalls.length; i++) {
            // combine id and position in list to detect reordering
            hash = ((hash << 5) - hash + drawCalls[i].id) | 0;
        }
        return hash;
    }

    /**
     * Check if the transparent sort order has changed and mark all groups for rebundle if so.
     *
     * @param {MeshInstance[]} drawCalls - The sorted draw calls.
     */
    checkTransparentSortChange(drawCalls) {
        const hash = DrawCallGrouper.computeSortHash(drawCalls);
        if (hash !== this._lastTransparentSortHash) {
            this._lastTransparentSortHash = hash;
            this.invalidateAll();
        }
    }

    /**
     * Mark a specific group as needing re-recording.
     *
     * @param {string} groupKey - The group key.
     */
    invalidateGroup(groupKey) {
        const group = this.groups.get(groupKey);
        if (group) {
            group.needsRebundle = true;
        }
    }

    /**
     * Mark all groups as needing re-recording.
     */
    invalidateAll() {
        for (const group of this.groups.values()) {
            group.needsRebundle = true;
        }
    }

    /**
     * Release resources.
     */
    destroy() {
        this.groups.clear();
        this._prevGroupCounts.clear();
    }
}

export { DrawCallGrouper, DrawGroup };
