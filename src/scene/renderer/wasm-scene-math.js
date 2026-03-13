/**
 * WASM SIMD128 batch matrix computation wrapper.
 *
 * Manages WASM linear memory and provides an interface for batch world matrix computation
 * using SIMD128 mat4x4 multiplication. Designed for zero-copy integration with
 * GlobalTransformBuffer — the worldMatrices Float32Array can be used directly as GPU
 * staging data.
 *
 * @ignore
 */
class WasmSceneMath {
    /** @type {WebAssembly.Instance|null} */
    _instance = null;

    /** @type {ArrayBuffer|null} */
    _memory = null;

    /** @type {number} */
    capacity;

    // Typed array views into WASM linear memory
    /** @type {Float32Array|null} */
    localMatrices = null;

    /** @type {Uint32Array|null} */
    parentIndices = null;

    /** @type {Float32Array|null} */
    worldMatrices = null;

    /** @type {Uint32Array|null} */
    _dirtyList = null;

    /** @type {number} */
    _dirtyCount = 0;

    /** @type {number} */
    _maxDirtyCapacity;

    // Byte offsets into WASM memory
    /** @type {number} */
    _localOffset = 0;

    /** @type {number} */
    _parentOffset = 0;

    /** @type {number} */
    _worldOffset = 0;

    /** @type {number} */
    _dirtyOffset = 0;

    /** @type {boolean} */
    ready = false;

    // Slot allocator (mirrors GlobalTransformBuffer pattern)
    /** @type {number[]} */
    _freeSlots = [];

    /** @type {number} */
    _nextSlot = 0;

    /**
     * Create a new WasmSceneMath instance.
     *
     * @param {number} [initialCapacity] - Initial number of transform slots.
     */
    constructor(initialCapacity = 4096) {
        this.capacity = initialCapacity;
        this._maxDirtyCapacity = initialCapacity;
        this._allocateMemory(initialCapacity);
    }

    /**
     * Initialize with a compiled WASM instance. Call this after the WASM module loads.
     *
     * @param {WebAssembly.Instance} instance - The WASM instance.
     */
    setInstance(instance) {
        this._instance = instance;
        this.ready = true;
    }

    /**
     * Allocate WASM-compatible linear memory and create typed array views.
     *
     * Memory layout (contiguous):
     *   [localMatrices: capacity * 64 bytes]
     *   [parentIndices: capacity * 4 bytes]
     *   [worldMatrices: capacity * 64 bytes]
     *   [dirtyList:     capacity * 4 bytes]
     *
     * @param {number} capacity - Number of transform slots.
     * @private
     */
    _allocateMemory(capacity) {
        const FLOATS_PER_MAT = 16;
        const BYTES_PER_MAT = 64;
        const BYTES_PER_U32 = 4;

        const localSize = capacity * BYTES_PER_MAT;
        const parentSize = capacity * BYTES_PER_U32;
        const worldSize = capacity * BYTES_PER_MAT;
        const dirtySize = capacity * BYTES_PER_U32;
        const totalBytes = localSize + parentSize + worldSize + dirtySize;

        // Use plain ArrayBuffer (CSP-safe, no WebAssembly.Memory needed for JS fallback path)
        this._memory = new ArrayBuffer(totalBytes);

        const buffer = this._memory;

        this._localOffset = 0;
        this._parentOffset = localSize;
        this._worldOffset = localSize + parentSize;
        this._dirtyOffset = localSize + parentSize + worldSize;

        this.localMatrices = new Float32Array(buffer, this._localOffset, capacity * FLOATS_PER_MAT);
        this.parentIndices = new Uint32Array(buffer, this._parentOffset, capacity);
        this.worldMatrices = new Float32Array(buffer, this._worldOffset, capacity * FLOATS_PER_MAT);
        this._dirtyList = new Uint32Array(buffer, this._dirtyOffset, capacity);

        // Initialize parent indices to 0xFFFFFFFF (no parent / root)
        this.parentIndices.fill(0xFFFFFFFF);

        this._dirtyCount = 0;
        this._maxDirtyCapacity = capacity;
    }

