import { Compute } from '../../platform/graphics/compute.js';
import { Shader } from '../../platform/graphics/shader.js';
import { StorageBuffer } from '../../platform/graphics/storage-buffer.js';
import { UniformFormat, UniformBufferFormat } from '../../platform/graphics/uniform-buffer-format.js';
import { BindGroupFormat, BindUniformBufferFormat, BindStorageBufferFormat } from '../../platform/graphics/bind-group-format.js';
import {
    SHADERSTAGE_COMPUTE, SHADERLANGUAGE_WGSL,
    UNIFORMTYPE_VEC4, UNIFORMTYPE_UINT,
    BUFFERUSAGE_COPY_DST, BUFFERUSAGE_COPY_SRC
} from '../../platform/graphics/constants.js';
import { ShaderChunks } from '../shader-lib/shader-chunks.js';
import {
    SHADERDEF_SKIN, SHADERDEF_BATCH, SHADERDEF_INSTANCING
} from '../constants.js';

/**
 * @import { GraphicsDevice } from '../../platform/graphics/graphics-device.js'
 * @import { Camera } from '../camera.js'
 * @import { MeshInstance } from '../mesh-instance.js'
 * @import { GlobalTransformBuffer } from './global-transform-buffer.js'
 */

const FLOATS_PER_AABB = 4;     // center.xyz + radius
const UINTS_PER_META = 4;      // indexCount, firstIndex, baseVertex, transformSlot
const WORKGROUP_SIZE = 64;

/**
 * GPU frustum culling using a compute shader. Tests each object's bounding sphere
 * against the camera frustum and writes indirect draw args to the device's shared
 * indirect draw buffer, with instanceCount = 0 for culled objects.
 *
 * @ignore
 */
class GpuCulling {
    /** @type {GraphicsDevice} */
    device;

    /** @type {Shader|null} */
    shader = null;

    /** @type {Compute|null} */
    compute = null;

    /** @type {StorageBuffer|null} */
    aabbBuffer = null;

    /** @type {Float32Array} */
    aabbStaging;

    /** @type {StorageBuffer|null} */
    meshMetaBuffer = null;

    /** @type {Uint32Array} */
    meshMetaStaging;

    /** @type {Int32Array} */
    meshMetaStagingI32;

    /** @type {Float32Array} */
    frustumPlanesData = new Float32Array(24); // 6 planes × 4 floats

    /** @type {number} */
    capacity = 0;

    /** @type {number} */
    objectCount = 0;

    /**
     * Mapping from gpu cull index to the drawCall array index.
     *
     * @type {number[]}
     */
    indexMapping = [];

    /**
     * @param {GraphicsDevice} device - The graphics device.
     */
    constructor(device) {
        this.device = device;
        this._createComputeShader();
    }

    /** @private */
    _createComputeShader() {
        const device = this.device;
        const chunks = ShaderChunks.get(device, SHADERLANGUAGE_WGSL);

        this.shader = new Shader(device, {
            name: 'FrustumCullCompute',
            shaderLanguage: SHADERLANGUAGE_WGSL,
            cshader: chunks.get('frustumCullCS'),
            cincludes: chunks,

            computeUniformBufferFormats: {
                ub: new UniformBufferFormat(device, [
                    new UniformFormat('frustumPlanes', UNIFORMTYPE_VEC4, 6),
                    new UniformFormat('objectCount', UNIFORMTYPE_UINT),
                    new UniformFormat('indirectOffset', UNIFORMTYPE_UINT)
                ])
            },

            computeBindGroupFormat: new BindGroupFormat(device, [
                new BindUniformBufferFormat('ub', SHADERSTAGE_COMPUTE),
                new BindStorageBufferFormat('aabbData', SHADERSTAGE_COMPUTE, true),
                new BindStorageBufferFormat('meshMeta', SHADERSTAGE_COMPUTE, true),
                new BindStorageBufferFormat('indirectDrawBuffer', SHADERSTAGE_COMPUTE)
            ])
        });

        this.compute = new Compute(device, this.shader, 'FrustumCull');
    }

    /**
     * Ensure internal buffers can hold at least `count` objects.
     *
     * @param {number} count - Required capacity.
     * @private
     */
    ensureCapacity(count) {
        if (count <= this.capacity) return;

        // grow to next power of 2
        let newCap = this.capacity || 256;
        while (newCap < count) newCap *= 2;

        // AABB buffer (4 floats per object)
        this.aabbBuffer?.destroy();
        this.aabbStaging = new Float32Array(newCap * FLOATS_PER_AABB);
        this.aabbBuffer = new StorageBuffer(this.device, this.aabbStaging.byteLength, BUFFERUSAGE_COPY_DST | BUFFERUSAGE_COPY_SRC);

        // Mesh meta buffer (4 u32 per object)
        this.meshMetaBuffer?.destroy();
        const metaBytes = newCap * UINTS_PER_META * 4;
        this.meshMetaStaging = new Uint32Array(newCap * UINTS_PER_META);
        this.meshMetaStagingI32 = new Int32Array(this.meshMetaStaging.buffer);
        this.meshMetaBuffer = new StorageBuffer(this.device, metaBytes, BUFFERUSAGE_COPY_DST | BUFFERUSAGE_COPY_SRC);

        this.capacity = newCap;
    }

    /**
     * Check if a draw call is eligible for GPU culling.
     *
     * @param {MeshInstance} dc - The draw call.
     * @returns {boolean} True if eligible.
     * @private
     */
    isEligible(dc) {
        if (dc._skinInstance || dc.instancingData || dc.gsplatInstance) return false;
        if (dc._shaderDefs & (SHADERDEF_SKIN | SHADERDEF_BATCH | SHADERDEF_INSTANCING)) return false;
        if (dc.isVisibleFunc) return false;
        if (!dc.cull) return false;
        return true;
    }

