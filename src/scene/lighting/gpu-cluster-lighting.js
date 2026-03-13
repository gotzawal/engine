import { Compute } from '../../platform/graphics/compute.js';
import { Shader } from '../../platform/graphics/shader.js';
import { StorageBuffer } from '../../platform/graphics/storage-buffer.js';
import {
    SHADERLANGUAGE_WGSL, SHADERSTAGE_COMPUTE,
    BUFFERUSAGE_COPY_DST, BUFFERUSAGE_COPY_SRC,
    UNIFORMTYPE_UINT, UNIFORMTYPE_FLOAT, UNIFORMTYPE_MAT4
} from '../../platform/graphics/constants.js';
import { BindGroupFormat, BindUniformBufferFormat, BindStorageBufferFormat } from '../../platform/graphics/bind-group-format.js';
import { UniformBufferFormat, UniformFormat } from '../../platform/graphics/uniform-buffer-format.js';
import { Vec3 } from '../../core/math/vec3.js';
import { Mat4 } from '../../core/math/mat4.js';
import { LIGHTTYPE_DIRECTIONAL, LIGHTTYPE_SPOT, MASK_AFFECT_DYNAMIC, MASK_AFFECT_LIGHTMAPPED } from '../constants.js';
import { LightsBuffer } from './lights-buffer.js';
import clusterBoundsWGSL from '../shader-lib/wgsl/chunks/common/comp/cluster-bounds.js';
import clusterLightingWGSL from '../shader-lib/wgsl/chunks/common/comp/cluster-lighting.js';

/**
 * @import { GraphicsDevice } from '../../platform/graphics/graphics-device.js'
 * @import { Camera } from '../camera.js'
 * @import { Light } from '../light.js'
 */

const DEFAULT_TILE_PIXEL_SIZE = 64;
const DEFAULT_NUM_SLICES_Z = 24;
const MAX_LIGHTS = 4096;
const MAX_LIGHTS_PER_CLUSTER = 128;
// Maximum light indices: totalClusters * maxLightsPerCluster (conservative upper bound)
const MAX_LIGHT_INDICES = 512 * 1024;

const tempInvProjMat = new Mat4();
const tempViewMat = new Mat4();
const tempVec3 = new Vec3();

/**
 * GPU compute-based clustered lighting. Replaces CPU WorldClusters with two compute passes:
 * 1. ClusterBounds: Computes view-space AABBs for each cluster (runs when camera changes)
 * 2. ClusterLighting: Assigns lights to clusters via sphere-AABB intersection tests
 *
 * @ignore
 */
class GpuClusterLighting {
    /** @type {GraphicsDevice} */
    device;

    /** @type {LightsBuffer} */
    lightsBuffer;

    // Cluster grid parameters
    /** @type {number} */
    numTilesX = 0;

    /** @type {number} */
    numTilesY = 0;

    /** @type {number} */
    numSlicesZ = DEFAULT_NUM_SLICES_Z;

    /** @type {number} */
    tilePixelSize = DEFAULT_TILE_PIXEL_SIZE;

    /** @type {number} */
    totalClusters = 0;

    // GPU buffers
    /** @type {StorageBuffer|null} */
    clusterAABBBuffer = null;

    /** @type {StorageBuffer|null} */
    lightVolumeBuffer = null;

    /** @type {StorageBuffer|null} */
    lightGridBuffer = null;

    /** @type {StorageBuffer|null} */
    lightIndicesBuffer = null;

    /** @type {StorageBuffer|null} */
    globalCounterBuffer = null;

    // Compute shaders
    /** @type {Compute|null} */
    boundsCompute = null;

    /** @type {Compute|null} */
    lightingCompute = null;

    // Light data staging
    /** @type {Float32Array|null} */
    lightVolumeStagingData = null;

    /** @type {number} */
    activeLightCount = 0;

    // Camera tracking for bounds recomputation
    /** @type {number} */
    _lastCameraNear = -1;

