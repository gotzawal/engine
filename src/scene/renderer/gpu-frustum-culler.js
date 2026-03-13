import { Compute } from '../../platform/graphics/compute.js';
import { Shader } from '../../platform/graphics/shader.js';
import { StorageBuffer } from '../../platform/graphics/storage-buffer.js';
import {
    SHADERLANGUAGE_WGSL, SHADERSTAGE_COMPUTE,
    BUFFERUSAGE_COPY_DST,
    UNIFORMTYPE_VEC4, UNIFORMTYPE_UINT
} from '../../platform/graphics/constants.js';
import { BindGroupFormat, BindUniformBufferFormat, BindStorageBufferFormat } from '../../platform/graphics/bind-group-format.js';
import { UniformBufferFormat, UniformFormat } from '../../platform/graphics/uniform-buffer-format.js';
import { ShaderChunks } from '../shader-lib/shader-chunks.js';
import frustumCullWGSL from '../shader-lib/wgsl/chunks/common/comp/frustum-cull.js';

const FLOATS_PER_SPHERE = 4; // vec4f(center.xyz, radius)
const BYTES_PER_SPHERE = 16;

/**
 * GPU frustum culler using a compute shader to zero instanceCount on culled indirect draw entries.
 *
 * @ignore
 */
class GpuFrustumCuller {
    /** @type {import('../../platform/graphics/graphics-device.js').GraphicsDevice} */
    device;

    /** @type {Compute|null} */
    compute = null;

    /** @type {StorageBuffer|null} */
    boundingSphereBuffer = null;

    /** @type {Float32Array|null} */
    boundingSphereStagingBuffer = null;

    /** @type {number} */
    capacity;

    /** @type {Float32Array} */
    frustumPlanesData = new Float32Array(24); // 6 planes × vec4f

    /** @type {boolean} */
    dirty = false;

    /** @type {number} */
    indirectStartSlot = 0;

    /** @type {number} */
    indirectDrawCount = 0;

    constructor(device, initialCapacity = 4096) {
        this.device = device;
        this.capacity = initialCapacity;
        this._createBuffers(initialCapacity);
        this._createComputeShader();
    }

    _createBuffers(capacity) {
        this.boundingSphereStagingBuffer = new Float32Array(capacity * FLOATS_PER_SPHERE);
        this.boundingSphereBuffer?.destroy();
        this.boundingSphereBuffer = new StorageBuffer(
            this.device, capacity * BYTES_PER_SPHERE, BUFFERUSAGE_COPY_DST
        );
    }

    _createComputeShader() {
        const device = this.device;
        const shader = new Shader(device, {
            name: 'FrustumCullCompute',
            shaderLanguage: SHADERLANGUAGE_WGSL,
            cshader: frustumCullWGSL,
            cincludes: ShaderChunks.get(device, SHADERLANGUAGE_WGSL),
            computeUniformBufferFormats: {
                ub: new UniformBufferFormat(device, [
                    new UniformFormat('frustumPlanes[0]', UNIFORMTYPE_VEC4, 6),
                    new UniformFormat('drawCount', UNIFORMTYPE_UINT),
                    new UniformFormat('indirectStartSlot', UNIFORMTYPE_UINT)
                ])
            },
            computeBindGroupFormat: new BindGroupFormat(device, [
                new BindUniformBufferFormat('ub', SHADERSTAGE_COMPUTE),
                new BindStorageBufferFormat('boundingSpheres', SHADERSTAGE_COMPUTE, true),
                new BindStorageBufferFormat('indirectDrawBuffer', SHADERSTAGE_COMPUTE, false)
            ])
        });
        this.compute = new Compute(device, shader, 'FrustumCull');
    }

    /**
     * Resize bounding sphere buffers.
     *
     * @param {number} newCapacity - New capacity in number of spheres.
     */
    resize(newCapacity) {
        const oldStaging = this.boundingSphereStagingBuffer;
        this.capacity = newCapacity;
        this._createBuffers(newCapacity);
        if (oldStaging) {
            this.boundingSphereStagingBuffer.set(oldStaging);
        }
    }

    /**
     * Update a bounding sphere at the given slot.
     *
     * @param {number} slot - The slot index (same as transform slot).
     * @param {number} cx - Center X (world space).
     * @param {number} cy - Center Y (world space).
     * @param {number} cz - Center Z (world space).
     * @param {number} radius - Bounding sphere radius.
     */
    updateSphere(slot, cx, cy, cz, radius) {
        if (slot >= this.capacity) {
            this.resize(Math.max(this.capacity * 2, slot + 1));
        }
        const offset = slot * FLOATS_PER_SPHERE;
        this.boundingSphereStagingBuffer[offset] = cx;
        this.boundingSphereStagingBuffer[offset + 1] = cy;
        this.boundingSphereStagingBuffer[offset + 2] = cz;
        this.boundingSphereStagingBuffer[offset + 3] = radius;
        this.dirty = true;
    }

    /**
     * Upload bounding sphere staging buffer to GPU.
     *
     * @param {number} usedSlots - Number of slots used (uploads [0, usedSlots)).
     */
    uploadSpheres(usedSlots) {
        if (this.dirty && usedSlots > 0) {
            this.boundingSphereBuffer.write(
                0, this.boundingSphereStagingBuffer, 0, usedSlots * FLOATS_PER_SPHERE
            );
            this.dirty = false;
        }
    }

    /**
     * Extract camera frustum planes into a flat Float32Array (6 × vec4f).
     *
     * @param {import('../../scene/camera.js').Camera} camera - The camera.
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
     * Dispatch GPU frustum culling compute shader.
     * Zeroes instanceCount on indirect draw entries for objects outside the frustum.
     *
     * @param {import('../../scene/camera.js').Camera} camera - The camera for frustum planes.
     */
    dispatch(camera) {
        if (this.indirectDrawCount === 0) return;

        this.extractFrustumPlanes(camera);

        const compute = this.compute;
        compute.setParameter('frustumPlanes[0]', this.frustumPlanesData);
        compute.setParameter('drawCount', this.indirectDrawCount);
        compute.setParameter('indirectStartSlot', this.indirectStartSlot);
        compute.setParameter('boundingSpheres', this.boundingSphereBuffer);
        compute.setParameter('indirectDrawBuffer', this.device.indirectDrawBuffer);

        const workgroups = Math.ceil(this.indirectDrawCount / 64);
        compute.setupDispatch(workgroups);
        this.device.computeDispatch([compute], 'FrustumCull');
    }

    destroy() {
        this.boundingSphereBuffer?.destroy();
        this.boundingSphereBuffer = null;
        this.boundingSphereStagingBuffer = null;
    }
}

export { GpuFrustumCuller };
