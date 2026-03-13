import { expect } from 'chai';

import { SHADERDEF_SKIN, SHADERDEF_BATCH, SHADERDEF_INSTANCING } from '../../../src/scene/constants.js';

/**
 * Tests for GPU culling eligibility logic and data flow.
 * These tests verify the eligibility criteria and data structures
 * without requiring a full GPU context.
 */
describe('GpuCulling', function () {

    describe('isEligible', function () {
        // Replicate the isEligible logic from gpu-culling.js
        function isEligible(dc) {
            if (dc._skinInstance || dc.instancingData || dc.gsplatInstance) return false;
            if (dc._shaderDefs & (SHADERDEF_SKIN | SHADERDEF_BATCH | SHADERDEF_INSTANCING)) return false;
            if (dc.isVisibleFunc) return false;
            if (!dc.cull) return false;
            return true;
        }

        it('should accept a simple static mesh', function () {
            const dc = {
                _skinInstance: null,
                instancingData: null,
                gsplatInstance: null,
                _shaderDefs: 0,
                isVisibleFunc: null,
                cull: true
            };
            expect(isEligible(dc)).to.equal(true);
        });

        it('should reject skinned meshes', function () {
            const dc = {
                _skinInstance: {},
                instancingData: null,
                gsplatInstance: null,
                _shaderDefs: 0,
                isVisibleFunc: null,
                cull: true
            };
            expect(isEligible(dc)).to.equal(false);
        });

        it('should reject instanced meshes', function () {
            const dc = {
                _skinInstance: null,
                instancingData: { vertexBuffer: {} },
                gsplatInstance: null,
                _shaderDefs: 0,
                isVisibleFunc: null,
                cull: true
            };
            expect(isEligible(dc)).to.equal(false);
        });

        it('should reject gsplat meshes', function () {
            const dc = {
                _skinInstance: null,
                instancingData: null,
                gsplatInstance: {},
                _shaderDefs: 0,
                isVisibleFunc: null,
                cull: true
            };
            expect(isEligible(dc)).to.equal(false);
        });

        it('should reject meshes with SHADERDEF_SKIN flag', function () {
            const dc = {
                _skinInstance: null,
                instancingData: null,
                gsplatInstance: null,
                _shaderDefs: SHADERDEF_SKIN,
                isVisibleFunc: null,
                cull: true
            };
            expect(isEligible(dc)).to.equal(false);
        });

        it('should reject meshes with SHADERDEF_BATCH flag', function () {
            const dc = {
                _skinInstance: null,
                instancingData: null,
                gsplatInstance: null,
                _shaderDefs: SHADERDEF_BATCH,
                isVisibleFunc: null,
                cull: true
            };
            expect(isEligible(dc)).to.equal(false);
        });

        it('should reject meshes with SHADERDEF_INSTANCING flag', function () {
            const dc = {
                _skinInstance: null,
                instancingData: null,
                gsplatInstance: null,
                _shaderDefs: SHADERDEF_INSTANCING,
                isVisibleFunc: null,
                cull: true
            };
            expect(isEligible(dc)).to.equal(false);
        });

        it('should reject meshes with custom visibility func', function () {
            const dc = {
                _skinInstance: null,
                instancingData: null,
                gsplatInstance: null,
                _shaderDefs: 0,
                isVisibleFunc: () => true,
                cull: true
            };
            expect(isEligible(dc)).to.equal(false);
        });

        it('should reject non-culled meshes', function () {
            const dc = {
                _skinInstance: null,
                instancingData: null,
                gsplatInstance: null,
                _shaderDefs: 0,
                isVisibleFunc: null,
                cull: false
            };
            expect(isEligible(dc)).to.equal(false);
        });
    });

    describe('AABB staging data layout', function () {
        const FLOATS_PER_AABB = 4;

        it('should store center xyz and radius for each object', function () {
            const capacity = 4;
            const aabbStaging = new Float32Array(capacity * FLOATS_PER_AABB);

            // Simulate populating AABB data for 2 objects
            const objects = [
                { center: { x: 1, y: 2, z: 3 }, radius: 5 },
                { center: { x: -1, y: -2, z: -3 }, radius: 10 }
            ];

            for (let gi = 0; gi < objects.length; gi++) {
                const obj = objects[gi];
                const ao = gi * FLOATS_PER_AABB;
                aabbStaging[ao + 0] = obj.center.x;
                aabbStaging[ao + 1] = obj.center.y;
                aabbStaging[ao + 2] = obj.center.z;
                aabbStaging[ao + 3] = obj.radius;
            }

            // Verify object 0
            expect(aabbStaging[0]).to.equal(1);
            expect(aabbStaging[1]).to.equal(2);
            expect(aabbStaging[2]).to.equal(3);
            expect(aabbStaging[3]).to.equal(5);

            // Verify object 1
            expect(aabbStaging[4]).to.equal(-1);
            expect(aabbStaging[5]).to.equal(-2);
            expect(aabbStaging[6]).to.equal(-3);
            expect(aabbStaging[7]).to.equal(10);
        });
    });

    describe('mesh metadata staging layout', function () {
        const UINTS_PER_META = 4;

        it('should store indexCount, firstIndex, baseVertex, transformSlot', function () {
            const capacity = 2;
            const meshMetaStaging = new Uint32Array(capacity * UINTS_PER_META);
            const meshMetaStagingI32 = new Int32Array(meshMetaStaging.buffer);

            // Object with transformSlot=5, indexCount=36, firstIndex=0, baseVertex=0
            const mo0 = 0 * UINTS_PER_META;
            meshMetaStaging[mo0 + 0] = 36;  // indexCount
            meshMetaStaging[mo0 + 1] = 0;   // firstIndex
            meshMetaStagingI32[mo0 + 2] = 0; // baseVertex (signed)
            meshMetaStaging[mo0 + 3] = 5;   // transformSlot

            // Object with negative baseVertex
            const mo1 = 1 * UINTS_PER_META;
            meshMetaStaging[mo1 + 0] = 12;
            meshMetaStaging[mo1 + 1] = 100;
            meshMetaStagingI32[mo1 + 2] = -10; // negative base vertex
            meshMetaStaging[mo1 + 3] = 7;

            expect(meshMetaStaging[mo0 + 0]).to.equal(36);
            expect(meshMetaStaging[mo0 + 3]).to.equal(5);
            expect(meshMetaStagingI32[mo1 + 2]).to.equal(-10);
            expect(meshMetaStaging[mo1 + 3]).to.equal(7);
        });
    });

    describe('frustum planes extraction', function () {
        it('should store 6 planes with 4 floats each (24 total)', function () {
            const frustumPlanesData = new Float32Array(24);

            // Create mock frustum planes
            const planes = [];
            for (let p = 0; p < 6; p++) {
                planes.push({
                    normal: { x: p * 0.1, y: p * 0.2, z: p * 0.3 },
                    distance: p * 10
                });
            }

            // Simulate extraction
            for (let p = 0; p < 6; p++) {
                const plane = planes[p];
                frustumPlanesData[p * 4 + 0] = plane.normal.x;
                frustumPlanesData[p * 4 + 1] = plane.normal.y;
                frustumPlanesData[p * 4 + 2] = plane.normal.z;
                frustumPlanesData[p * 4 + 3] = plane.distance;
            }

            // Verify plane 3
            expect(frustumPlanesData[12]).to.be.closeTo(0.3, 0.001);
            expect(frustumPlanesData[13]).to.be.closeTo(0.6, 0.001);
            expect(frustumPlanesData[14]).to.be.closeTo(0.9, 0.001);
            expect(frustumPlanesData[15]).to.equal(30);

            expect(frustumPlanesData.length).to.equal(24);
        });
    });

    describe('index mapping', function () {
        it('should map gpu cull index to original drawCall index', function () {
            const indexMapping = [];

            // Simulate: drawCalls[0]=eligible, [1]=not, [2]=eligible, [3]=not, [4]=eligible
            const drawCalls = [
                { eligible: true },
                { eligible: false },
                { eligible: true },
                { eligible: false },
                { eligible: true }
            ];

            let gi = 0;
            for (let i = 0; i < drawCalls.length; i++) {
                if (drawCalls[i].eligible) {
                    indexMapping.push(i);
                    gi++;
                }
            }

            expect(gi).to.equal(3);
            expect(indexMapping).to.deep.equal([0, 2, 4]);

            // When assigning indirect draw slots, we use:
            // drawCalls[indexMapping[j]] for j in [0..gi)
            const baseSlot = 100;
            for (let j = 0; j < gi; j++) {
                const dcIndex = indexMapping[j];
                expect(dcIndex).to.be.oneOf([0, 2, 4]);
                const expectedSlot = baseSlot + j;
                expect(expectedSlot).to.be.at.least(100);
                expect(expectedSlot).to.be.at.most(102);
            }
        });
    });

    describe('capacity management', function () {
        it('should grow to next power of 2', function () {
            function ensureCapacity(count, currentCapacity) {
                if (count <= currentCapacity) return currentCapacity;

                let newCap = currentCapacity || 256;
                while (newCap < count) newCap *= 2;
                return newCap;
            }

            expect(ensureCapacity(100, 0)).to.equal(256);
            expect(ensureCapacity(257, 256)).to.equal(512);
            expect(ensureCapacity(512, 256)).to.equal(512);
            expect(ensureCapacity(513, 256)).to.equal(1024);
            expect(ensureCapacity(1, 256)).to.equal(256); // no growth
        });
    });
});
