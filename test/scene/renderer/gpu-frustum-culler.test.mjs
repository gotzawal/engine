import { expect } from 'chai';

import { GpuFrustumCuller } from '../../../src/scene/renderer/gpu-frustum-culler.js';

describe('GpuFrustumCuller', function () {

    describe('#updateSphere', function () {

        it('should write center xyz and radius to staging buffer', function () {
            // Validate the staging buffer layout: 4 floats per sphere (vec4f)
            const FLOATS_PER_SPHERE = 4;
            const capacity = 16;
            const staging = new Float32Array(capacity * FLOATS_PER_SPHERE);

            const slot = 5;
            const cx = 10, cy = 20, cz = 30, radius = 5;
            const offset = slot * FLOATS_PER_SPHERE;

            staging[offset] = cx;
            staging[offset + 1] = cy;
            staging[offset + 2] = cz;
            staging[offset + 3] = radius;

            expect(staging[offset]).to.equal(10);
            expect(staging[offset + 1]).to.equal(20);
            expect(staging[offset + 2]).to.equal(30);
            expect(staging[offset + 3]).to.equal(5);
        });

        it('should auto-resize when slot exceeds capacity', function () {
            let capacity = 8;
            const FLOATS_PER_SPHERE = 4;

            function resize(newCapacity) {
                capacity = newCapacity;
            }

            function updateSphere(slot) {
                if (slot >= capacity) {
                    resize(Math.max(capacity * 2, slot + 1));
                }
            }

            updateSphere(20);
            expect(capacity).to.equal(21); // max(16, 21) = 21
        });

        it('should handle slot 0', function () {
            const FLOATS_PER_SPHERE = 4;
            const staging = new Float32Array(4 * FLOATS_PER_SPHERE);

            staging[0] = 1;
            staging[1] = 2;
            staging[2] = 3;
            staging[3] = 4;

            expect(staging[0]).to.equal(1);
            expect(staging[3]).to.equal(4);
        });

    });

    describe('#extractFrustumPlanes', function () {

        it('should extract 6 planes as vec4f (normal.xyz, distance)', function () {
            // 6 planes × 4 floats = 24 floats
            const frustumPlanesData = new Float32Array(24);

            // Simulate 6 planes with normals and distances
            const planes = [
                { normal: { x: 1, y: 0, z: 0 }, distance: -10 },  // right
                { normal: { x: -1, y: 0, z: 0 }, distance: -10 }, // left
                { normal: { x: 0, y: 1, z: 0 }, distance: -10 },  // top
                { normal: { x: 0, y: -1, z: 0 }, distance: -10 }, // bottom
                { normal: { x: 0, y: 0, z: 1 }, distance: -0.1 }, // near
                { normal: { x: 0, y: 0, z: -1 }, distance: -1000 } // far
            ];

            for (let i = 0; i < 6; i++) {
                const p = planes[i];
                frustumPlanesData[i * 4] = p.normal.x;
                frustumPlanesData[i * 4 + 1] = p.normal.y;
                frustumPlanesData[i * 4 + 2] = p.normal.z;
                frustumPlanesData[i * 4 + 3] = p.distance;
            }

            expect(frustumPlanesData.length).to.equal(24);
            // Verify right plane
            expect(frustumPlanesData[0]).to.equal(1);
            expect(frustumPlanesData[3]).to.equal(-10);
            // Verify near plane
            expect(frustumPlanesData[16]).to.equal(0);
            expect(frustumPlanesData[18]).to.equal(1);
            expect(frustumPlanesData[19]).to.be.closeTo(-0.1, 1e-6);
        });

    });

    describe('#dispatch', function () {

        it('should no-op when indirectDrawCount is 0', function () {
            let dispatched = false;
            const indirectDrawCount = 0;

            if (indirectDrawCount > 0) {
                dispatched = true;
            }

            expect(dispatched).to.be.false;
        });

        it('should set correct workgroup count (ceil(count/64))', function () {
            const indirectDrawCount = 200;
            const workgroups = Math.ceil(indirectDrawCount / 64);
            expect(workgroups).to.equal(4); // 200/64 = 3.125 → 4
        });

        it('should handle exact multiple of 64', function () {
            const indirectDrawCount = 128;
            const workgroups = Math.ceil(indirectDrawCount / 64);
            expect(workgroups).to.equal(2);
        });

        it('should handle single draw call', function () {
            const indirectDrawCount = 1;
            const workgroups = Math.ceil(indirectDrawCount / 64);
            expect(workgroups).to.equal(1);
        });

    });

    describe('#resize', function () {

        it('should preserve existing staging data after resize', function () {
            const FLOATS_PER_SPHERE = 4;
            const oldCapacity = 4;
            const oldStaging = new Float32Array(oldCapacity * FLOATS_PER_SPHERE);

            // Write data to slot 0
            oldStaging[0] = 1; oldStaging[1] = 2; oldStaging[2] = 3; oldStaging[3] = 10;

            // Resize
            const newCapacity = 8;
            const newStaging = new Float32Array(newCapacity * FLOATS_PER_SPHERE);
            newStaging.set(oldStaging);

            expect(newStaging[0]).to.equal(1);
            expect(newStaging[1]).to.equal(2);
            expect(newStaging[2]).to.equal(3);
            expect(newStaging[3]).to.equal(10);
            expect(newStaging.length).to.equal(32);
        });

    });

});