    /** @type {number} */
    _lastCameraFar = -1;

    /** @type {number} */
    _lastScreenWidth = -1;

    /** @type {number} */
    _lastScreenHeight = -1;

    // Scope IDs for forward shader uniforms
    _lightGridId = null;

    _lightIndicesId = null;

    _lightsStorageId = null;

    _gpuClusterConfigId = null;

    /**
     * @param {GraphicsDevice} device - The graphics device.
     */
    constructor(device) {
        this.device = device;
        this.lightsBuffer = new LightsBuffer(device);

        // Allocate light volume staging buffer (position+range + direction+angle per light)
        this.lightVolumeStagingData = new Float32Array(MAX_LIGHTS * 8); // 2 vec4f per light

        this._createComputeShaders();
        this._registerUniforms();
    }

    _registerUniforms() {
        const scope = this.device.scope;
        this._lightGridId = scope.resolve('gpuLightGrid');
        this._lightIndicesId = scope.resolve('gpuLightIndices');
        this._lightsStorageId = scope.resolve('gpuLightsData');
        this._gpuClusterNumTilesXId = scope.resolve('gpuClusterNumTilesX');
        this._gpuClusterNumTilesYId = scope.resolve('gpuClusterNumTilesY');
        this._gpuClusterNumSlicesZId = scope.resolve('gpuClusterNumSlicesZ');
        this._gpuClusterCameraNearId = scope.resolve('gpuClusterCameraNear');
        this._gpuClusterCameraFarId = scope.resolve('gpuClusterCameraFar');
        this._gpuClusterViewMatId = scope.resolve('gpuClusterViewMat');
        this._gpuClusterScreenSizeId = scope.resolve('gpuClusterScreenSize');
        this._gpuClusterTilePixelSizeId = scope.resolve('gpuClusterTilePixelSize');
    }

    _createComputeShaders() {
        const device = this.device;

        // --- ClusterBounds compute shader ---
        const boundsShader = new Shader(device, {
            name: 'ClusterBoundsCompute',
            shaderLanguage: SHADERLANGUAGE_WGSL,
            cshader: clusterBoundsWGSL,
            computeUniformBufferFormats: {
                config: new UniformBufferFormat(device, [
                    new UniformFormat('numTilesX', UNIFORMTYPE_UINT),
                    new UniformFormat('numTilesY', UNIFORMTYPE_UINT),
                    new UniformFormat('numSlicesZ', UNIFORMTYPE_UINT),
                    new UniformFormat('tilePixelSize', UNIFORMTYPE_UINT),
                    new UniformFormat('cameraNear', UNIFORMTYPE_FLOAT),
                    new UniformFormat('cameraFar', UNIFORMTYPE_FLOAT),
                    new UniformFormat('screenWidth', UNIFORMTYPE_FLOAT),
                    new UniformFormat('screenHeight', UNIFORMTYPE_FLOAT),
                    new UniformFormat('invProjectionMat', UNIFORMTYPE_MAT4)
                ])
            },
            computeBindGroupFormat: new BindGroupFormat(device, [
                new BindUniformBufferFormat('config', SHADERSTAGE_COMPUTE),
                new BindStorageBufferFormat('clusterAABBs', SHADERSTAGE_COMPUTE, false)
            ])
        });
        this.boundsCompute = new Compute(device, boundsShader, 'ClusterBounds');

        // --- ClusterLighting compute shader ---
        const lightingShader = new Shader(device, {
            name: 'ClusterLightingCompute',
            shaderLanguage: SHADERLANGUAGE_WGSL,
            cshader: clusterLightingWGSL,
            computeUniformBufferFormats: {
                config: new UniformBufferFormat(device, [
                    new UniformFormat('numTilesX', UNIFORMTYPE_UINT),
                    new UniformFormat('numTilesY', UNIFORMTYPE_UINT),
                    new UniformFormat('numSlicesZ', UNIFORMTYPE_UINT),
                    new UniformFormat('lightCount', UNIFORMTYPE_UINT),
                    new UniformFormat('maxLightsPerCluster', UNIFORMTYPE_UINT)
                ])
            },
            computeBindGroupFormat: new BindGroupFormat(device, [
                new BindUniformBufferFormat('config', SHADERSTAGE_COMPUTE),
                new BindStorageBufferFormat('clusterAABBs', SHADERSTAGE_COMPUTE, true),
                new BindStorageBufferFormat('lightVolumes', SHADERSTAGE_COMPUTE, true),
                new BindStorageBufferFormat('lightGrid', SHADERSTAGE_COMPUTE, false),
                new BindStorageBufferFormat('lightIndices', SHADERSTAGE_COMPUTE, false),
                new BindStorageBufferFormat('globalCounter', SHADERSTAGE_COMPUTE, false)
            ])
        });
        this.lightingCompute = new Compute(device, lightingShader, 'ClusterLighting');
    }

