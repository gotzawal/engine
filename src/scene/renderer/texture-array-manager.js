import { Texture } from '../../platform/graphics/texture.js';
import { ADDRESS_REPEAT, FILTER_LINEAR, FILTER_LINEAR_MIPMAP_LINEAR, PIXELFORMAT_RGBA8 } from '../../platform/graphics/constants.js';

/**
 * @import { GraphicsDevice } from '../../platform/graphics/graphics-device.js'
 */

/**
 * Describes where a texture lives inside a texture array.
 *
 * @ignore
 */
class TextureArrayEntry {
    /** @type {number} - Index of the TextureArrayGroup this texture belongs to */
    arrayIndex;

    /** @type {number} - Layer within the texture array */
    layerIndex;

    /**
     * @param {number} arrayIndex - Array group index.
     * @param {number} layerIndex - Layer within the array.
     */
    constructor(arrayIndex, layerIndex) {
        this.arrayIndex = arrayIndex;
        this.layerIndex = layerIndex;
    }
}

/**
 * A group of textures with the same dimensions and format, packed into a texture_2d_array.
 *
 * @ignore
 */
class TextureArrayGroup {
    /** @type {number} */
    width;

    /** @type {number} */
    height;

    /** @type {number} */
    format;

    /** @type {Texture|null} */
    textureArray = null;

    /** @type {number} */
    layerCount = 0;

    /** @type {number} */
    capacity;

    /** @type {GraphicsDevice} */
    device;

    /**
     * @param {GraphicsDevice} device - Graphics device.
     * @param {number} width - Texture width.
     * @param {number} height - Texture height.
     * @param {number} format - Pixel format.
     * @param {number} [initialCapacity] - Initial layer capacity.
     */
    constructor(device, width, height, format, initialCapacity = 32) {
        this.device = device;
        this.width = width;
        this.height = height;
        this.format = format;
        this.capacity = initialCapacity;
        this._createTextureArray();
    }

    _createTextureArray() {
        this.textureArray?.destroy();
        this.textureArray = new Texture(this.device, {
            name: `TextureArray_${this.width}x${this.height}`,
            width: this.width,
            height: this.height,
            format: this.format,
            arrayLength: this.capacity,
            addressU: ADDRESS_REPEAT,
            addressV: ADDRESS_REPEAT,
            minFilter: FILTER_LINEAR,
            magFilter: FILTER_LINEAR,
            mipmaps: false
        });
    }

    /**
     * Add a texture to this array group. Returns the layer index.
     *
     * @param {Texture} texture - The source texture.
     * @returns {number} The layer index.
     */
    addTexture(texture) {
        if (this.layerCount >= this.capacity) {
            this._grow();
        }

        const layer = this.layerCount;
        this.layerCount++;

        // Copy pixel data from source texture into the array layer
        // This assumes the source texture has been uploaded and its pixels are available
        this._copyTextureToLayer(texture, layer);

        return layer;
    }

    /**
     * @param {Texture} src - Source texture.
     * @param {number} layer - Target layer.
     * @private
     */
    _copyTextureToLayer(src, layer) {
        // Use GPU copy if available via commandEncoder.copyTextureToTexture
        // For now, mark as needing update - the actual copy will happen when
        // the WebGPU command encoder is available
        const device = this.device;
        if (device.isWebGPU && src.impl && this.textureArray.impl) {
            // Schedule GPU-side copy from src texture to array layer
            const srcImpl = src.impl;
            const dstImpl = this.textureArray.impl;
            if (srcImpl.gpuTexture && dstImpl.gpuTexture) {
                const encoder = device.wgpu.createCommandEncoder();
                encoder.copyTextureToTexture(
                    { texture: srcImpl.gpuTexture, mipLevel: 0 },
                    { texture: dstImpl.gpuTexture, mipLevel: 0, origin: { x: 0, y: 0, z: layer } },
                    { width: this.width, height: this.height, depthOrArrayLayers: 1 }
                );
                device.wgpu.queue.submit([encoder.finish()]);
            }
        }
    }

