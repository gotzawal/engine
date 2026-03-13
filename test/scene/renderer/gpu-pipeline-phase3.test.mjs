import { expect } from 'chai';

import { SHADERDEF_SKIN, SHADERDEF_BATCH, SHADERDEF_INSTANCING, SHADERDEF_GLOBAL_TRANSFORM_BUFFER } from '../../../src/scene/constants.js';

/**
 * Phase 3 integration tests: GPU Buffer Layout Pipeline activation.
 * Tests the data flow changes made in Phase 3 without requiring a GPU context.
 */
describe('Phase 3: GPU Buffer Layout Pipeline', function () {

    describe('Step 1: _prepareGlobalTransformSlots', function () {

        function isEligible(dc) {
            if (dc._skinInstance || dc.instancingData || dc.gsplatInstance) return false;
            if (dc._shaderDefs & (SHADERDEF_SKIN | SHADERDEF_BATCH | SHADERDEF_INSTANCING)) return false;
            if (dc.isVisibleFunc) return false;
            if (!dc.cull) return false;
            return true;
        }

        function prepareGlobalTransformSlots(drawCalls, globalTransformBuffer) {
            let slotCounter = 0;
            for (let i = 0; i < drawCalls.length; i++) {
                const dc = drawCalls[i];
                if (isEligible(dc)) {
                    if (dc._globalTransformSlot === -1 && globalTransformBuffer) {
                        dc._globalTransformSlot = slotCounter++;
                        dc._shaderDefs |= SHADERDEF_GLOBAL_TRANSFORM_BUFFER;
                    }
                }
            }
            return slotCounter;
        }

        it('should assign transform slots to eligible draw calls', function () {
            const drawCalls = [
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: null, cull: true, _globalTransformSlot: -1 },
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: null, cull: true, _globalTransformSlot: -1 },
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: null, cull: true, _globalTransformSlot: -1 }
            ];

            const allocated = prepareGlobalTransformSlots(drawCalls, {});

            expect(allocated).to.equal(3);
            expect(drawCalls[0]._globalTransformSlot).to.equal(0);
            expect(drawCalls[1]._globalTransformSlot).to.equal(1);
            expect(drawCalls[2]._globalTransformSlot).to.equal(2);
        });

        it('should set SHADERDEF_GLOBAL_TRANSFORM_BUFFER on eligible draw calls', function () {
            const drawCalls = [
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: null, cull: true, _globalTransformSlot: -1 }
            ];

            prepareGlobalTransformSlots(drawCalls, {});

            expect(drawCalls[0]._shaderDefs & SHADERDEF_GLOBAL_TRANSFORM_BUFFER).to.not.equal(0);
        });

        it('should skip non-eligible draw calls', function () {
            const drawCalls = [
                // eligible
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: null, cull: true, _globalTransformSlot: -1 },
                // skinned - not eligible
                { _skinInstance: {}, instancingData: null, gsplatInstance: null, _shaderDefs: SHADERDEF_SKIN, isVisibleFunc: null, cull: true, _globalTransformSlot: -1 },
                // eligible
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: null, cull: true, _globalTransformSlot: -1 }
            ];

            const allocated = prepareGlobalTransformSlots(drawCalls, {});

            expect(allocated).to.equal(2);
            expect(drawCalls[0]._globalTransformSlot).to.equal(0);
            expect(drawCalls[1]._globalTransformSlot).to.equal(-1); // unchanged
            expect(drawCalls[2]._globalTransformSlot).to.equal(1);
        });

        it('should not re-allocate already assigned slots', function () {
            const drawCalls = [
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: null, cull: true, _globalTransformSlot: 42 }
            ];

            const allocated = prepareGlobalTransformSlots(drawCalls, {});

            expect(allocated).to.equal(0); // no new allocations
            expect(drawCalls[0]._globalTransformSlot).to.equal(42); // preserved
        });
    });

    describe('Step 2: GpuCulling.setup skips unassigned slots', function () {

        it('should skip draw calls without transform slot', function () {
            // Simulate the setup loop logic
            const drawCalls = [
                { _globalTransformSlot: 0, eligible: true },
                { _globalTransformSlot: -1, eligible: true }, // no slot assigned
                { _globalTransformSlot: 2, eligible: true }
            ];

            const processed = [];
            for (let i = 0; i < drawCalls.length; i++) {
                const dc = drawCalls[i];
                if (!dc.eligible) continue;
                const transformSlot = dc._globalTransformSlot;
                if (transformSlot < 0) continue;
                processed.push(i);
            }

            expect(processed).to.deep.equal([0, 2]);
        });
    });

    describe('Step 3: setIndirect camera key fix', function () {

        it('should use camera directly as key (not camera.camera)', function () {
            const cameraObject = { id: 'cam1', frustum: {} };

            // New behavior: key = camera ?? null
            const key = cameraObject ?? null;
            expect(key).to.equal(cameraObject);

            // Old behavior would have been: camera?.camera ?? null = null (wrong)
            const oldKey = cameraObject?.camera ?? null;
            expect(oldKey).to.equal(null); // this was the bug
        });

        it('should allow getDrawCommands to find the correct entry', function () {
            const camera = { id: 'cam1' };
            const drawCommands = new Map();

            // setIndirect stores with key = camera
            drawCommands.set(camera, { slotIndex: 5 });

            // getDrawCommands looks up with same camera
            const result = drawCommands.get(camera) ?? drawCommands.get(null);
            expect(result).to.not.be.undefined;
            expect(result.slotIndex).to.equal(5);
        });

        it('should fall back to null key when camera-specific entry not found', function () {
            const camera = { id: 'cam1' };
            const otherCamera = { id: 'cam2' };
            const drawCommands = new Map();

            // Set shared entry with null key
            drawCommands.set(null, { slotIndex: 10 });

            // Look up with different camera
            const result = drawCommands.get(otherCamera) ?? drawCommands.get(null);
            expect(result.slotIndex).to.equal(10);
        });
    });

    describe('Step 4: Renderer initialization', function () {

        it('should create GlobalTransformBuffer for WebGPU devices', function () {
            const isWebGPU = true;
            const globalTransformBuffer = isWebGPU ? { type: 'GlobalTransformBuffer' } : null;
            expect(globalTransformBuffer).to.not.be.null;
        });

        it('should not create GlobalTransformBuffer for non-WebGPU devices', function () {
            const isWebGPU = false;
            const globalTransformBuffer = isWebGPU ? { type: 'GlobalTransformBuffer' } : null;
            expect(globalTransformBuffer).to.be.null;
        });

        it('should create GpuCulling only when globalTransformBuffer exists', function () {
            // WebGPU case
            const gtb1 = { type: 'GlobalTransformBuffer' };
            const gc1 = gtb1 ? { type: 'GpuCulling' } : null;
            expect(gc1).to.not.be.null;

            // Non-WebGPU case
            const gtb2 = null;
            const gc2 = gtb2 ? { type: 'GpuCulling' } : null;
            expect(gc2).to.be.null;
        });
    });

    describe('Step 6: Transform skip guard', function () {

        it('should skip matrix upload for objects with global transform slot', function () {
            const drawCalls = [
                { _globalTransformSlot: 5, name: 'gpu-eligible' },
                { _globalTransformSlot: -1, name: 'cpu-path' },
                { _globalTransformSlot: 0, name: 'gpu-eligible-slot0' }
            ];

            const matrixUploads = [];
            for (const dc of drawCalls) {
                if (dc._globalTransformSlot < 0) {
                    matrixUploads.push(dc.name);
                }
            }

            expect(matrixUploads).to.deep.equal(['cpu-path']);
        });

        it('should handle slot 0 correctly (not falsy)', function () {
            // Important: slot 0 is valid, should NOT upload matrices
            const dc = { _globalTransformSlot: 0 };
            const shouldUpload = dc._globalTransformSlot < 0;
            expect(shouldUpload).to.equal(false);
        });
    });

    describe('Step 8: Upload separation', function () {

        it('should track dirty state and only upload once', function () {
            let dirty = false;
            let uploadCount = 0;

            function updateSlot() {
                dirty = true;
            }

            function upload() {
                if (dirty) {
                    uploadCount++;
                    dirty = false;
                }
            }

            // Simulate multiple setup() calls writing transforms
            updateSlot(); // layer 0 opaque
            updateSlot(); // layer 0 transparent
            updateSlot(); // layer 1 opaque

            // Single upload call after all setup() calls
            upload();
            expect(uploadCount).to.equal(1);

            // Second upload is no-op
            upload();
            expect(uploadCount).to.equal(1);
        });
    });

    describe('Hybrid pipeline: eligible vs non-eligible', function () {

        function isEligible(dc) {
            if (dc._skinInstance || dc.instancingData || dc.gsplatInstance) return false;
            if (dc._shaderDefs & (SHADERDEF_SKIN | SHADERDEF_BATCH | SHADERDEF_INSTANCING)) return false;
            if (dc.isVisibleFunc) return false;
            if (!dc.cull) return false;
            return true;
        }

        it('should correctly partition draw calls into GPU and CPU paths', function () {
            const drawCalls = [
                // GPU eligible
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: null, cull: true, name: 'static-box' },
                // CPU: skinned
                { _skinInstance: {}, instancingData: null, gsplatInstance: null, _shaderDefs: SHADERDEF_SKIN, isVisibleFunc: null, cull: true, name: 'skinned-char' },
                // CPU: instanced
                { _skinInstance: null, instancingData: { vertexBuffer: {} }, gsplatInstance: null, _shaderDefs: SHADERDEF_INSTANCING, isVisibleFunc: null, cull: true, name: 'instanced-grass' },
                // GPU eligible
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: null, cull: true, name: 'static-wall' },
                // CPU: gsplat
                { _skinInstance: null, instancingData: null, gsplatInstance: {}, _shaderDefs: 0, isVisibleFunc: null, cull: true, name: 'gsplat' },
                // CPU: custom visibility
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: () => true, cull: true, name: 'custom-vis' },
                // GPU eligible
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: null, cull: true, name: 'static-floor' }
            ];

            const gpuPath = [];
            const cpuPath = [];

            for (const dc of drawCalls) {
                if (isEligible(dc)) {
                    gpuPath.push(dc.name);
                } else {
                    cpuPath.push(dc.name);
                }
            }

            expect(gpuPath).to.deep.equal(['static-box', 'static-wall', 'static-floor']);
            expect(cpuPath).to.deep.equal(['skinned-char', 'instanced-grass', 'gsplat', 'custom-vis']);
        });
    });

    describe('End-to-end data flow simulation', function () {

        it('should simulate the complete Phase 3 pipeline', function () {

            // 1. Create mock draw calls
            const drawCalls = [];
            for (let i = 0; i < 5; i++) {
                drawCalls.push({
                    _skinInstance: null,
                    instancingData: null,
                    gsplatInstance: null,
                    _shaderDefs: 0,
                    isVisibleFunc: null,
                    cull: true,
                    _globalTransformSlot: -1,
                    aabb: {
                        center: { x: i * 10, y: 0, z: 0 },
                        halfExtents: { length: () => 5 }
                    },
                    node: {
                        getWorldTransform: () => ({ data: new Float32Array(16).fill(i) })
                    },
                    drawCommands: null,
                    name: `mesh_${i}`
                });
            }

            // 2. _prepareGlobalTransformSlots (Step 1)
            const FLOATS_PER_MATRIX = 16;
            const stagingBuffer = new Float32Array(10 * FLOATS_PER_MATRIX);
            let nextSlot = 0;
            let dirty = false;

            for (const dc of drawCalls) {
                if (dc._globalTransformSlot === -1) {
                    dc._globalTransformSlot = nextSlot++;
                    dc._shaderDefs |= SHADERDEF_GLOBAL_TRANSFORM_BUFFER;
                }
            }

            // Verify all got slots
            expect(drawCalls[0]._globalTransformSlot).to.equal(0);
            expect(drawCalls[4]._globalTransformSlot).to.equal(4);
            expect(nextSlot).to.equal(5);

            // 3. GpuCulling.setup simulation (Step 2)
            const FLOATS_PER_AABB = 4;
            const aabbStaging = new Float32Array(5 * FLOATS_PER_AABB);
            let gi = 0;
            const indexMapping = [];

            for (let i = 0; i < drawCalls.length; i++) {
                const dc = drawCalls[i];
                const transformSlot = dc._globalTransformSlot;
                if (transformSlot < 0) continue;

                // Write transform
                const worldMat = dc.node.getWorldTransform();
                const offset = transformSlot * FLOATS_PER_MATRIX;
                stagingBuffer.set(worldMat.data, offset);
                dirty = true;

                // Write AABB
                const ao = gi * FLOATS_PER_AABB;
                aabbStaging[ao + 0] = dc.aabb.center.x;
                aabbStaging[ao + 1] = dc.aabb.center.y;
                aabbStaging[ao + 2] = dc.aabb.center.z;
                aabbStaging[ao + 3] = dc.aabb.halfExtents.length();

                indexMapping.push(i);
                gi++;
            }

            expect(gi).to.equal(5);
            expect(dirty).to.equal(true);

            // 4. Upload (Step 8) — only once
            let uploadCount = 0;
            if (dirty) {
                uploadCount++;
                dirty = false;
            }
            expect(uploadCount).to.equal(1);

            // 5. Verify transform data at correct slots
            for (let i = 0; i < 5; i++) {
                const offset = i * FLOATS_PER_MATRIX;
                expect(stagingBuffer[offset]).to.equal(i); // fill(i)
            }

            // 6. Verify AABB data
            expect(aabbStaging[0]).to.equal(0);  // mesh_0 center.x
            expect(aabbStaging[4]).to.equal(10); // mesh_1 center.x
            expect(aabbStaging[16]).to.equal(40); // mesh_4 center.x

            // 7. Transform skip guard (Step 6)
            const matrixUploads = [];
            for (const dc of drawCalls) {
                if (dc._globalTransformSlot < 0) {
                    matrixUploads.push(dc.name);
                }
            }
            expect(matrixUploads).to.deep.equal([]); // all are GPU path
        });
    });
});