    /**
     * Update cluster grid configuration based on camera and screen dimensions.
     *
     * @param {Camera} camera - The camera.
     * @param {number} screenWidth - Screen width in pixels.
     * @param {number} screenHeight - Screen height in pixels.
     * @returns {boolean} True if the grid configuration changed and bounds need recomputation.
     */
    updateConfig(camera, screenWidth, screenHeight) {
        const near = camera._nearClip;
        const far = camera._farClip;

        const newTilesX = Math.ceil(screenWidth / this.tilePixelSize);
        const newTilesY = Math.ceil(screenHeight / this.tilePixelSize);

        const changed = (
            this.numTilesX !== newTilesX ||
            this.numTilesY !== newTilesY ||
            this._lastCameraNear !== near ||
            this._lastCameraFar !== far ||
            this._lastScreenWidth !== screenWidth ||
            this._lastScreenHeight !== screenHeight
        );

        if (changed) {
            this.numTilesX = newTilesX;
            this.numTilesY = newTilesY;
            this.totalClusters = newTilesX * newTilesY * this.numSlicesZ;

            this._lastCameraNear = near;
            this._lastCameraFar = far;
            this._lastScreenWidth = screenWidth;
            this._lastScreenHeight = screenHeight;

            this._reallocateBuffers();
        }

        return changed;
    }

    _reallocateBuffers() {
        const device = this.device;
        const tc = this.totalClusters;

        // ClusterAABB: 2 × vec4f = 32 bytes per cluster
        this.clusterAABBBuffer?.destroy();
        this.clusterAABBBuffer = new StorageBuffer(device, tc * 32, BUFFERUSAGE_COPY_DST | BUFFERUSAGE_COPY_SRC);

        // LightGrid: 2 × u32 = 8 bytes per cluster
        this.lightGridBuffer?.destroy();
        this.lightGridBuffer = new StorageBuffer(device, tc * 8, BUFFERUSAGE_COPY_DST | BUFFERUSAGE_COPY_SRC);

        // LightIndices: u32 per index entry
        this.lightIndicesBuffer?.destroy();
        this.lightIndicesBuffer = new StorageBuffer(device, MAX_LIGHT_INDICES * 4, BUFFERUSAGE_COPY_DST | BUFFERUSAGE_COPY_SRC);

        // GlobalCounter: single atomic u32
        this.globalCounterBuffer?.destroy();
        this.globalCounterBuffer = new StorageBuffer(device, 4, BUFFERUSAGE_COPY_DST | BUFFERUSAGE_COPY_SRC);

        // LightVolume: 2 × vec4f = 32 bytes per light (uploaded each frame)
        if (!this.lightVolumeBuffer) {
            this.lightVolumeBuffer = new StorageBuffer(device, MAX_LIGHTS * 32, BUFFERUSAGE_COPY_DST);
        }
    }