    _grow() {
        const oldArray = this.textureArray;
        this.capacity *= 2;
        this._createTextureArray();

        // Copy existing layers from old array to new
        if (oldArray && oldArray.impl?.gpuTexture && this.textureArray.impl?.gpuTexture) {
            const device = this.device;
            const encoder = device.wgpu.createCommandEncoder();
            for (let i = 0; i < this.layerCount; i++) {
                encoder.copyTextureToTexture(
                    { texture: oldArray.impl.gpuTexture, mipLevel: 0, origin: { x: 0, y: 0, z: i } },
                    { texture: this.textureArray.impl.gpuTexture, mipLevel: 0, origin: { x: 0, y: 0, z: i } },
                    { width: this.width, height: this.height, depthOrArrayLayers: 1 }
                );
            }
            device.wgpu.queue.submit([encoder.finish()]);
            oldArray.destroy();
        }
    }

    destroy() {
        this.textureArray?.destroy();
        this.textureArray = null;
    }
}

/**
 * Manages texture arrays for GPU-driven rendering. Groups compatible textures
 * (same size and format) into texture_2d_array resources, enabling material
 * textures to be accessed via array index + layer index without per-material
 * bind group switches.
 *
 * @ignore
 */
class TextureArrayManager {
    /** @type {GraphicsDevice} */
    device;

    /**
     * Map from "width:height:format" key to TextureArrayGroup.
     *
     * @type {Map<string, TextureArrayGroup>}
     */
    groups = new Map();

    /**
     * Map from texture id to TextureArrayEntry.
     *
     * @type {Map<number, TextureArrayEntry>}
     */
    entries = new Map();

    /** @type {number} */
    nextArrayIndex = 0;

    /**
     * Map from arrayIndex to TextureArrayGroup for bind group setup.
     *
     * @type {Map<number, TextureArrayGroup>}
     */
    groupsByIndex = new Map();

    /**
     * @param {GraphicsDevice} device - The graphics device.
     */
    constructor(device) {
        this.device = device;
    }

    /**
     * Register a texture in the manager. Returns its array entry for shader lookup.
     *
     * @param {Texture} texture - The texture to register.
     * @returns {TextureArrayEntry|null} The entry, or null if the texture is incompatible.
     */
    addTexture(texture) {
        if (!texture || !texture.width || !texture.height) return null;

        // Already registered
        if (this.entries.has(texture.id)) {
            return this.entries.get(texture.id);
        }

        const key = `${texture.width}:${texture.height}:${texture.format}`;

        let group = this.groups.get(key);
        if (!group) {
            group = new TextureArrayGroup(
                this.device,
                texture.width,
                texture.height,
                texture.format || PIXELFORMAT_RGBA8
            );
            group._arrayIndex = this.nextArrayIndex++;
            this.groups.set(key, group);
            this.groupsByIndex.set(group._arrayIndex, group);
        }

        const layerIndex = group.addTexture(texture);
        const entry = new TextureArrayEntry(group._arrayIndex, layerIndex);
        this.entries.set(texture.id, entry);
        return entry;
    }

    /**
     * Get the texture array for a given array index.
     *
     * @param {number} arrayIndex - The array index.
     * @returns {Texture|null} The texture array.
     */
    getTextureArray(arrayIndex) {
        const group = this.groupsByIndex.get(arrayIndex);
        return group?.textureArray ?? null;
    }

    /**
     * Create a 1x1x1 white placeholder texture array for bind group stability.
     *
     * @returns {Texture} A minimal texture array.
     */
    createPlaceholder() {
        const tex = new Texture(this.device, {
            name: 'TextureArray_Placeholder',
            width: 1,
            height: 1,
            format: PIXELFORMAT_RGBA8,
            arrayLength: 1,
            mipmaps: false,
            minFilter: FILTER_LINEAR,
            magFilter: FILTER_LINEAR
        });
        const data = new Uint8Array([255, 255, 255, 255]);
        tex.lock().set(data);
        tex.unlock();
        return tex;
    }

    destroy() {
        for (const group of this.groups.values()) {
            group.destroy();
        }
        this.groups.clear();
        this.entries.clear();
        this.groupsByIndex.clear();
    }
}

export { TextureArrayManager, TextureArrayEntry };
