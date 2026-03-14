import { Compute } from '../../platform/graphics/compute.js';
import { Shader } from '../../platform/graphics/shader.js';
import { StorageBuffer } from '../../platform/graphics/storage-buffer.js';
import {
    SHADERLANGUAGE_WGSL, SHADERSTAGE_COMPUTE,
    BUFFERUSAGE_COPY_DST, BUFFERUSAGE_COPY_SRC, BUFFERUSAGE_INDIRECT,
    UNIFORMTYPE_VEC4, UNIFORMTYPE_UINT
} from '../../platform/graphics/constants.js';
import { BindGroupFormat, BindUniformBufferFormat, BindStorageBufferFormat } from '../../platform/graphics/bind-group-format.js';
import { UniformBufferFormat, UniformFormat } from '../../platform/graphics/uniform-buffer-format.js';
import { ShaderChunks } from '../shader-lib/shader-chunks.js';
import drawCompactWGSL from '../shader-lib/wgsl/chunks/common/comp/draw-compact.js';

/**
 * @import { GraphicsDevice } from '../../platform/graphics/graphics-device.js'
 * @import { Camera } from '../camera.js'
 */

const BYTES_PER_INDIRECT_ENTRY = 20; // 5 × u32

/**
 * GPU draw compactor. Takes the DrawInstanceBuffer + bounding spheres as input,
 * performs frustum culling on the GPU, and outputs a compacted DrawIndexedIndirect
 * argument buffer containing only visible draws.
 *
 * Uses atomic append for compaction (efficient for 1K-10K objects).
 *
 * @ignore
 */
class GpuDrawCompactor {
    /** @type {GraphicsDevice} */
    device;

    /** @type {Compute|null} */
    compute = null;

    /** @type {StorageBuffer|null} - compacted indirect draw args output */
    compactedDrawArgsBuffer = null;

    /** @type {StorageBuffer|null} - atomic draw count output (single u32) */
    drawCountBuffer = null;

    /** @type {StorageBuffer|null} - staging buffer for reading back draw count */
    drawCountReadbackBuffer = null;

    /** @type {number} */
    capacity;

    /** @type {Float32Array} */
    frustumPlanesData = new Float32Array(24); // 6 planes × vec4f

    /** @type {number} - draw count from previous frame (used as upper bound) */
    lastFrameDrawCount = 0;

    /** @type {boolean} - true after first frame (need 1 frame delay for readback) */
    hasValidDrawCount = false;

    /**
     * @param {GraphicsDevice} device - The graphics device.
     * @param {number} [initialCapacity] - Max number of draw calls.
     */
    constructor(device, initialCapacity = 4096) {
        this.device = device;
        this.capacity = initialCapacity;
        this._createBuffers(initialCapacity);
        this._createComputeShader();
    }

    _createBuffers(capacity) {
        this.compactedDrawArgsBuffer?.destroy();
        this.drawCountBuffer?.destroy();
        this.drawCountReadbackBuffer?.destroy();

        // Output: compacted DrawIndexedIndirect args (5 × u32 each)
        this.compactedDrawArgsBuffer = new StorageBuffer(
            this.device,
            capacity * BYTES_PER_INDIRECT_ENTRY,
            BUFFERUSAGE_INDIRECT | BUFFERUSAGE_COPY_SRC | BUFFERUSAGE_COPY_DST
        );

        // Output: atomic draw count (single u32, 4 bytes with padding to 16 for alignment)
        this.drawCountBuffer = new StorageBuffer(
            this.device, 16,
            BUFFERUSAGE_COPY_SRC | BUFFERUSAGE_COPY_DST
        );

        // Readback staging buffer for draw count
        this.drawCountReadbackBuffer = new StorageBuffer(
            this.device, 16,
            BUFFERUSAGE_COPY_DST, false // no storage usage, just for readback
        );
    }

    _createComputeShader() {
        const device = this.device;
        const shader = new Shader(device, {
            name: 'DrawCompactCompute',
            shaderLanguage: SHADERLANGUAGE_WGSL,
            cshader: drawCompactWGSL,
            cincludes: ShaderChunks.get(device, SHADERLANGUAGE_WGSL),
            computeUniformBufferFormats: {
                ub: new UniformBufferFormat(device, [
                    new UniformFormat('frustumPlanes[0]', UNIFORMTYPE_VEC4, 6),
                    new UniformFormat('totalDrawCount', UNIFORMTYPE_UINT)
                ])
            },
            computeBindGroupFormat: new BindGroupFormat(device, [
                new BindUniformBufferFormat('ub', SHADERSTAGE_COMPUTE),
                new BindStorageBufferFormat('drawInstances', SHADERSTAGE_COMPUTE, true),
                new BindStorageBufferFormat('boundingSpheres', SHADERSTAGE_COMPUTE, true),
                new BindStorageBufferFormat('compactedDrawArgs', SHADERSTAGE_COMPUTE, false),
                new BindStorageBufferFormat('drawCount', SHADERSTAGE_COMPUTE, false)
            ])
        });
        this.compute = new Compute(device, shader, 'DrawCompact');
    }

