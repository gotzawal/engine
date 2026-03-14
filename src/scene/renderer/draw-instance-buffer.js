import { StorageBuffer } from '../../platform/graphics/storage-buffer.js';
import { BUFFERUSAGE_COPY_SRC, BUFFERUSAGE_COPY_DST } from '../../platform/graphics/constants.js';

/**
 * @import { GraphicsDevice } from '../../platform/graphics/graphics-device.js'
 */

// DrawInstance struct layout: 8 x u32 = 32 bytes
const UINT32S_PER_INSTANCE = 8;
const BYTES_PER_INSTANCE = 32;

/**
 * GPU-visible buffer holding per-draw-call metadata for GPU-driven rendering.
 * Each draw instance stores transform slot, material slot, and geometry offsets
 * into the shared GeometryPool buffers.
 *
 * Layout per instance (32 bytes = 2 x vec4u):
 *   [0] transformSlot (u32)   - index into globalTransforms storage buffer
 *   [1] materialSlot  (u32)   - index into globalMaterials storage buffer
 *   [2] firstIndex    (u32)   - offset into the mega index buffer
 *   [3] indexCount    (u32)   - number of indices for this draw
 *   [4] baseVertex    (i32)   - vertex offset in the mega vertex buffer
 *   [5] batchId       (u32)   - which GeometryBatch (vertex format group)
 *   [6] _pad0         (u32)
 *   [7] _pad1         (u32)
 *
 * @ignore
 */
class DrawInstanceBuffer {
    /** @type {GraphicsDevice} */
    device;

    /** @type {StorageBuffer|null} */
    storageBuffer = null;

    /** @type {Uint32Array} */
    stagingBuffer;

    /** @type {Int32Array} - aliased view for writing signed baseVertex */
    stagingBufferI32;

    /** @type {number} */
    capacity;

    /** @type {number} - number of active draw instances this frame */
    count = 0;

    /** @type {boolean} */
    dirty = false;

    /**
     * @param {GraphicsDevice} device - The graphics device.
     * @param {number} [initialCapacity] - Initial number of draw instance slots.
     */
    constructor(device, initialCapacity = 4096) {
        this.device = device;
        this.capacity = initialCapacity;
        const totalU32s = initialCapacity * UINT32S_PER_INSTANCE;
        const buffer = new ArrayBuffer(totalU32s * 4);
        this.stagingBuffer = new Uint32Array(buffer);
        this.stagingBufferI32 = new Int32Array(buffer);
        this.storageBuffer = new StorageBuffer(device, initialCapacity * BYTES_PER_INSTANCE, BUFFERUSAGE_COPY_SRC | BUFFERUSAGE_COPY_DST);
    }

    /**
     * Begin a new frame. Resets the draw instance count.
     */
    beginFrame() {
        this.count = 0;
    }

    /**
     * Add a draw instance entry.
     *
     * @param {number} transformSlot - Index into globalTransforms.
     * @param {number} materialSlot - Index into globalMaterials.
     * @param {number} firstIndex - Offset into the mega index buffer.
     * @param {number} indexCount - Number of indices.
     * @param {number} baseVertex - Vertex offset (signed).
     * @param {number} batchId - GeometryBatch id.
     * @returns {number} The drawId (index of this instance).
     */
    addInstance(transformSlot, materialSlot, firstIndex, indexCount, baseVertex, batchId) {
        if (this.count >= this.capacity) {
            this._resize(this.capacity * 2);
        }

        const drawId = this.count;
        const offset = drawId * UINT32S_PER_INSTANCE;

        this.stagingBuffer[offset + 0] = transformSlot;
        this.stagingBuffer[offset + 1] = materialSlot;
        this.stagingBuffer[offset + 2] = firstIndex;
        this.stagingBuffer[offset + 3] = indexCount;
        this.stagingBufferI32[offset + 4] = baseVertex;  // signed i32
        this.stagingBuffer[offset + 5] = batchId;
        this.stagingBuffer[offset + 6] = 0;
        this.stagingBuffer[offset + 7] = 0;

        this.count++;
        this.dirty = true;
        return drawId;
    }

    /**
     * Upload staging buffer to GPU. Call once per frame after all instances are added.
     */
    upload() {
        if (this.dirty && this.storageBuffer && this.count > 0) {
            const usedU32s = this.count * UINT32S_PER_INSTANCE;
            this.storageBuffer.write(0, this.stagingBuffer, 0, usedU32s);
            this.dirty = false;
        }
    }

    /**
     * @param {number} newCapacity - New capacity.
     * @private
     */
    _resize(newCapacity) {
        const oldStaging = this.stagingBuffer;

        this.capacity = newCapacity;
        const totalU32s = newCapacity * UINT32S_PER_INSTANCE;
        const buffer = new ArrayBuffer(totalU32s * 4);
        this.stagingBuffer = new Uint32Array(buffer);
        this.stagingBufferI32 = new Int32Array(buffer);
        this.stagingBuffer.set(oldStaging);

        const oldStorage = this.storageBuffer;
        this.storageBuffer = new StorageBuffer(this.device, newCapacity * BYTES_PER_INSTANCE, BUFFERUSAGE_COPY_SRC | BUFFERUSAGE_COPY_DST);

        if (oldStorage) {
            this.storageBuffer.copy(oldStorage, 0, 0, oldStaging.byteLength);
            oldStorage.destroy();
        }
    }

    destroy() {
        if (this.storageBuffer) {
            this.storageBuffer.destroy();
            this.storageBuffer = null;
        }
        this.stagingBuffer = null;
        this.stagingBufferI32 = null;
    }
}

export { DrawInstanceBuffer, BYTES_PER_INSTANCE, UINT32S_PER_INSTANCE };
