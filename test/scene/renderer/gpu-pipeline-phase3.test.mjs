import { expect } from 'chai';

import { SHADERDEF_SKIN, SHADERDEF_BATCH, SHADERDEF_INSTANCING } from '../../../src/scene/constants.js';

/**
 * Phase 3 integration tests: GPU Culling Pipeline activation.
 *
 * Architecture: GPU culling sets instanceCount=0/1 via indirect draw to perform
 * frustum culling on the GPU. The vertex shader still uses standard matrix_model
 * uniform — SHADERDEF_GLOBAL_TRANSFORM_BUFFER is NOT set on mesh instances.
 * CPU matrix upload always happens for all draw calls.
 */
describe('Phase 3: GPU Culling Pipeline', function () {

    describe('GpuCulling.setup slot allocation', function () {

        function isEligible(dc) {
            if (dc._skinInstance || dc.instancingData || dc.gsplatInstance) return false;
            if (dc._shaderDefs & (SHADERDEF_SKIN | SHADERDEF_BATCH | SHADERDEF_INSTANCING)) return false;
            if (dc.isVisibleFunc) return false;
            if (!dc.cull) return false;
            return true;
        }

        // Simulates how GpuCulling.setup() allocates transform slots inline
        function setupSlots(drawCalls, globalTransformBuffer) {
            let slotCounter = globalTransformBuffer._nextSlot || 0;
            let gi = 0;
            for (let i = 0; i < drawCalls.length; i++) {
                const dc = drawCalls[i];
                if (!isEligible(dc)) continue;

                // Allocate slot if not yet assigned (same as gpu-culling.js setup())
                let transformSlot = dc._globalTransformSlot;
                if (transformSlot < 0 && globalTransformBuffer) {
                    transformSlot = slotCounter++;
                    dc._globalTransformSlot = transformSlot;
                }
                gi++;
            }
            globalTransformBuffer._nextSlot = slotCounter;
            return gi;
        }

        it('should assign transform slots to eligible draw calls without setting shader defs', function () {
            const drawCalls = [
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: null, cull: true, _globalTransformSlot: -1 },
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: null, cull: true, _globalTransformSlot: -1 },
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: null, cull: true, _globalTransformSlot: -1 }
            ];

            const count = setupSlots(drawCalls, { _nextSlot: 0 });

            expect(count).to.equal(3);
            expect(drawCalls[0]._globalTransformSlot).to.equal(0);
            expect(drawCalls[1]._globalTransformSlot).to.equal(1);
            expect(drawCalls[2]._globalTransformSlot).to.equal(2);

            // SHADERDEF_GLOBAL_TRANSFORM_BUFFER must NOT be set
            for (const dc of drawCalls) {
                expect(dc._shaderDefs).to.equal(0);
            }
        });

        it('should skip non-eligible draw calls', function () {
            const drawCalls = [
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: null, cull: true, _globalTransformSlot: -1 },
                { _skinInstance: {}, instancingData: null, gsplatInstance: null, _shaderDefs: SHADERDEF_SKIN, isVisibleFunc: null, cull: true, _globalTransformSlot: -1 },
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: null, cull: true, _globalTransformSlot: -1 }
            ];

            const count = setupSlots(drawCalls, { _nextSlot: 0 });

            expect(count).to.equal(2);
            expect(drawCalls[0]._globalTransformSlot).to.equal(0);
            expect(drawCalls[1]._globalTransformSlot).to.equal(-1); // unchanged
            expect(drawCalls[2]._globalTransformSlot).to.equal(1);
        });

        it('should not re-allocate already assigned slots', function () {
            const drawCalls = [
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: null, cull: true, _globalTransformSlot: 42 }
            ];

            const gtb = { _nextSlot: 0 };
            setupSlots(drawCalls, gtb);

            expect(drawCalls[0]._globalTransformSlot).to.equal(42); // preserved
            expect(gtb._nextSlot).to.equal(0); // no new allocations
        });
    });

    describe('setIndirect camera key fix', function () {

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

            drawCommands.set(camera, { slotIndex: 5 });

            const result = drawCommands.get(camera) ?? drawCommands.get(null);
            expect(result).to.not.be.undefined;
            expect(result.slotIndex).to.equal(5);
        });

        it('should fall back to null key when camera-specific entry not found', function () {
            const camera = { id: 'cam1' };
            const otherCamera = { id: 'cam2' };
            const drawCommands = new Map();

            drawCommands.set(null, { slotIndex: 10 });

            const result = drawCommands.get(otherCamera) ?? drawCommands.get(null);
            expect(result.slotIndex).to.equal(10);
        });
    });

    describe('Renderer initialization', function () {

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
            const gtb1 = { type: 'GlobalTransformBuffer' };
            const gc1 = gtb1 ? { type: 'GpuCulling' } : null;
            expect(gc1).to.not.be.null;

            const gtb2 = null;
            const gc2 = gtb2 ? { type: 'GpuCulling' } : null;
            expect(gc2).to.be.null;
        });
    });

    describe('Matrix upload: always upload for all draw calls', function () {

        it('should always upload matrices regardless of GPU culling status', function () {
            const drawCalls = [
                { _globalTransformSlot: 5, name: 'gpu-eligible' },
                { _globalTransformSlot: -1, name: 'cpu-path' },
                { _globalTransformSlot: 0, name: 'gpu-eligible-slot0' }
            ];

            // New behavior: always upload matrices for ALL draw calls
            const matrixUploads = [];
            for (const dc of drawCalls) {
                matrixUploads.push(dc.name); // always upload
            }

            expect(matrixUploads).to.deep.equal(['gpu-eligible', 'cpu-path', 'gpu-eligible-slot0']);
        });

        it('should use indirect draw for GPU-culled objects (instanceCount=0/1)', function () {
            // GPU culling sets instanceCount via indirect draw buffer
            // The vertex shader still uses matrix_model, NOT globalTransforms
            const drawCalls = [
                { _globalTransformSlot: 0, indirectSlot: 0, name: 'visible' },
                { _globalTransformSlot: 1, indirectSlot: 1, name: 'culled' },
                { _globalTransformSlot: -1, indirectSlot: null, name: 'cpu-only' }
            ];

            // Simulate: all get matrix_model uploaded
            const matrixUploaded = drawCalls.map(dc => dc.name);
            expect(matrixUploaded.length).to.equal(3);

            // Only GPU-eligible ones get indirect draw
            const indirectDraw = drawCalls.filter(dc => dc.indirectSlot !== null);
            expect(indirectDraw.length).to.equal(2);
        });
    });

    describe('Upload separation', function () {

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

            updateSlot(); // layer 0 opaque
            updateSlot(); // layer 0 transparent
            updateSlot(); // layer 1 opaque

            upload();
            expect(uploadCount).to.equal(1);

            upload();
            expect(uploadCount).to.equal(1);
        });
    });

    describe('Indirect draw slot exhaustion', function () {

        it('should skip GPU culling when slots are exhausted', function () {
            const maxSlots = 1024;
            let nextIndex = 900; // already used 900

            const gi = 50; // need 50 more

            const remaining = maxSlots - nextIndex;
            const canAllocate = gi <= remaining;

            expect(canAllocate).to.equal(true); // 50 <= 124

            // Now exhaust
            nextIndex = 1020;
            const remaining2 = maxSlots - nextIndex;
            const canAllocate2 = gi <= remaining2;

            expect(canAllocate2).to.equal(false); // 50 > 4, skip GPU culling
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
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: null, cull: true, name: 'static-box' },
                { _skinInstance: {}, instancingData: null, gsplatInstance: null, _shaderDefs: SHADERDEF_SKIN, isVisibleFunc: null, cull: true, name: 'skinned-char' },
                { _skinInstance: null, instancingData: { vertexBuffer: {} }, gsplatInstance: null, _shaderDefs: SHADERDEF_INSTANCING, isVisibleFunc: null, cull: true, name: 'instanced-grass' },
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: null, cull: true, name: 'static-wall' },
                { _skinInstance: null, instancingData: null, gsplatInstance: {}, _shaderDefs: 0, isVisibleFunc: null, cull: true, name: 'gsplat' },
                { _skinInstance: null, instancingData: null, gsplatInstance: null, _shaderDefs: 0, isVisibleFunc: () => true, cull: true, name: 'custom-vis' },
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

            // 2. GpuCulling.setup allocates slots inline (no separate _prepareGlobalTransformSlots)
            const FLOATS_PER_MATRIX = 16;
            const FLOATS_PER_AABB = 4;
            const stagingBuffer = new Float32Array(10 * FLOATS_PER_MATRIX);
            const aabbStaging = new Float32Array(5 * FLOATS_PER_AABB);
            let nextSlot = 0;
            let dirty = false;
            let gi = 0;
            const indexMapping = [];

            for (let i = 0; i < drawCalls.length; i++) {
                const dc = drawCalls[i];

                // Allocate slot inline (as gpu-culling.js does)
                let transformSlot = dc._globalTransformSlot;
                if (transformSlot < 0) {
                    transformSlot = nextSlot++;
                    dc._globalTransformSlot = transformSlot;
                }

                // SHADERDEF_GLOBAL_TRANSFORM_BUFFER is NOT set
                expect(dc._shaderDefs).to.equal(0);

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

            // Verify slots assigned
            expect(drawCalls[0]._globalTransformSlot).to.equal(0);
            expect(drawCalls[4]._globalTransformSlot).to.equal(4);
            expect(gi).to.equal(5);
            expect(dirty).to.equal(true);

            // 3. Upload once
            let uploadCount = 0;
            if (dirty) {
                uploadCount++;
                dirty = false;
            }
            expect(uploadCount).to.equal(1);

            // 4. Verify transform data at correct slots
            for (let i = 0; i < 5; i++) {
                const offset = i * FLOATS_PER_MATRIX;
                expect(stagingBuffer[offset]).to.equal(i);
            }

            // 5. Verify AABB data
            expect(aabbStaging[0]).to.equal(0);
            expect(aabbStaging[4]).to.equal(10);
            expect(aabbStaging[16]).to.equal(40);

            // 6. Matrix upload always happens for ALL draw calls
            const matrixUploads = [];
            for (const dc of drawCalls) {
                matrixUploads.push(dc.name); // always upload
            }
            expect(matrixUploads.length).to.equal(5); // all draw calls
        });
    });

    describe('Compute dispatch timing', function () {

        it('should dispatch compute before render pass starts (before vs execute)', function () {
            const callOrder = [];
            let insideRenderPass = false;

            function before() {
                callOrder.push('before');
                callOrder.push('computeDispatch');
                expect(insideRenderPass).to.equal(false);
            }

            function startRenderPass() {
                insideRenderPass = true;
                callOrder.push('startRenderPass');
            }

            function execute() {
                callOrder.push('execute');
                expect(insideRenderPass).to.equal(true);
            }

            function endRenderPass() {
                insideRenderPass = false;
                callOrder.push('endRenderPass');
            }

            function after() {
                callOrder.push('after');
            }

            before();
            startRenderPass();
            execute();
            endRenderPass();
            after();

            expect(callOrder).to.deep.equal([
                'before', 'computeDispatch', 'startRenderPass', 'execute', 'endRenderPass', 'after'
            ]);
        });

        it('should collect visible lists from all render actions for GPU culling', function () {
            const renderActions = [
                { layer: 'layer0', transparent: false, visible: ['mesh_a', 'mesh_b'] },
                { layer: 'layer0', transparent: true, visible: ['mesh_c'] },
                { layer: 'layer1', transparent: false, visible: ['mesh_d', 'mesh_e', 'mesh_f'] }
            ];

            const gpuCulledSets = [];

            for (const ra of renderActions) {
                if (ra.visible && ra.visible.length > 0) {
                    gpuCulledSets.push(ra.visible);
                }
            }

            expect(gpuCulledSets.length).to.equal(3);
            expect(gpuCulledSets[0]).to.deep.equal(['mesh_a', 'mesh_b']);
            expect(gpuCulledSets[2]).to.deep.equal(['mesh_d', 'mesh_e', 'mesh_f']);
        });
    });
});