    /**
     * Grow buffers if needed.
     *
     * @param {number} needed - Number of draw instances.
     */
    ensureCapacity(needed) {
        if (needed > this.capacity) {
            let newCap = this.capacity;
            while (newCap < needed) newCap *= 2;
            this.capacity = newCap;
            this._createBuffers(newCap);
        }
    }

    /**
     * Extract camera frustum planes.
     *
     * @param {Camera} camera - The camera.
     */
    extractFrustumPlanes(camera) {
        const planes = camera.frustum.planes;
        for (let i = 0; i < 6; i++) {
            const p = planes[i];
            this.frustumPlanesData[i * 4] = p.normal.x;
            this.frustumPlanesData[i * 4 + 1] = p.normal.y;
            this.frustumPlanesData[i * 4 + 2] = p.normal.z;
            this.frustumPlanesData[i * 4 + 3] = p.distance;
        }
    }

    /**
     * Dispatch the compute shader to cull and compact draw calls.
     *
     * @param {Camera} camera - The camera for frustum planes.
     * @param {import('./draw-instance-buffer.js').DrawInstanceBuffer} drawInstanceBuffer - Input draw instances.
     * @param {StorageBuffer} boundingSphereBuffer - Bounding sphere data.
     */
    dispatch(camera, drawInstanceBuffer, boundingSphereBuffer) {
        const totalDrawCount = drawInstanceBuffer.count;
        if (totalDrawCount === 0) return;

        this.ensureCapacity(totalDrawCount);

        // Clear atomic counter to 0
        this.drawCountBuffer.clear(0, 4);

        this.extractFrustumPlanes(camera);

        const compute = this.compute;
        compute.setParameter('frustumPlanes[0]', this.frustumPlanesData);
        compute.setParameter('totalDrawCount', totalDrawCount);
        compute.setParameter('drawInstances', drawInstanceBuffer.storageBuffer);
        compute.setParameter('boundingSpheres', boundingSphereBuffer);
        compute.setParameter('compactedDrawArgs', this.compactedDrawArgsBuffer);
        compute.setParameter('drawCount', this.drawCountBuffer);

        const workgroups = Math.ceil(totalDrawCount / 64);
        compute.setupDispatch(workgroups);
        this.device.computeDispatch([compute], 'DrawCompact');

        // Schedule readback of draw count for next frame (2-frame scheme)
        // For the current frame, use lastFrameDrawCount as upper bound.
        // The GPU culler guarantees invisible draws are no-ops (instanceCount=0).
        this._scheduleDrawCountReadback(totalDrawCount);
    }

    /**
     * Get the number of compacted draws to render. Uses the previous frame's readback
     * for the first valid frame, then falls back to totalDrawCount.
     *
     * @param {number} totalDrawCount - Total draw instances submitted.
     * @returns {number} Number of indirect draws to issue.
     */
    getDrawCount(totalDrawCount) {
        if (this.hasValidDrawCount) {
            return this.lastFrameDrawCount;
        }
        // First frame: draw everything (some will be no-ops with instanceCount=0)
        return totalDrawCount;
    }

    /**
     * @param {number} totalDrawCount - Fallback count.
     * @private
     */
    _scheduleDrawCountReadback(totalDrawCount) {
        // Copy draw count from GPU to readback buffer
        this.drawCountReadbackBuffer.copy(this.drawCountBuffer, 0, 0, 4);

        // Read back asynchronously
        this.drawCountReadbackBuffer.read(0, 4, null, false).then((data) => {
            if (data) {
                const count = new Uint32Array(data.buffer || data)[0];
                this.lastFrameDrawCount = count;
                this.hasValidDrawCount = true;
            }
        }).catch(() => {
            // Readback failed, use total count
            this.lastFrameDrawCount = totalDrawCount;
        });
    }

    destroy() {
        this.compactedDrawArgsBuffer?.destroy();
        this.drawCountBuffer?.destroy();
        this.drawCountReadbackBuffer?.destroy();
        this.compactedDrawArgsBuffer = null;
        this.drawCountBuffer = null;
        this.drawCountReadbackBuffer = null;
    }
}

export { GpuDrawCompactor };
