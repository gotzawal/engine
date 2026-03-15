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
 * argument buffer containing only visible draws, organized by pipeline group.
 *
 * Uses per-group atomic counters + per-group output regions so that draws within
 * the same pipeline group are contiguous in the output buffer.
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

    /** @type {StorageBuffer|null} - per-group atomic counters */
    groupCountsBuffer = null;

    /** @type {StorageBuffer|null} - per-group output base offsets */
    groupBaseOffsetsBuffer = null;

    /** @type {Uint32Array|null} - CPU-side cache of group base offsets */
    _groupBaseOffsets = null;

    /** @type {number} */
    maxGroups = 256;

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

        // Per-group atomic counters
        this.groupCountsBuffer?.destroy();
        this.groupCountsBuffer = new StorageBuffer(
            this.device, this.maxGroups * 4,
            BUFFERUSAGE_COPY_SRC | BUFFERUSAGE_COPY_DST
        );

        // Per-group output base offsets (read-only in compute)
        this.groupBaseOffsetsBuffer?.destroy();
        this.groupBaseOffsetsBuffer = new StorageBuffer(
            this.device, this.maxGroups * 4,
            BUFFERUSAGE_COPY_SRC | BUFFERUSAGE_COPY_DST
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
                    new UniformFormat('totalDrawCount', UNIFORMTYPE_UINT),
                    new UniformFormat('groupCount', UNIFORMTYPE_UINT)
                ])
            },
            computeBindGroupFormat: new BindGroupFormat(device, [
                new BindUniformBufferFormat('ub', SHADERSTAGE_COMPUTE),
                new BindStorageBufferFormat('drawInstances', SHADERSTAGE_COMPUTE, true),
                new BindStorageBufferFormat('boundingSpheres', SHADERSTAGE_COMPUTE, true),
                new BindStorageBufferFormat('compactedDrawArgs', SHADERSTAGE_COMPUTE, false),
                new BindStorageBufferFormat('groupCounts', SHADERSTAGE_COMPUTE, false),
                new BindStorageBufferFormat('groupBaseOffsets', SHADERSTAGE_COMPUTE, true)
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
     * Upload per-group base offsets to GPU. Each group's output region starts at the
     * cumulative sum of all previous groups' counts (max capacity per group).
     *
     * @param {Array<{count: number}>} pipelineGroups - Pipeline groups with count fields.
     */
    uploadGroupBaseOffsets(pipelineGroups) {
        const data = new Uint32Array(pipelineGroups.length);
        let offset = 0;
        for (let g = 0; g < pipelineGroups.length; g++) {
            data[g] = offset;
            offset += pipelineGroups[g].count; // max capacity for this group
        }
        this.groupBaseOffsetsBuffer.write(0, data, 0, pipelineGroups.length);
        this._groupBaseOffsets = data;
    }

    /**
     * Dispatch the compute shader to cull and compact draw calls per pipeline group.
     *
     * @param {Camera} camera - The camera for frustum planes.
     * @param {import('./draw-instance-buffer.js').DrawInstanceBuffer} drawInstanceBuffer - Input draw instances.
     * @param {StorageBuffer} boundingSphereBuffer - Bounding sphere data.
     * @param {number} [groupCount] - Number of pipeline groups.
     */
    dispatch(camera, drawInstanceBuffer, boundingSphereBuffer, groupCount = 1) {
        const totalDrawCount = drawInstanceBuffer.count;
        if (totalDrawCount === 0) return;

        this.ensureCapacity(totalDrawCount);

        // Zero-clear compacted draw args: unused slots = {indexCount=0, instanceCount=0} -> draw no-op
        this.compactedDrawArgsBuffer.clear(0, this.capacity * BYTES_PER_INDIRECT_ENTRY);
        // Zero-clear per-group atomic counters
        this.groupCountsBuffer.clear(0, groupCount * 4);

        this.extractFrustumPlanes(camera);

        const compute = this.compute;
        compute.setParameter('frustumPlanes[0]', this.frustumPlanesData);
        compute.setParameter('totalDrawCount', totalDrawCount);
        compute.setParameter('groupCount', groupCount);
        compute.setParameter('drawInstances', drawInstanceBuffer.storageBuffer);
        compute.setParameter('boundingSpheres', boundingSphereBuffer);
        compute.setParameter('compactedDrawArgs', this.compactedDrawArgsBuffer);
        compute.setParameter('groupCounts', this.groupCountsBuffer);
        compute.setParameter('groupBaseOffsets', this.groupBaseOffsetsBuffer);

        const workgroups = Math.ceil(totalDrawCount / 64);
        compute.setupDispatch(workgroups);
        this.device.computeDispatch([compute], 'DrawCompact');
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

    destroy() {
        this.compactedDrawArgsBuffer?.destroy();
        this.drawCountBuffer?.destroy();
        this.drawCountReadbackBuffer?.destroy();
        this.groupCountsBuffer?.destroy();
        this.groupBaseOffsetsBuffer?.destroy();
        this.compactedDrawArgsBuffer = null;
        this.drawCountBuffer = null;
        this.drawCountReadbackBuffer = null;
        this.groupCountsBuffer = null;
        this.groupBaseOffsetsBuffer = null;
    }
}

export { GpuDrawCompactor };