    /**
     * Allocate a slot for a graph node's transform in the WASM buffers.
     *
     * @returns {number} The allocated slot index.
     */
    allocateSlot() {
        if (this._freeSlots.length > 0) {
            return this._freeSlots.pop();
        }
        const slot = this._nextSlot;
        this._nextSlot++;
        if (slot >= this.capacity) {
            this._resize(this.capacity * 2);
        }
        return slot;
    }

    /**
     * Free a previously allocated slot, returning it to the pool.
     *
     * @param {number} slotId - The slot index to free.
     */
    freeSlot(slotId) {
        if (slotId >= 0) {
            this._freeSlots.push(slotId);
        }
    }

    /**
     * Write back computed world matrices from WASM buffer into GraphNode.worldTransform.
     * This ensures other engine systems (physics, audio, etc.) that read worldTransform
     * get the correct values.
     *
     * @param {import('../../scene/graph-node.js').GraphNode} root - The root of the scene graph.
     */
    writeBackWorldTransforms(root) {
        this._writeBackNode(root);
    }

    /**
     * @param {import('../../scene/graph-node.js').GraphNode} node - Current node.
     * @private
     */
    _writeBackNode(node) {
        if (!node._enabled) return;

        const slot = node._wasmSlot;
        if (slot >= 0) {
            const offset = slot * 16;
            const data = node.worldTransform.data;
            const src = this.worldMatrices;
            // Copy 16 floats from WASM buffer to node's worldTransform
            for (let i = 0; i < 16; i++) {
                data[i] = src[offset + i];
            }
        }

        const children = node._children;
        for (let i = 0, len = children.length; i < len; i++) {
            this._writeBackNode(children[i]);
        }
    }

    /**
     * Write a local transform matrix for a given slot.
     *
     * @param {number} slotId - The slot index.
     * @param {Float32Array} mat4Data - 16-element column-major matrix data.
     */
    setLocalMatrix(slotId, mat4Data) {
        if (slotId >= this.capacity) {
            this._resize(Math.max(this.capacity * 2, slotId + 1));
        }
        const offset = slotId * 16;
        this.localMatrices.set(mat4Data, offset);
    }

    /**
     * Set the parent slot index for a given slot.
     *
     * @param {number} slotId - The slot index.
     * @param {number} parentSlotId - Parent slot index, or 0xFFFFFFFF for root nodes.
     */
    setParentIndex(slotId, parentSlotId) {
        if (slotId >= this.capacity) {
            this._resize(Math.max(this.capacity * 2, slotId + 1));
        }
        this.parentIndices[slotId] = parentSlotId;
    }

    /**
     * Write a pre-computed world matrix directly into the world matrices buffer.
     * Used for zero-copy GPU upload when JS already computed the world transform.
     *
     * @param {number} slotId - The slot index.
     * @param {Float32Array} mat4Data - 16-element column-major world matrix data.
     */
    setWorldMatrix(slotId, mat4Data) {
        if (slotId >= this.capacity) {
            this._resize(Math.max(this.capacity * 2, slotId + 1));
        }
        const offset = slotId * 16;
        this.worldMatrices.set(mat4Data, offset);
    }

    /**
     * Mark a slot as dirty (needs world matrix recomputation).
     *
     * @param {number} slotId - The slot index.
     */
    markDirty(slotId) {
        if (this._dirtyCount >= this._maxDirtyCapacity) {
            // Should not happen if capacity is managed correctly, but guard against it
            return;
        }
        this._dirtyList[this._dirtyCount] = slotId;
        this._dirtyCount++;
    }

    /**
     * Clear the dirty list. Call after computeBatch().
     */
    clearDirtyList() {
        this._dirtyCount = 0;
    }

    /**
     * Compute world matrices for all dirty nodes using WASM SIMD.
     *
     * IMPORTANT: The dirty list must be topologically sorted (parents before children)
     * so that a parent's world matrix is already computed when its child is processed.
     *
     * Falls back to JS computation if WASM is not ready.
     */
    computeBatch() {
        if (this._dirtyCount === 0) return;

        if (this.ready && this._instance) {
            // Call WASM exported function
            this._instance.exports.compute_world_matrices(
                this._dirtyOffset,      // pointer to dirty_list
                this._dirtyCount,        // dirty_count
                this._localOffset,       // pointer to local_matrices
                this._parentOffset,      // pointer to parent_indices
                this._worldOffset        // pointer to world_matrices
            );
        } else {
            // JS fallback: simple mat4 multiply
            this._computeBatchJS();
        }

        this.clearDirtyList();
    }