    /**
     * Run GPU frustum culling for eligible draw calls in the given array. Uploads world
     * transforms, AABB, and mesh metadata, dispatches compute, and assigns indirect draw
     * slots to eligible draw calls.
     *
     * @param {MeshInstance[]} drawCalls - All draw calls for this render pass.
     * @param {Camera} camera - The camera for frustum extraction.
     * @param {GlobalTransformBuffer} globalTransformBuffer - The global transform buffer.
     */
    setup(drawCalls, camera, globalTransformBuffer) {
        const device = this.device;
        const count = drawCalls.length;

        // 1. Count eligible objects and populate staging buffers
        let gpuCount = 0;
        this.indexMapping.length = 0;

        // First pass: count eligible
        for (let i = 0; i < count; i++) {
            if (this.isEligible(drawCalls[i])) {
                gpuCount++;
            }
        }

        if (gpuCount === 0) {
            this.objectCount = 0;
            return;
        }

        this.ensureCapacity(gpuCount);

        // 2. Populate staging buffers
        let gi = 0; // gpu cull index
        for (let i = 0; i < count; i++) {
            const dc = drawCalls[i];
            if (!this.isEligible(dc)) continue;

            // Allocate a transform slot for this draw call (without changing _shaderDefs).
            // The slot is used internally by the compute shader metadata only.
            // We do NOT set SHADERDEF_GLOBAL_TRANSFORM_BUFFER — the vertex shader keeps
            // using the standard matrix_model uniform so that shadow, outline, post-process
            // and other non-forward passes continue to work correctly.
            let transformSlot = dc._globalTransformSlot;
            if (transformSlot < 0 && device.globalTransformBuffer) {
                transformSlot = device.globalTransformBuffer.allocateSlot();
                dc._globalTransformSlot = transformSlot;
            }

            // Upload world transform to staging buffer
            const worldMat = dc.node.getWorldTransform();
            globalTransformBuffer.updateSlot(transformSlot, worldMat.data);

            // AABB: use world-space bounding sphere (same as CPU _isVisible)
            const aabb = dc.aabb; // triggers world-space AABB computation
            const center = aabb.center;
            const radius = aabb.halfExtents.length();
            const ao = gi * FLOATS_PER_AABB;
            this.aabbStaging[ao + 0] = center.x;
            this.aabbStaging[ao + 1] = center.y;
            this.aabbStaging[ao + 2] = center.z;
            this.aabbStaging[ao + 3] = radius;

            // Mesh metadata
            const meshInfo = dc.getIndirectMetaData();
            const mo = gi * UINTS_PER_META;
            this.meshMetaStaging[mo + 0] = meshInfo[0]; // indexCount
            this.meshMetaStaging[mo + 1] = meshInfo[1]; // firstIndex
            this.meshMetaStagingI32[mo + 2] = meshInfo[2]; // baseVertex (signed)
            this.meshMetaStaging[mo + 3] = transformSlot; // transformSlot

            this.indexMapping.push(i);
            gi++;
        }

        this.objectCount = gi;

        // 3. Upload staging data to GPU
        this.aabbBuffer.write(0, this.aabbStaging, 0, gi * FLOATS_PER_AABB);
        this.meshMetaBuffer.write(0, this.meshMetaStaging, 0, gi * UINTS_PER_META);
        // Note: globalTransformBuffer.upload() is called by the caller (renderForward)
        // after setup() to avoid redundant uploads across multiple layer/transparency passes

        // 4. Allocate consecutive indirect draw slots (skip if insufficient capacity)
        const remaining = device.maxIndirectDrawCount - (device._indirectDrawNextIndex ?? 0);
        if (gi > remaining) {
            this.objectCount = 0;
            return;
        }
        const baseSlot = device.getIndirectDrawSlot(gi);

        // 5. Extract frustum planes
        const planes = camera.frustum.planes;
        for (let p = 0; p < 6; p++) {
            const plane = planes[p];
            this.frustumPlanesData[p * 4 + 0] = plane.normal.x;
            this.frustumPlanesData[p * 4 + 1] = plane.normal.y;
            this.frustumPlanesData[p * 4 + 2] = plane.normal.z;
            this.frustumPlanesData[p * 4 + 3] = plane.distance;
        }

        // 6. Set compute parameters
        this.compute.setParameter('frustumPlanes[0]', this.frustumPlanesData);
        this.compute.setParameter('objectCount', gi);
        this.compute.setParameter('indirectOffset', baseSlot);
        this.compute.setParameter('aabbData', this.aabbBuffer);
        this.compute.setParameter('meshMeta', this.meshMetaBuffer);
        this.compute.setParameter('indirectDrawBuffer', device.indirectDrawBuffer);

        // 7. Dispatch compute shader
        const workgroupCount = Math.ceil(gi / WORKGROUP_SIZE);
        this.compute.setupDispatch(workgroupCount);
        device.computeDispatch([this.compute], 'FrustumCull');

        // 8. Assign indirect draw slots to eligible draw calls
        // DEBUG: Skip setIndirect to diagnose if indirect draw path causes invisible objects.
        // Compute shader runs but results are not used — normal drawIndexed path used instead.
        // for (let j = 0; j < gi; j++) {
        //     const dcIndex = this.indexMapping[j];
        //     const dc = drawCalls[dcIndex];
        //     dc.setIndirect(camera, baseSlot + j);
        // }
    }

    destroy() {
        this.aabbBuffer?.destroy();
        this.aabbBuffer = null;
        this.meshMetaBuffer?.destroy();
        this.meshMetaBuffer = null;
        this.compute = null;
        this.shader = null;
    }
}

export { GpuCulling };
