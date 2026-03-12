import { StorageBuffer } from '../../platform/graphics/storage-buffer.js';
import { BUFFERUSAGE_COPY_SRC, BUFFERUSAGE_COPY_DST } from '../../platform/graphics/constants.js';

/**
 * @import { GraphicsDevice } from '../../platform/graphics/graphics-device.js'
 */

const FLOATS_PER_MATRIX = 16;
const BYTES_PER_MATRIX = 64;

/**
 * Manages a single GPU StorageBuffer holding world transform matrices (mat4x4<f32>) for all
 * renderable objects. Transforms are staged in a CPU-side Float32Array and uploaded to the GPU
 * once per frame via a single writeBuffer call.
 *
 * @ignore
 */
class GlobalTransformBuffer {
    /** @type {GraphicsDevice} */
    device;

    /** @type {StorageBuffer|null} */
    storageBuffer = null;

    /** @type {Float32Array} */
    stagingBuffer;

    /** @type {number} */
    capacity;

    /** @type {number[]} */
    freeSlots = [];

    /** @type {number} */
    nextSlot = 0;

    /** @type {boolean} */
    dirty = false;

    /**
     * @param {GraphicsDevice} device - The graphics device.
     * @param {number} [initialCapacity] - Initial number of transform slots.
     */
    constructor(device, initialCapacity = 4096) {
        this.device = device;
        this.capacity = initialCapacity;
        this.stagingBuffer = new Float32Array(initialCapacity * FLOATS_PER_MATRIX);
        this.storageBuffer = new StorageBuffer(device, initialCapacity * BYTES_PER_MATRIX, BUFFERUSAGE_COPY_SRC | BUFFERUSAGE_COPY_DST);
    }

    /**
     * Allocate a slot in the global transform buffer.
     *
     * @returns {number} The slot index.
     */
    allocateSlot() {
        if (this.freeSlots.length > 0) {
            return this.freeSlots.pop();
        }

        const slot = this.nextSlot;
        this.nextSlot++;

        if (slot >= this.capacity) {
            this.resize(this.capacity * 2);
        }

        return slot;
    }

    /**
     * Free a previously allocated slot, returning it to the pool.
     *
     * @param {number} index - The slot index to free.
     */
    freeSlot(index) {
        if (index >= 0) {
            this.freeSlots.push(index);
        }
    }

    /**
     * Write a world transform matrix into the staging buffer.
     *
     * @param {number} index - The slot index.
     * @param {Float32Array} mat4Data - The 16-element matrix data (column-major).
     */
    updateSlot(index, mat4Data) {
        const offset = index * FLOATS_PER_MATRIX;
        this.stagingBuffer.set(mat4Data, offset);
        this.dirty = true;
    }

    /**
     * Upload the staging buffer to the GPU. Should be called once per frame after all transforms
     * have been updated.
     */
    upload() {
        if (this.dirty && this.storageBuffer) {
            const usedBytes = this.nextSlot * BYTES_PER_MATRIX;
            if (usedBytes > 0) {
                this.storageBuffer.write(0, this.stagingBuffer, 0, this.nextSlot * FLOATS_PER_MATRIX);
            }
            this.dirty = false;
        }
    }

    /**
     * Resize the buffer to a new capacity, preserving existing data.
     *
     * @param {number} newCapacity - The new number of slots.
     */
    resize(newCapacity) {
        const oldBuffer = this.storageBuffer;
        const oldStaging = this.stagingBuffer;

        this.capacity = newCapacity;
        this.stagingBuffer = new Float32Array(newCapacity * FLOATS_PER_MATRIX);
        this.stagingBuffer.set(oldStaging);

        this.storageBuffer = new StorageBuffer(this.device, newCapacity * BYTES_PER_MATRIX, BUFFERUSAGE_COPY_SRC | BUFFERUSAGE_COPY_DST);

        // GPU-GPU copy of existing data
        if (oldBuffer) {
            this.storageBuffer.copy(oldBuffer, 0, 0, oldStaging.byteLength);
            oldBuffer.destroy();
        }
    }

    destroy() {
        if (this.storageBuffer) {
            this.storageBuffer.destroy();
            this.storageBuffer = null;
        }
        this.stagingBuffer = null;
    }
}

export { GlobalTransformBuffer };
