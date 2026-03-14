import { StorageBuffer } from '../../platform/graphics/storage-buffer.js';
import { BUFFERUSAGE_COPY_SRC, BUFFERUSAGE_COPY_DST } from '../../platform/graphics/constants.js';

/**
 * @import { GraphicsDevice } from '../../platform/graphics/graphics-device.js'
 */

// 256 bytes per material (16 x vec4f), aligned for GPU access
const FLOATS_PER_MATERIAL = 64;
const BYTES_PER_MATERIAL = 256;

/**
 * MaterialData layout (256 bytes = 16 x vec4f):
 *
 * vec4 0:  baseColor (rgba)
 * vec4 1:  emissive (rgb) + opacity
 * vec4 2:  specular (rgb) + glossiness
 * vec4 3:  metalness, roughness, alphaTest, bumpiness
 * vec4 4:  reflectivity, refraction, refractionIndex, thickness
 * vec4 5:  clearcoat, clearcoatGloss, ao, lightMapIntensity
 * vec4 6:  sheenGloss, iridescence, iridescenceThickness, anisotropy
 * vec4 7:  sheenColor (rgb) + dispersion
 * vec4 8:  attenuationColor (rgb) + attenuationDistance
 * vec4 9-15: reserved / padding
 */

/**
 * Manages a single GPU StorageBuffer holding packed material data for all materials.
 * Material properties are staged in a CPU-side Float32Array and uploaded to the GPU
 * once per frame via a single writeBuffer call.
 *
 * Follows the same slot allocation pattern as GlobalTransformBuffer.
 *
 * @ignore
 */
class MaterialStorageBuffer {
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
     * @param {number} [initialCapacity] - Initial number of material slots.
     */
    constructor(device, initialCapacity = 256) {
        this.device = device;
        this.capacity = initialCapacity;
        this.stagingBuffer = new Float32Array(initialCapacity * FLOATS_PER_MATERIAL);
        this.storageBuffer = new StorageBuffer(device, initialCapacity * BYTES_PER_MATERIAL, BUFFERUSAGE_COPY_SRC | BUFFERUSAGE_COPY_DST);
    }

    /**
     * Allocate a slot in the material storage buffer.
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
            this._resize(this.capacity * 2);
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
     * Write material data into the staging buffer at the given slot.
     *
     * @param {number} index - The slot index.
     * @param {Float32Array} data - The material data (FLOATS_PER_MATERIAL elements).
     */
    updateSlot(index, data) {
        const offset = index * FLOATS_PER_MATERIAL;
        this.stagingBuffer.set(data, offset);
        this.dirty = true;
    }

    /**
     * Write a single float value at a specific offset within a slot.
     *
     * @param {number} index - The slot index.
     * @param {number} floatOffset - The float offset within the slot (0-63).
     * @param {number} value - The float value.
     */
    updateSlotFloat(index, floatOffset, value) {
        const offset = index * FLOATS_PER_MATERIAL + floatOffset;
        this.stagingBuffer[offset] = value;
        this.dirty = true;
    }

    /**
     * Write a vec4 at a specific vec4 index within a slot.
     *
     * @param {number} index - The slot index.
     * @param {number} vec4Index - The vec4 index within the slot (0-15).
     * @param {number} x - X component.
     * @param {number} y - Y component.
     * @param {number} z - Z component.
     * @param {number} w - W component.
     */
    updateSlotVec4(index, vec4Index, x, y, z, w) {
        const offset = index * FLOATS_PER_MATERIAL + vec4Index * 4;
        this.stagingBuffer[offset] = x;
        this.stagingBuffer[offset + 1] = y;
        this.stagingBuffer[offset + 2] = z;
        this.stagingBuffer[offset + 3] = w;
        this.dirty = true;
    }

    /**
     * Upload the staging buffer to the GPU. Should be called once per frame after all materials
     * have been updated.
     */
    upload() {
        if (this.dirty && this.storageBuffer) {
            const usedFloats = this.nextSlot * FLOATS_PER_MATERIAL;
            if (usedFloats > 0) {
                this.storageBuffer.write(0, this.stagingBuffer, 0, usedFloats);
            }
            this.dirty = false;
        }
    }

    /**
     * Resize the buffer to a new capacity, preserving existing data.
     *
     * @param {number} newCapacity - The new number of slots.
     * @private
     */
    _resize(newCapacity) {
        const oldBuffer = this.storageBuffer;
        const oldStaging = this.stagingBuffer;

        this.capacity = newCapacity;
        this.stagingBuffer = new Float32Array(newCapacity * FLOATS_PER_MATERIAL);
        this.stagingBuffer.set(oldStaging);

        this.storageBuffer = new StorageBuffer(this.device, newCapacity * BYTES_PER_MATERIAL, BUFFERUSAGE_COPY_SRC | BUFFERUSAGE_COPY_DST);

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

export { MaterialStorageBuffer, FLOATS_PER_MATERIAL, BYTES_PER_MATERIAL };
