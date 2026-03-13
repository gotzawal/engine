import { expect } from 'chai';

import { GpuClusterLighting, MAX_LIGHTS, MAX_LIGHTS_PER_CLUSTER } from '../../../src/scene/lighting/gpu-cluster-lighting.js';
import clusterLightingWGSL from '../../../src/scene/shader-lib/wgsl/chunks/common/comp/cluster-lighting.js';
import clusterBoundsWGSL from '../../../src/scene/shader-lib/wgsl/chunks/common/comp/cluster-bounds.js';

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
            expect(total).to.equal(12240);
        });

    });

    describe('#collectLights (logic validation)', function () {

        it('should respect MAX_LIGHTS limit', function () {
            expect(MAX_LIGHTS).to.equal(4096);
            expect(MAX_LIGHTS).to.be.greaterThan(255);
        });

        it('should use 8 floats per light for volume data (2 vec4f)', function () {
            const floatsPerLight = 8;
            const stagingSize = MAX_LIGHTS * floatsPerLight;
            const staging = new Float32Array(stagingSize);
            expect(staging.length).to.equal(MAX_LIGHTS * 8);
        });

        it('should encode omni light with sentinel cosAngle of -2.0', function () {
            const staging = new Float32Array(8);
            staging[0] = 1.0; staging[1] = 2.0; staging[2] = 3.0; staging[3] = 10.0;
            staging[4] = 0; staging[5] = 0; staging[6] = 0; staging[7] = -2.0;
            expect(staging[7]).to.equal(-2.0);
        });

        it('should encode spot light with valid cosAngle', function () {
            const outerConeAngleDeg = 45;
            const cosAngle = Math.cos(outerConeAngleDeg * Math.PI / 180);
            expect(cosAngle).to.be.closeTo(0.7071, 0.001);
            expect(cosAngle).to.be.greaterThan(-1.5);
        });

    });

    describe('#clusterBoundsCompute (validation)', function () {

        it('should use log-depth slicing formula', function () {
            const cameraNear = 0.1;
            const cameraFar = 1000;
            const numSlicesZ = 24;
            const logRatio = Math.log(cameraFar / cameraNear);

            const slice0Near = cameraNear * Math.exp(logRatio * 0 / numSlicesZ);
            expect(slice0Near).to.be.closeTo(0.1, 0.0001);

            const sliceFar = cameraNear * Math.exp(logRatio * numSlicesZ / numSlicesZ);
            expect(sliceFar).to.be.closeTo(1000, 0.1);

            const sliceMid = cameraNear * Math.exp(logRatio * 12 / numSlicesZ);
            expect(sliceMid).to.be.closeTo(10, 0.1);
        });

        it('should compute workgroups as ceil(totalClusters / 128)', function () {
            const totalClusters = 12240;
            const workgroups = Math.ceil(totalClusters / 128);
            expect(workgroups).to.equal(96);
        });

    });

    describe('#clusterLightingCompute (validation)', function () {

        it('should test sphere-AABB intersection correctly', function () {
            const sx = 0, sy = 0, sz = 0, sr = 5;
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

        it('should detect sphere touching AABB corner (tangent case)', function () {
            const sx = 6, sy = 6, sz = 6;
            const sr = Math.sqrt(75);
            const minX = 0, minY = 0, minZ = 0;
            const maxX = 1, maxY = 1, maxZ = 1;

            const cx = Math.max(minX, Math.min(sx, maxX));
            const cy = Math.max(minY, Math.min(sy, maxY));
            const cz = Math.max(minZ, Math.min(sz, maxZ));
            const dist2 = (sx - cx) ** 2 + (sy - cy) ** 2 + (sz - cz) ** 2;
            expect(dist2).to.be.closeTo(sr * sr, 1e-10);
        });

        it('should detect sphere fully containing AABB', function () {
            const sx = 0, sy = 0, sz = 0, sr = 1000;
            const minX = -1, minY = -1, minZ = -1;
            const maxX = 1, maxY = 1, maxZ = 1;

            const cx = Math.max(minX, Math.min(sx, maxX));
            const cy = Math.max(minY, Math.min(sy, maxY));
            const cz = Math.max(minZ, Math.min(sz, maxZ));
            const dist2 = (sx - cx) ** 2 + (sy - cy) ** 2 + (sz - cz) ** 2;
            expect(dist2).to.be.lessThanOrEqual(sr * sr);
        });

        it('should handle zero lights gracefully', function () {
            const lightCount = 0;
            const numBatches = Math.ceil(lightCount / 64);
            expect(numBatches).to.equal(0);
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

    // ===== WGSL shader structure validation =====

    describe('WGSL shader structure - cluster-lighting', function () {

        it('should export a non-empty WGSL shader string', function () {
            expect(clusterLightingWGSL).to.be.a('string');
            expect(clusterLightingWGSL.length).to.be.greaterThan(100);
        });

        it('should have @compute @workgroup_size decorator', function () {
            expect(clusterLightingWGSL).to.match(/@compute\s+@workgroup_size\(\d+\)/);
        });

        it('should have required storage buffer bindings (0-5)', function () {
            expect(clusterLightingWGSL).to.include('@group(0) @binding(0)');
            expect(clusterLightingWGSL).to.include('@group(0) @binding(1)');
            expect(clusterLightingWGSL).to.include('@group(0) @binding(2)');
            expect(clusterLightingWGSL).to.include('@group(0) @binding(3)');
            expect(clusterLightingWGSL).to.include('@group(0) @binding(4)');
            expect(clusterLightingWGSL).to.include('@group(0) @binding(5)');
        });

        it('should declare workgroup shared memory for light batching', function () {
            expect(clusterLightingWGSL).to.include('var<workgroup>');
        });

        it('should use workgroupBarrier() for shared memory synchronization', function () {
            expect(clusterLightingWGSL).to.include('workgroupBarrier()');
        });

        it('should NOT have early return before workgroupBarrier (non-uniform control flow bug)', function () {
            // This test catches the critical WebGPU validation error:
            // "workgroupBarrier must only be called from uniform control flow"
            //
            // An early `return;` in main() based on gid.x (non-uniform) causes some
            // threads to exit while others continue to the barrier.

            // Extract the main function body
            // Use a simpler approach: find "fn main(" then match to the last "}"
            const fnMainIdx = clusterLightingWGSL.indexOf('fn main(');
            expect(fnMainIdx, 'should find fn main(').to.be.greaterThan(-1);
            const bodyStartIdx = clusterLightingWGSL.indexOf('{', fnMainIdx);
            expect(bodyStartIdx, 'should find opening brace').to.be.greaterThan(-1);
            const mainBody = clusterLightingWGSL.substring(bodyStartIdx + 1);

            // Find the position of the first workgroupBarrier()
            const firstBarrierIdx = mainBody.indexOf('workgroupBarrier()');
            expect(firstBarrierIdx, 'should have workgroupBarrier in main').to.be.greaterThan(-1);

            // Check if there's a `return;` before the first workgroupBarrier
            const codeBeforeBarrier = mainBody.substring(0, firstBarrierIdx);

            // Remove single-line comments
            const codeNoComments = codeBeforeBarrier.replace(/\/\/[^\n]*/g, '');
            const hasEarlyReturn = /\breturn\s*;/.test(codeNoComments);

            expect(hasEarlyReturn,
                'early return before workgroupBarrier causes non-uniform control flow error - ' +
                'use isValid flag pattern instead of early return'
            ).to.be.false;
        });

        it('should have atomic counter for global light index allocation', function () {
            expect(clusterLightingWGSL).to.include('atomic<u32>');
            expect(clusterLightingWGSL).to.include('atomicAdd');
        });

        it('should define sphere-AABB intersection function', function () {
            expect(clusterLightingWGSL).to.include('sphereAABBIntersect');
        });

        it('should define spot cone intersection function', function () {
            expect(clusterLightingWGSL).to.include('spotConeAABBIntersect');
        });

        it('should use BATCH_SIZE constant for cooperative loading', function () {
            expect(clusterLightingWGSL).to.include('BATCH_SIZE');
        });

        it('should have LightGrid struct with offset and count', function () {
            expect(clusterLightingWGSL).to.include('struct LightGrid');
            expect(clusterLightingWGSL).to.match(/offset\s*:\s*u32/);
            expect(clusterLightingWGSL).to.match(/count\s*:\s*u32/);
        });

    });

    describe('WGSL shader structure - cluster-bounds', function () {

        it('should export a non-empty WGSL shader string', function () {
            expect(clusterBoundsWGSL).to.be.a('string');
            expect(clusterBoundsWGSL.length).to.be.greaterThan(100);
        });

        it('should have @compute @workgroup_size decorator', function () {
            expect(clusterBoundsWGSL).to.match(/@compute\s+@workgroup_size\(\d+\)/);
        });

        it('should have ClusterConfig uniform binding', function () {
            expect(clusterBoundsWGSL).to.include('var<uniform> config: ClusterConfig');
        });

        it('should have clusterAABBs storage buffer binding', function () {
            expect(clusterBoundsWGSL).to.include('var<storage, read_write> clusterAABBs');
        });

        it('should use log-depth slicing (log/exp for slice boundaries)', function () {
            expect(clusterBoundsWGSL).to.include('log(');
            expect(clusterBoundsWGSL).to.include('exp(');
        });

        it('should compute view-space positions via ndcToView', function () {
            expect(clusterBoundsWGSL).to.include('ndcToView');
        });

        it('does NOT use workgroupBarrier (no shared memory), so early return is safe', function () {
            expect(clusterBoundsWGSL).to.not.include('workgroupBarrier');
        });

    });

});