    /**
     * Collect active non-directional lights and encode their volume data for GPU culling.
     *
     * @param {Set<Light>|Light[]} lights - The lights to process.
     * @param {Mat4} viewMatrix - The camera view matrix for transforming to view space.
     */
    collectLights(lights, viewMatrix) {
        const staging = this.lightVolumeStagingData;
        let lightIndex = 0;

        const processLight = (light) => {
            const runtimeLight = !!(light.mask & (MASK_AFFECT_DYNAMIC | MASK_AFFECT_LIGHTMAPPED));
            if (!light.enabled || light.type === LIGHTTYPE_DIRECTIONAL || !light.visibleThisFrame ||
                light.intensity <= 0 || !runtimeLight) {
                return;
            }

            if (lightIndex >= MAX_LIGHTS) return;

            const pos = light._node.getPosition();

            // Transform light position to view space
            tempVec3.set(pos.x, pos.y, pos.z);
            viewMatrix.transformPoint(tempVec3, tempVec3);

            const offset = lightIndex * 8;

            // positionRange: view-space position + range
            staging[offset + 0] = tempVec3.x;
            staging[offset + 1] = tempVec3.y;
            staging[offset + 2] = tempVec3.z;
            staging[offset + 3] = light.attenuationEnd;

            // directionAngle: view-space direction + cos(outerAngle)
            if (light.type === LIGHTTYPE_SPOT) {
                const mat = light._node.getWorldTransform();
                const dir = new Vec3();
                mat.getY(dir).mulScalar(-1).normalize();
                // Transform direction to view space (rotation only)
                viewMatrix.transformVector(dir, dir);
                staging[offset + 4] = dir.x;
                staging[offset + 5] = dir.y;
                staging[offset + 6] = dir.z;
                staging[offset + 7] = Math.cos(light._outerConeAngle * Math.PI / 180);
            } else {
                // Omni light: use sentinel value -2.0 for cosAngle
                staging[offset + 4] = 0;
                staging[offset + 5] = 0;
                staging[offset + 6] = 0;
                staging[offset + 7] = -2.0;
            }

            lightIndex++;
        };

        if (lights instanceof Set || (lights[Symbol.iterator])) {
            for (const light of lights) {
                processLight(light);
            }
        }

        this.activeLightCount = lightIndex;

        // Also collect lights into LightsBuffer for the forward shader (texture-based data)
        this.lightsBuffer._usedLightCount = 0;
    }

    /**
     * Upload light volume data to GPU.
     */
    uploadLightVolumes() {
        if (this.activeLightCount > 0 && this.lightVolumeBuffer) {
            this.lightVolumeBuffer.write(
                0, this.lightVolumeStagingData, 0, this.activeLightCount * 8
            );
        }
    }

    /**
     * Dispatch the ClusterBounds compute shader.
     *
     * @param {Camera} camera - The camera.
     */
    dispatchBounds(camera) {
        if (this.totalClusters === 0) return;

        const compute = this.boundsCompute;

        // Get inverse projection matrix
        tempInvProjMat.copy(camera.projectionMatrix).invert();

        compute.setParameter('numTilesX', this.numTilesX);
        compute.setParameter('numTilesY', this.numTilesY);
        compute.setParameter('numSlicesZ', this.numSlicesZ);
        compute.setParameter('tilePixelSize', this.tilePixelSize);
        compute.setParameter('cameraNear', camera._nearClip);
        compute.setParameter('cameraFar', camera._farClip);
        compute.setParameter('screenWidth', this._lastScreenWidth);
        compute.setParameter('screenHeight', this._lastScreenHeight);
        compute.setParameter('invProjectionMat', tempInvProjMat.data);
        compute.setParameter('clusterAABBs', this.clusterAABBBuffer);

        const workgroups = Math.ceil(this.totalClusters / 128);
        compute.setupDispatch(workgroups);
        this.device.computeDispatch([compute], 'ClusterBounds');
    }

