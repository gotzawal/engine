import { expect } from 'chai';

import { WasmSceneMath } from '../../../src/scene/renderer/wasm-scene-math.js';

describe('WasmSceneMath', function () {

    describe('#constructor', function () {

        it('should allocate WASM linear memory for given capacity', function () {
            const wasm = new WasmSceneMath(128);
            expect(wasm.capacity).to.equal(128);
            expect(wasm.localMatrices).to.be.instanceOf(Float32Array);
            expect(wasm.worldMatrices).to.be.instanceOf(Float32Array);
            expect(wasm.parentIndices).to.be.instanceOf(Uint32Array);
            wasm.destroy();
        });

        it('should create Float32Array views for local/world matrices', function () {
            const capacity = 64;
            const wasm = new WasmSceneMath(capacity);
            expect(wasm.localMatrices.length).to.equal(capacity * 16);
            expect(wasm.worldMatrices.length).to.equal(capacity * 16);
            wasm.destroy();
        });

        it('should create Uint32Array view for parent indices', function () {
            const capacity = 64;
            const wasm = new WasmSceneMath(capacity);
            expect(wasm.parentIndices.length).to.equal(capacity);
            wasm.destroy();
        });

        it('should initialize parent indices to 0xFFFFFFFF (no parent)', function () {
            const wasm = new WasmSceneMath(16);
            for (let i = 0; i < 16; i++) {
                expect(wasm.parentIndices[i]).to.equal(0xFFFFFFFF);
            }
            wasm.destroy();
        });

        it('should default capacity to 4096', function () {
            const wasm = new WasmSceneMath();
            expect(wasm.capacity).to.equal(4096);
            wasm.destroy();
        });

    });

    describe('#setLocalMatrix', function () {

        it('should write 16 floats at correct offset in WASM memory', function () {
            const wasm = new WasmSceneMath(16);
            const identity = new Float32Array([
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1
            ]);
            wasm.setLocalMatrix(3, identity);

            const offset = 3 * 16;
            for (let i = 0; i < 16; i++) {
                expect(wasm.localMatrices[offset + i]).to.equal(identity[i]);
            }
            wasm.destroy();
        });

        it('should handle slot 0', function () {
            const wasm = new WasmSceneMath(16);
            const mat = new Float32Array(16);
            mat[0] = 42;
            wasm.setLocalMatrix(0, mat);
            expect(wasm.localMatrices[0]).to.equal(42);
            wasm.destroy();
        });

    });

    describe('#setWorldMatrix', function () {

        it('should write 16 floats at correct offset in world matrices buffer', function () {
            const wasm = new WasmSceneMath(16);
            const mat = new Float32Array([
                2, 0, 0, 0,
                0, 3, 0, 0,
                0, 0, 4, 0,
                5, 6, 7, 1
            ]);
            wasm.setWorldMatrix(5, mat);

            const offset = 5 * 16;
            for (let i = 0; i < 16; i++) {
                expect(wasm.worldMatrices[offset + i]).to.equal(mat[i]);
            }
            wasm.destroy();
        });

    });

    describe('#setParentIndex', function () {

        it('should store parent slot ID', function () {
            const wasm = new WasmSceneMath(16);
            wasm.setParentIndex(5, 2);
            expect(wasm.parentIndices[5]).to.equal(2);
            wasm.destroy();
        });

        it('should store 0xFFFFFFFF for root nodes', function () {
            const wasm = new WasmSceneMath(16);
            wasm.setParentIndex(0, 0xFFFFFFFF);
            expect(wasm.parentIndices[0]).to.equal(0xFFFFFFFF);
            wasm.destroy();
        });

    });

    describe('#computeBatch - JS fallback accuracy', function () {

        /**
         * Helper: create a column-major 4x4 identity matrix.
         */
        function identity() {
            return new Float32Array([
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1
            ]);
        }

        /**
         * Helper: create a column-major translation matrix.
         */
        function translation(tx, ty, tz) {
            return new Float32Array([
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                tx, ty, tz, 1
            ]);
        }

        /**
         * Helper: create a column-major scale matrix.
         */
        function scale(sx, sy, sz) {
            return new Float32Array([
                sx, 0, 0, 0,
                0, sy, 0, 0,
                0, 0, sz, 0,
                0, 0, 0, 1
            ]);
        }

        /**
         * Reference mat4 multiply (column-major): out = A * B
         */
        function mat4Mul(a, b) {
            const out = new Float32Array(16);
            for (let col = 0; col < 4; col++) {
                for (let row = 0; row < 4; row++) {
                    let sum = 0;
                    for (let k = 0; k < 4; k++) {
                        sum += a[k * 4 + row] * b[col * 4 + k];
                    }
                    out[col * 4 + row] = sum;
                }
            }
            return out;
        }

        it('should compute identity for root node with identity local', function () {
            const wasm = new WasmSceneMath(4);
            wasm.setLocalMatrix(0, identity());
            wasm.setParentIndex(0, 0xFFFFFFFF);
            wasm.markDirty(0);
            wasm.computeBatch();

            for (let i = 0; i < 16; i++) {
                expect(wasm.worldMatrices[i]).to.equal(identity()[i]);
            }
            wasm.destroy();
        });

        it('should copy local matrix for root nodes (no parent)', function () {
            const wasm = new WasmSceneMath(4);
            const local = translation(10, 20, 30);
            wasm.setLocalMatrix(0, local);
            wasm.setParentIndex(0, 0xFFFFFFFF);
            wasm.markDirty(0);
            wasm.computeBatch();

            for (let i = 0; i < 16; i++) {
                expect(wasm.worldMatrices[i]).to.be.closeTo(local[i], 1e-6);
            }
            wasm.destroy();
        });

        it('should multiply parent.world * child.local for child nodes', function () {
            const wasm = new WasmSceneMath(4);

            const parentLocal = translation(10, 0, 0);
            const childLocal = translation(0, 5, 0);

            wasm.setLocalMatrix(0, parentLocal);
            wasm.setParentIndex(0, 0xFFFFFFFF);

            wasm.setLocalMatrix(1, childLocal);
            wasm.setParentIndex(1, 0);

            // Process parent first (topological order)
            wasm.markDirty(0);
            wasm.markDirty(1);
            wasm.computeBatch();

            // Parent world = parentLocal = translate(10, 0, 0)
            expect(wasm.worldMatrices[0 * 16 + 12]).to.be.closeTo(10, 1e-6);
            expect(wasm.worldMatrices[0 * 16 + 13]).to.be.closeTo(0, 1e-6);

            // Child world = parent.world * childLocal = translate(10, 5, 0)
            const expected = mat4Mul(parentLocal, childLocal);
            expect(wasm.worldMatrices[1 * 16 + 12]).to.be.closeTo(expected[12], 1e-6);
            expect(wasm.worldMatrices[1 * 16 + 13]).to.be.closeTo(expected[13], 1e-6);
            expect(expected[12]).to.be.closeTo(10, 1e-6);
            expect(expected[13]).to.be.closeTo(5, 1e-6);

            wasm.destroy();
        });

        it('should handle 3-level deep hierarchy (grandchild)', function () {
            const wasm = new WasmSceneMath(4);

            const rootLocal = translation(1, 0, 0);
            const childLocal = translation(0, 2, 0);
            const grandchildLocal = translation(0, 0, 3);

            wasm.setLocalMatrix(0, rootLocal);
            wasm.setParentIndex(0, 0xFFFFFFFF);

            wasm.setLocalMatrix(1, childLocal);
            wasm.setParentIndex(1, 0);

            wasm.setLocalMatrix(2, grandchildLocal);
            wasm.setParentIndex(2, 1);

            wasm.markDirty(0);
            wasm.markDirty(1);
            wasm.markDirty(2);
            wasm.computeBatch();

            // Grandchild world = root.world * child.local * grandchild.local
            const rootWorld = rootLocal;
            const childWorld = mat4Mul(rootWorld, childLocal);
            const grandchildWorld = mat4Mul(childWorld, grandchildLocal);

            // Should be at position (1, 2, 3)
            expect(wasm.worldMatrices[2 * 16 + 12]).to.be.closeTo(grandchildWorld[12], 1e-5);
            expect(wasm.worldMatrices[2 * 16 + 13]).to.be.closeTo(grandchildWorld[13], 1e-5);
            expect(wasm.worldMatrices[2 * 16 + 14]).to.be.closeTo(grandchildWorld[14], 1e-5);

            wasm.destroy();
        });

        it('should handle non-uniform scale correctly', function () {
            const wasm = new WasmSceneMath(4);

            const parentLocal = scale(2, 3, 4);
            const childLocal = translation(1, 1, 1);

            wasm.setLocalMatrix(0, parentLocal);
            wasm.setParentIndex(0, 0xFFFFFFFF);

            wasm.setLocalMatrix(1, childLocal);
            wasm.setParentIndex(1, 0);

            wasm.markDirty(0);
            wasm.markDirty(1);
            wasm.computeBatch();

            const expected = mat4Mul(parentLocal, childLocal);
            for (let i = 0; i < 16; i++) {
                expect(wasm.worldMatrices[1 * 16 + i]).to.be.closeTo(expected[i], 1e-5);
            }

            // Translation should be scaled: (2, 3, 4)
            expect(wasm.worldMatrices[1 * 16 + 12]).to.be.closeTo(2, 1e-5);
            expect(wasm.worldMatrices[1 * 16 + 13]).to.be.closeTo(3, 1e-5);
            expect(wasm.worldMatrices[1 * 16 + 14]).to.be.closeTo(4, 1e-5);

            wasm.destroy();
        });

    });

    describe('#computeBatch - edge cases', function () {

        it('should handle empty dirty list (no work)', function () {
            const wasm = new WasmSceneMath(4);
            // Don't mark anything dirty
            wasm.computeBatch(); // should not throw
            wasm.destroy();
        });

        it('should handle all nodes dirty (full recompute)', function () {
            const wasm = new WasmSceneMath(4);
            const id = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

            for (let i = 0; i < 4; i++) {
                wasm.setLocalMatrix(i, id);
                wasm.setParentIndex(i, 0xFFFFFFFF);
                wasm.markDirty(i);
            }
            wasm.computeBatch();

            for (let i = 0; i < 4; i++) {
                expect(wasm.worldMatrices[i * 16]).to.equal(1);
                expect(wasm.worldMatrices[i * 16 + 15]).to.equal(1);
            }
            wasm.destroy();
        });

        it('should handle single root node', function () {
            const wasm = new WasmSceneMath(1);
            const local = new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 5, 6, 7, 1]);
            wasm.setLocalMatrix(0, local);
            wasm.setParentIndex(0, 0xFFFFFFFF);
            wasm.markDirty(0);
            wasm.computeBatch();

            for (let i = 0; i < 16; i++) {
                expect(wasm.worldMatrices[i]).to.equal(local[i]);
            }
            wasm.destroy();
        });

        it('should handle flat hierarchy (all roots, no parents)', function () {
            const wasm = new WasmSceneMath(8);
            for (let i = 0; i < 8; i++) {
                const local = new Float32Array(16);
                local[0] = local[5] = local[10] = local[15] = 1;
                local[12] = i * 10;
                wasm.setLocalMatrix(i, local);
                wasm.setParentIndex(i, 0xFFFFFFFF);
                wasm.markDirty(i);
            }
            wasm.computeBatch();

            for (let i = 0; i < 8; i++) {
                expect(wasm.worldMatrices[i * 16 + 12]).to.equal(i * 10);
            }
            wasm.destroy();
        });

    });

    describe('#getWorldMatricesBuffer', function () {

        it('should return Float32Array view directly into WASM memory (zero-copy)', function () {
            const wasm = new WasmSceneMath(16);
            const buffer = wasm.getWorldMatricesBuffer();
            expect(buffer).to.be.instanceOf(Float32Array);
            expect(buffer).to.equal(wasm.worldMatrices);
            wasm.destroy();
        });

        it('should have correct length for writeBuffer usage', function () {
            const capacity = 128;
            const wasm = new WasmSceneMath(capacity);
            const buffer = wasm.getWorldMatricesBuffer();
            expect(buffer.length).to.equal(capacity * 16);
            wasm.destroy();
        });

    });

    describe('#resize', function () {

        it('should grow when capacity exceeded', function () {
            const wasm = new WasmSceneMath(4);
            expect(wasm.capacity).to.equal(4);

            // Setting a slot beyond capacity should trigger resize
            const mat = new Float32Array(16);
            mat[0] = 99;
            wasm.setLocalMatrix(10, mat);

            expect(wasm.capacity).to.be.greaterThanOrEqual(11);
            expect(wasm.localMatrices[10 * 16]).to.equal(99);
            wasm.destroy();
        });

        it('should preserve existing matrix data after grow', function () {
            const wasm = new WasmSceneMath(4);
            const mat = new Float32Array(16);
            mat[0] = 42;
            mat[15] = 7;
            wasm.setLocalMatrix(0, mat);

            // Force resize
            const mat2 = new Float32Array(16);
            mat2[0] = 100;
            wasm.setLocalMatrix(10, mat2);

            // Original data should be preserved
            expect(wasm.localMatrices[0]).to.equal(42);
            expect(wasm.localMatrices[15]).to.equal(7);
            // New data should be present
            expect(wasm.localMatrices[10 * 16]).to.equal(100);
            wasm.destroy();
        });

    });

    describe('#allocateSlot', function () {

        it('should return sequential slot indices', function () {
            const wasm = new WasmSceneMath(16);
            expect(wasm.allocateSlot()).to.equal(0);
            expect(wasm.allocateSlot()).to.equal(1);
            expect(wasm.allocateSlot()).to.equal(2);
            wasm.destroy();
        });

        it('should reuse freed slots', function () {
            const wasm = new WasmSceneMath(16);
            const s0 = wasm.allocateSlot(); // 0
            const s1 = wasm.allocateSlot(); // 1
            wasm.freeSlot(s0);
            const s2 = wasm.allocateSlot(); // should reuse 0
            expect(s2).to.equal(0);
            wasm.destroy();
        });

        it('should auto-resize when capacity exceeded', function () {
            const wasm = new WasmSceneMath(2);
            wasm.allocateSlot(); // 0
            wasm.allocateSlot(); // 1
            wasm.allocateSlot(); // 2 — triggers resize
            expect(wasm.capacity).to.be.greaterThanOrEqual(3);
            wasm.destroy();
        });

    });

    describe('#writeBackWorldTransforms', function () {

        it('should copy world matrices from WASM buffer to node.worldTransform', function () {
            const wasm = new WasmSceneMath(4);

            // Create mock nodes with _wasmSlot and worldTransform
            const mockNode = {
                _enabled: true,
                _wasmSlot: 0,
                worldTransform: { data: new Float32Array(16) },
                _children: []
            };

            // Write a known matrix into WASM world buffer at slot 0
            const mat = new Float32Array([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1]);
            wasm.worldMatrices.set(mat, 0);

            wasm.writeBackWorldTransforms(mockNode);

            expect(mockNode.worldTransform.data[0]).to.equal(2);
            expect(mockNode.worldTransform.data[5]).to.equal(3);
            expect(mockNode.worldTransform.data[12]).to.equal(5);
            expect(mockNode.worldTransform.data[15]).to.equal(1);
            wasm.destroy();
        });

        it('should recurse through children', function () {
            const wasm = new WasmSceneMath(4);

            const child = {
                _enabled: true,
                _wasmSlot: 1,
                worldTransform: { data: new Float32Array(16) },
                _children: []
            };
            const parent = {
                _enabled: true,
                _wasmSlot: 0,
                worldTransform: { data: new Float32Array(16) },
                _children: [child]
            };

            // Write different matrices for parent (slot 0) and child (slot 1)
            wasm.worldMatrices[0] = 10;  // parent m[0]
            wasm.worldMatrices[16] = 20; // child m[0]

            wasm.writeBackWorldTransforms(parent);

            expect(parent.worldTransform.data[0]).to.equal(10);
            expect(child.worldTransform.data[0]).to.equal(20);
            wasm.destroy();
        });

        it('should skip disabled nodes', function () {
            const wasm = new WasmSceneMath(4);

            const node = {
                _enabled: false,
                _wasmSlot: 0,
                worldTransform: { data: new Float32Array(16) },
                _children: []
            };

            wasm.worldMatrices[0] = 99;
            wasm.writeBackWorldTransforms(node);

            expect(node.worldTransform.data[0]).to.equal(0); // not overwritten
            wasm.destroy();
        });

    });

    describe('#computeBatch - mat4 multiplication order', function () {

        /**
         * Reference mat4 multiply (column-major): out = A * B
         */
        function mat4Mul(a, b) {
            const out = new Float32Array(16);
            for (let col = 0; col < 4; col++) {
                for (let row = 0; row < 4; row++) {
                    let sum = 0;
                    for (let k = 0; k < 4; k++) {
                        sum += a[k * 4 + row] * b[col * 4 + k];
                    }
                    out[col * 4 + row] = sum;
                }
            }
            return out;
        }

        it('should compute parent.world * child.local (NOT child.local * parent.world)', function () {
            // This test verifies the multiplication order is correct.
            // If reversed, non-commutative transforms (rotation + translation) will differ.
            const wasm = new WasmSceneMath(4);

            // Parent: rotation 90 degrees around Z axis (column-major)
            const parentLocal = new Float32Array([
                0, 1, 0, 0,   // col 0
                -1, 0, 0, 0,  // col 1
                0, 0, 1, 0,   // col 2
                0, 0, 0, 1    // col 3
            ]);

            // Child: translation (5, 0, 0)
            const childLocal = new Float32Array([
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                5, 0, 0, 1
            ]);

            wasm.setLocalMatrix(0, parentLocal);
            wasm.setParentIndex(0, 0xFFFFFFFF);
            wasm.setLocalMatrix(1, childLocal);
            wasm.setParentIndex(1, 0);

            wasm.markDirty(0);
            wasm.markDirty(1);
            wasm.computeBatch();

            // Correct: parent.world * child.local
            // Parent rotates 90° Z, then child translates (5,0,0) in parent's frame
            // Result position: rotating (5,0,0) by 90° Z = (0,5,0)
            const expected = mat4Mul(parentLocal, childLocal);
            expect(expected[12]).to.be.closeTo(0, 1e-5);  // x ≈ 0
            expect(expected[13]).to.be.closeTo(5, 1e-5);  // y ≈ 5

            // Verify WASM matches
            expect(wasm.worldMatrices[1 * 16 + 12]).to.be.closeTo(expected[12], 1e-5);
            expect(wasm.worldMatrices[1 * 16 + 13]).to.be.closeTo(expected[13], 1e-5);

            // Verify it does NOT match the reversed order (C * P ≠ P * C)
            const reversed = mat4Mul(childLocal, parentLocal);
            // C * P: translation (5,0,0) applied in world space after rotation
            // col3 of C*P = C * (0,0,0,1) = (5,0,0,1)
            expect(reversed[12]).to.be.closeTo(5, 1e-5);
            expect(reversed[13]).to.be.closeTo(0, 1e-5);
            // Confirm the two orders produce different results
            expect(expected[12]).to.not.equal(reversed[12]);

            wasm.destroy();
        });

        it('should handle 5-level deep hierarchy with mixed rotation+scale+translation', function () {
            const wasm = new WasmSceneMath(8);

            function mat4Mul(a, b) {
                const out = new Float32Array(16);
                for (let col = 0; col < 4; col++) {
                    for (let row = 0; row < 4; row++) {
                        let sum = 0;
                        for (let k = 0; k < 4; k++) {
                            sum += a[k * 4 + row] * b[col * 4 + k];
                        }
                        out[col * 4 + row] = sum;
                    }
                }
                return out;
            }

            // Level 0: translate(10, 0, 0)
            const l0 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1]);
            // Level 1: scale(2, 2, 2)
            const l1 = new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]);
            // Level 2: translate(0, 5, 0)
            const l2 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 5, 0, 1]);
            // Level 3: rotate 90° around Z
            const l3 = new Float32Array([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
            // Level 4: translate(1, 0, 0)
            const l4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1]);

            const locals = [l0, l1, l2, l3, l4];
            for (let i = 0; i < 5; i++) {
                wasm.setLocalMatrix(i, locals[i]);
                wasm.setParentIndex(i, i === 0 ? 0xFFFFFFFF : i - 1);
                wasm.markDirty(i);
            }
            wasm.computeBatch();

            // Compute reference: chain multiplication
            let refWorld = l0;
            for (let i = 1; i < 5; i++) {
                refWorld = mat4Mul(refWorld, locals[i]);
            }

            // Compare all 16 elements of the deepest node
            for (let i = 0; i < 16; i++) {
                expect(wasm.worldMatrices[4 * 16 + i]).to.be.closeTo(refWorld[i], 1e-4,
                    `mismatch at element ${i}`);
            }

            wasm.destroy();
        });

    });

    describe('#markDirty - overflow protection', function () {

        it('should not crash when marking dirty beyond capacity', function () {
            const wasm = new WasmSceneMath(4);
            // Fill dirty list to capacity
            for (let i = 0; i < 4; i++) {
                wasm.markDirty(i);
            }
            // This should be silently ignored, not crash
            wasm.markDirty(99);
            expect(wasm._dirtyCount).to.equal(4);
            wasm.destroy();
        });

    });

    describe('#clearDirtyList + computeBatch interaction', function () {

        it('should be a no-op when dirty list is cleared before computeBatch', function () {
            const wasm = new WasmSceneMath(4);
            const local = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 99, 0, 0, 1]);
            wasm.setLocalMatrix(0, local);
            wasm.setParentIndex(0, 0xFFFFFFFF);
            wasm.markDirty(0);

            // Clear before compute — should result in no computation
            wasm.clearDirtyList();
            wasm.computeBatch();

            // World matrix should still be all zeros (never computed)
            expect(wasm.worldMatrices[12]).to.equal(0);
            wasm.destroy();
        });

    });

    describe('#destroy', function () {

        it('should null all buffers', function () {
            const wasm = new WasmSceneMath(16);
            wasm.destroy();
            expect(wasm.localMatrices).to.be.null;
            expect(wasm.worldMatrices).to.be.null;
            expect(wasm.parentIndices).to.be.null;
            expect(wasm.ready).to.be.false;
        });

    });

});
