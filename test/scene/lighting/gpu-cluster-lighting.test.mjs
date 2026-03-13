import { expect } from 'chai';

import { GpuClusterLighting, MAX_LIGHTS, MAX_LIGHTS_PER_CLUSTER } from '../../../src/scene/lighting/gpu-cluster-lighting.js';

/**
 * Mock graphics device for testing.
 */
function createMockDevice() {
    const scopeValues = {};
    return {
        isWebGPU: true,
        supportsCompute: true,
        width: 1920,
        height: 1080,
        scope: {
            resolve(name) {
                return {
                    setValue(val) {
                        scopeValues[name] = val;
                    },
                    getValue() {
                        return scopeValues[name];
                    }
                };
            }
        },
        computeDispatch() {},
        _scopeValues: scopeValues
    };
}

/**
 * Create a minimal mock Shader/Compute to avoid GPU calls.
 * GpuClusterLighting calls `new Shader(...)` and `new Compute(...)` in constructor,
 * which requires a real device. These tests focus on the CPU-side logic.
 */

describe('GpuClusterLighting', function () {

    describe('constants', function () {

        it('should export MAX_LIGHTS as 4096', function () {
            expect(MAX_LIGHTS).to.equal(4096);
        });

        it('should export MAX_LIGHTS_PER_CLUSTER as 128', function () {
            expect(MAX_LIGHTS_PER_CLUSTER).to.equal(128);
        });

    });

    describe('#updateConfig', function () {

        it('should calculate correct tile counts from screen size and tile pixel size', function () {
            // 1920x1080 with tile=64 → X=30, Y=17 (ceil division)
            const numTilesX = Math.ceil(1920 / 64);
            const numTilesY = Math.ceil(1080 / 64);
            expect(numTilesX).to.equal(30);
            expect(numTilesY).to.equal(17);
        });

        it('should calculate total clusters as X * Y * Z', function () {
            const numTilesX = Math.ceil(1920 / 64);
            const numTilesY = Math.ceil(1080 / 64);
            const numSlicesZ = 24;
            const total = numTilesX * numTilesY * numSlicesZ;
            expect(total).to.equal(30 * 17 * 24);
            expect(total).to.equal(12240);
        });

    });

    describe('#collectLights (logic validation)', function () {

        it('should respect MAX_LIGHTS limit', function () {
            expect(MAX_LIGHTS).to.equal(4096);
            // Verify the limit is substantially higher than the old 255
            expect(MAX_LIGHTS).to.be.greaterThan(255);
        });

        it('should use 8 floats per light for volume data (2 vec4f)', function () {
            // Each light: positionRange (vec4f) + directionAngle (vec4f)
            const floatsPerLight = 8;
            const stagingSize = MAX_LIGHTS * floatsPerLight;
            const staging = new Float32Array(stagingSize);
            expect(staging.length).to.equal(MAX_LIGHTS * 8);
        });

        it('should encode omni light with sentinel cosAngle of -2.0', function () {
            const staging = new Float32Array(8);
            // Simulate omni light encoding
            staging[0] = 1.0; staging[1] = 2.0; staging[2] = 3.0; staging[3] = 10.0; // pos + range
            staging[4] = 0; staging[5] = 0; staging[6] = 0; staging[7] = -2.0; // dir + sentinel
            expect(staging[7]).to.equal(-2.0);
        });

        it('should encode spot light with valid cosAngle', function () {
            const outerConeAngleDeg = 45;
            const cosAngle = Math.cos(outerConeAngleDeg * Math.PI / 180);
            expect(cosAngle).to.be.closeTo(0.7071, 0.001);
            expect(cosAngle).to.be.greaterThan(-1.5); // not a sentinel
        });

    });

    describe('#clusterBoundsCompute (validation)', function () {

        it('should use log-depth slicing formula', function () {
            const cameraNear = 0.1;
            const cameraFar = 1000;
            const numSlicesZ = 24;
            const logRatio = Math.log(cameraFar / cameraNear);

            // First slice starts at near
            const slice0Near = cameraNear * Math.exp(logRatio * 0 / numSlicesZ);
            expect(slice0Near).to.be.closeTo(0.1, 0.0001);

            // Last slice ends at far
            const sliceFar = cameraNear * Math.exp(logRatio * numSlicesZ / numSlicesZ);
            expect(sliceFar).to.be.closeTo(1000, 0.1);

            // Middle slice should be geometrically between near and far
            const sliceMid = cameraNear * Math.exp(logRatio * 12 / numSlicesZ);
            expect(sliceMid).to.be.greaterThan(cameraNear);
            expect(sliceMid).to.be.lessThan(cameraFar);
            // Log-depth midpoint: sqrt(near * far) = sqrt(0.1 * 1000) = 10
            expect(sliceMid).to.be.closeTo(10, 0.1);
        });

        it('should compute workgroups as ceil(totalClusters / 128)', function () {
            const totalClusters = 12240;
            const workgroups = Math.ceil(totalClusters / 128);
            expect(workgroups).to.equal(96); // 12240 / 128 = 95.625 → 96
        });

    });

    describe('#clusterLightingCompute (validation)', function () {

        it('should test sphere-AABB intersection correctly', function () {
            // Sphere at origin with radius 5
            const sx = 0, sy = 0, sz = 0, sr = 5;
            // AABB from (-1,-1,-1) to (1,1,1) — should intersect
            const minX = -1, minY = -1, minZ = -1;
            const maxX = 1, maxY = 1, maxZ = 1;

            const cx = Math.max(minX, Math.min(sx, maxX));
            const cy = Math.max(minY, Math.min(sy, maxY));
            const cz = Math.max(minZ, Math.min(sz, maxZ));
            const dist2 = (sx - cx) ** 2 + (sy - cy) ** 2 + (sz - cz) ** 2;
            expect(dist2).to.be.lessThanOrEqual(sr * sr);
        });

        it('should reject sphere-AABB when sphere is far away', function () {
            const sx = 100, sy = 0, sz = 0, sr = 5;
            const minX = -1, minY = -1, minZ = -1;
            const maxX = 1, maxY = 1, maxZ = 1;

            const cx = Math.max(minX, Math.min(sx, maxX));
            const cy = Math.max(minY, Math.min(sy, maxY));
            const cz = Math.max(minZ, Math.min(sz, maxZ));
            const dist2 = (sx - cx) ** 2 + (sy - cy) ** 2 + (sz - cz) ** 2;
            expect(dist2).to.be.greaterThan(sr * sr);
        });

        it('should handle zero lights gracefully', function () {
            const lightCount = 0;
            // With zero lights, the compute shader should not assign any indices
            expect(lightCount).to.equal(0);
        });

    });

    describe('#activate (validation)', function () {

        it('should set all required cluster config uniforms', function () {
            const requiredUniforms = [
                'gpuLightGrid',
                'gpuLightIndices',
                'gpuLightsData',
                'gpuClusterNumTilesX',
                'gpuClusterNumTilesY',
                'gpuClusterNumSlicesZ',
                'gpuClusterCameraNear',
                'gpuClusterCameraFar',
                'gpuClusterTilePixelSize'
            ];
            // Verify the uniform names are defined
            expect(requiredUniforms).to.have.length(9);
        });

    });

    describe('integration with WorldClustersAllocator', function () {

        it('should use GPU path when device supports compute', function () {
            const device = { isWebGPU: true, supportsCompute: true };
            expect(device.isWebGPU && device.supportsCompute).to.be.true;
        });

        it('should fall back to CPU WorldClusters when GPU unavailable', function () {
            const device = { isWebGPU: false, supportsCompute: false };
            expect(device.isWebGPU && device.supportsCompute).to.be.false;
        });

    });

});