    /**
     * Dispatch the ClusterLighting compute shader.
     */
    dispatchLighting() {
        if (this.totalClusters === 0) return;

        // Clear global counter to 0
        this.globalCounterBuffer.clear();

        const compute = this.lightingCompute;

        compute.setParameter('numTilesX', this.numTilesX);
        compute.setParameter('numTilesY', this.numTilesY);
        compute.setParameter('numSlicesZ', this.numSlicesZ);
        compute.setParameter('lightCount', this.activeLightCount);
        compute.setParameter('maxLightsPerCluster', MAX_LIGHTS_PER_CLUSTER);
        compute.setParameter('clusterAABBs', this.clusterAABBBuffer);
        compute.setParameter('lightVolumes', this.lightVolumeBuffer);
        compute.setParameter('lightGrid', this.lightGridBuffer);
        compute.setParameter('lightIndices', this.lightIndicesBuffer);
        compute.setParameter('globalCounter', this.globalCounterBuffer);

        const workgroups = Math.ceil(this.totalClusters / 128);
        compute.setupDispatch(workgroups);
        this.device.computeDispatch([compute], 'ClusterLighting');
    }

    /**
     * Full update: collect lights, compute bounds (if needed), compute lighting assignments.
     *
     * @param {Set<Light>|Light[]} lights - Active lights.
     * @param {Camera} camera - The camera.
     * @param {object} [lightingParams] - Lighting parameters.
     */
    update(lights, camera, lightingParams) {
        const device = this.device;
        const screenWidth = device.width;
        const screenHeight = device.height;

        // Update cluster grid config
        const configChanged = this.updateConfig(camera, screenWidth, screenHeight);

        // Get view matrix
        const viewMat = camera.node ? camera.node.getWorldTransform().clone().invert() : new Mat4();

        // Collect and encode light data
        this.collectLights(lights, viewMat);
        this.uploadLightVolumes();

        // Dispatch bounds compute (only when camera/screen changes)
        if (configChanged) {
            this.dispatchBounds(camera);
        }

        // Dispatch lighting compute (every frame)
        this.dispatchLighting();
    }

    /**
     * Set uniforms for forward shader consumption.
     */
    activate() {
        // Set storage buffers
        if (this.lightGridBuffer) {
            this._lightGridId.setValue(this.lightGridBuffer);
        }
        if (this.lightIndicesBuffer) {
            this._lightIndicesId.setValue(this.lightIndicesBuffer);
        }

        // Set cluster config uniforms for the fragment shader
        this._gpuClusterNumTilesXId.setValue(this.numTilesX);
        this._gpuClusterNumTilesYId.setValue(this.numTilesY);
        this._gpuClusterNumSlicesZId.setValue(this.numSlicesZ);
        this._gpuClusterCameraNearId.setValue(this._lastCameraNear);
        this._gpuClusterCameraFarId.setValue(this._lastCameraFar);
        this._gpuClusterTilePixelSizeId.setValue(this.tilePixelSize);
        this._gpuClusterScreenSizeId?.setValue([this._lastScreenWidth, this._lastScreenHeight]);

        // Also activate the lights buffer (texture-based light data for forward shader)
        this.lightsBuffer.updateUniforms();
    }

    destroy() {
        this.clusterAABBBuffer?.destroy();
        this.lightVolumeBuffer?.destroy();
        this.lightGridBuffer?.destroy();
        this.lightIndicesBuffer?.destroy();
        this.globalCounterBuffer?.destroy();
        this.lightsBuffer.destroy();

        this.clusterAABBBuffer = null;
        this.lightVolumeBuffer = null;
        this.lightGridBuffer = null;
        this.lightIndicesBuffer = null;
        this.globalCounterBuffer = null;
    }
}

export { GpuClusterLighting, MAX_LIGHTS, MAX_LIGHTS_PER_CLUSTER };
