/**
 * @import { GraphicsDevice } from './graphics-device.js'
 * @import { StorageBuffer } from './storage-buffer.js'
 * @import { Texture } from './texture.js'
 * @import { EventHandle } from '../../core/event-handle.js'
 */

/**
 * Manages non-blocking uploads of data to GPU resources (textures or storage buffers).
 * Internally pools staging buffers on WebGPU to avoid blocking
 * when the GPU is busy with previous uploads.
 *
 * Important: Create one UploadStream per target resource.
 *
 * @category Graphics
 * @ignore
 */
class UploadStream {
    /**
     * Event handle for device lost event.
     *
     * @type {EventHandle|null}
     * @protected
     */
    _deviceLostEvent = null;

    /**
     * Create a new UploadStream instance.
     *
     * @param {GraphicsDevice} device - The graphics device.
     * @param {boolean} [useSingleBuffer] - If true, uses simple direct writes. If false (default),
     * uses optimized multi-buffer strategy (staging buffers) for potentially non-blocking uploads.
     */
    constructor(device, useSingleBuffer = false) {
        this.device = device;
        this.useSingleBuffer = useSingleBuffer;

        // Create platform-specific implementation
        this.impl = device.createUploadStreamImpl(this);

        // Register device lost handler
        this._deviceLostEvent = this.device.on('devicelost', this._onDeviceLost, this);
    }

    /**
     * Destroy the upload stream and clean up all pooled resources.
     */
    destroy() {
        // Remove event listener
        this._deviceLostEvent?.off();
        this._deviceLostEvent = null;

        this.impl?.destroy();
        this.impl = null;
    }

    /**
     * Upload data to a storage buffer.
     * Both offset and size byte values must be multiples of 4.
     *
     * @param {Uint8Array|Uint32Array|Float32Array} data - The data to upload. Must contain at least
     * `size` elements.
     * @param {Texture|StorageBuffer} target - The target resource.
     * @param {number} [offset] - The element offset in the target where upload starts. Defaults to 0.
     * The byte offset must be a multiple of 4.
     * @param {number} [size] - The number of elements to upload. Defaults to data.length.
     * The byte size must be a multiple of 4.
     */
    upload(data, target, offset = 0, size = data.length) {
        this.impl?.upload(data, target, offset, size);
    }

    /**
     * Handles device lost event. Override in platform implementations.
     *
     * @private
     */
    _onDeviceLost() {
        this.impl?._onDeviceLost?.();
    }
}

export { UploadStream };