    /**
     * JS fallback for batch world matrix computation.
     *
     * @private
     */
    _computeBatchJS() {
        const local = this.localMatrices;
        const parent = this.parentIndices;
        const world = this.worldMatrices;
        const dirty = this._dirtyList;

        for (let i = 0; i < this._dirtyCount; i++) {
            const id = dirty[i];
            const lo = id * 16;  // local offset
            const wo = id * 16;  // world offset
            const pid = parent[id];

            if (pid === 0xFFFFFFFF) {
                // Root node: world = local (copy)
                for (let j = 0; j < 16; j++) {
                    world[wo + j] = local[lo + j];
                }
            } else {
                // Child node: world = parent.world * local
                const po = pid * 16; // parent world offset
                mat4MulFlat(world, po, local, lo, world, wo);
            }
        }
    }

    /**
     * Get the world matrices buffer for direct GPU upload (zero-copy).
     *
     * @returns {Float32Array} The world matrices Float32Array view into WASM memory.
     */
    getWorldMatricesBuffer() {
        return this.worldMatrices;
    }

    /**
     * Resize to accommodate more slots, preserving existing data.
     *
     * @param {number} newCapacity - New number of slots.
     * @private
     */
    _resize(newCapacity) {
        const oldLocal = this.localMatrices;
        const oldParent = this.parentIndices;
        const oldWorld = this.worldMatrices;

        this.capacity = newCapacity;
        this._maxDirtyCapacity = newCapacity;
        this._allocateMemory(newCapacity);

        // Copy old data into new buffers
        if (oldLocal) this.localMatrices.set(oldLocal);
        if (oldParent) this.parentIndices.set(oldParent);
        if (oldWorld) this.worldMatrices.set(oldWorld);
    }

    /**
     * Load the WASM module from a URL and initialize.
     *
     * @param {string} wasmUrl - URL to the scene-math.wasm file.
     * @returns {Promise<void>}
     */
    async loadWasm(wasmUrl) {
        try {
            const response = await fetch(wasmUrl);
            const wasmBytes = await response.arrayBuffer();

            const importObject = {
                env: {
                    memory: this._memory
                }
            };

            const { instance } = await WebAssembly.instantiate(wasmBytes, importObject);
            this.setInstance(instance);
        } catch (e) {
            // WASM not available — JS fallback will be used
            console.warn('WasmSceneMath: Failed to load WASM module, using JS fallback.', e);
        }
    }

    destroy() {
        this.localMatrices = null;
        this.parentIndices = null;
        this.worldMatrices = null;
        this._dirtyList = null;
        this._instance = null;
        this._memory = null;
        this.ready = false;
    }
}

/**
 * Flat mat4 multiplication: out = A * B (column-major).
 * Reads from flat Float32Array at given offsets.
 *
 * @param {Float32Array} a - Source array for matrix A.
 * @param {number} ao - Offset into a.
 * @param {Float32Array} b - Source array for matrix B.
 * @param {number} bo - Offset into b.
 * @param {Float32Array} out - Destination array.
 * @param {number} oo - Offset into out.
 * @ignore
 */
function mat4MulFlat(a, ao, b, bo, out, oo) {
    const a00 = a[ao], a01 = a[ao + 1], a02 = a[ao + 2], a03 = a[ao + 3];
    const a10 = a[ao + 4], a11 = a[ao + 5], a12 = a[ao + 6], a13 = a[ao + 7];
    const a20 = a[ao + 8], a21 = a[ao + 9], a22 = a[ao + 10], a23 = a[ao + 11];
    const a30 = a[ao + 12], a31 = a[ao + 13], a32 = a[ao + 14], a33 = a[ao + 15];

    for (let col = 0; col < 4; col++) {
        const bi = bo + col * 4;
        const b0 = b[bi], b1 = b[bi + 1], b2 = b[bi + 2], b3 = b[bi + 3];
        const oi = oo + col * 4;
        out[oi]     = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
        out[oi + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
        out[oi + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
        out[oi + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
    }
}

export { WasmSceneMath };
