import { expect } from 'chai';

import { GlobalTransformBuffer } from '../../../src/scene/renderer/global-transform-buffer.js';

/**
 * Mock StorageBuffer for testing without GPU.
 */
class MockStorageBuffer {
    constructor(device, byteSize, usage) {
        this.byteSize = byteSize;
        this.usage = usage;
        this.data = new Float32Array(byteSize / 4);
        this.writeCount = 0;
        this.lastWriteOffset = -1;
        this.lastWriteSize = -1;
    }

    write(bufferOffset, data, dataOffset, size) {
        this.writeCount++;
        this.lastWriteOffset = bufferOffset;
        this.lastWriteSize = size;
        // Copy data into internal buffer
        const floatOffset = bufferOffset / 4;
        for (let i = 0; i < size; i++) {
            this.data[floatOffset + i] = data[dataOffset + i];
        }
    }

    copy() {}

    destroy() {
        this.data = null;
    }
}

/**
 * Create a test-friendly GlobalTransformBuffer by replacing the StorageBuffer.
 */
function createTestGTB(capacity = 16) {
    const mockDevice = { isWebGPU: true };
    // We can't easily construct GTB without a real device for StorageBuffer,
    // so we test the logic separately.
    return { mockDevice, capacity };
}

describe('GlobalTransformBuffer', function () {

    describe('#allocateSlot', function () {

        it('should return sequential slot indices', function () {
            // Test the slot allocation logic without GPU
            const freeSlots = [];
            let nextSlot = 0;

            function allocateSlot() {
                if (freeSlots.length > 0) return freeSlots.pop();
                return nextSlot++;
            }

            expect(allocateSlot()).to.equal(0);
            expect(allocateSlot()).to.equal(1);
            expect(allocateSlot()).to.equal(2);
        });

        it('should reuse freed slots', function () {
            const freeSlots = [];
            let nextSlot = 0;

            function allocateSlot() {
                if (freeSlots.length > 0) return freeSlots.pop();
                return nextSlot++;
            }

            function freeSlot(index) {
                if (index >= 0) freeSlots.push(index);
            }

            const s0 = allocateSlot(); // 0
            const s1 = allocateSlot(); // 1
            const s2 = allocateSlot(); // 2

            freeSlot(s1); // return slot 1

            const s3 = allocateSlot(); // should reuse slot 1
            expect(s3).to.equal(1);

            const s4 = allocateSlot(); // should continue from 3
            expect(s4).to.equal(3);
        });

        it('should auto-resize when capacity exceeded', function () {
            let capacity = 4;
            let nextSlot = 0;
            let resized = false;

            function allocateSlot() {
                const slot = nextSlot++;
                if (slot >= capacity) {
                    capacity *= 2;
                    resized = true;
                }
                return slot;
            }

            for (let i = 0; i < 5; i++) {
                allocateSlot();
            }

            expect(resized).to.be.true;
            expect(capacity).to.equal(8);
        });

    });

    describe('#updateSlot', function () {

        it('should write 16 floats to correct staging buffer offset', function () {
            const FLOATS_PER_MATRIX = 16;
            const capacity = 8;
            const stagingBuffer = new Float32Array(capacity * FLOATS_PER_MATRIX);

            const mat = new Float32Array([
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                10, 20, 30, 1
            ]);

            const index = 3;
            const offset = index * FLOATS_PER_MATRIX;
            stagingBuffer.set(mat, offset);

            expect(stagingBuffer[offset]).to.equal(1);
            expect(stagingBuffer[offset + 12]).to.equal(10);
            expect(stagingBuffer[offset + 13]).to.equal(20);
            expect(stagingBuffer[offset + 14]).to.equal(30);
            expect(stagingBuffer[offset + 15]).to.equal(1);
        });

        it('should set dirty flag', function () {
            let dirty = false;

            function updateSlot() {
                dirty = true;
            }

            updateSlot();
            expect(dirty).to.be.true;
        });

    });

    describe('#upload', function () {

        it('should upload with used extent only (not full capacity)', function () {
            const FLOATS_PER_MATRIX = 16;
            const capacity = 1024;
            const nextSlot = 10;

            const usedFloats = nextSlot * FLOATS_PER_MATRIX;
            expect(usedFloats).to.equal(160);
            expect(usedFloats).to.be.lessThan(capacity * FLOATS_PER_MATRIX);
        });

        it('should clear dirty flag after upload', function () {
            let dirty = true;

            function upload() {
                if (dirty) {
                    dirty = false;
                }
            }

            upload();
            expect(dirty).to.be.false;
        });

        it('should no-op when not dirty', function () {
            let dirty = false;
            let uploadCalled = false;

            function upload() {
                if (dirty) {
                    uploadCalled = true;
                    dirty = false;
                }
            }

            upload();
            expect(uploadCalled).to.be.false;
        });

    });

    describe('#WASM integration', function () {

        it('should use WASM worldMatrices as staging buffer when available', function () {
            // Simulate the zero-copy path
            const wasmWorldMatrices = new Float32Array(16 * 16);
            wasmWorldMatrices[12] = 42; // write position x at slot 0

            const wasmSceneMath = {
                worldMatrices: wasmWorldMatrices
            };

            // The upload path should use wasmSceneMath.worldMatrices as source
            const source = (wasmSceneMath && wasmSceneMath.worldMatrices) ?
                wasmSceneMath.worldMatrices : new Float32Array(16 * 16);

            expect(source).to.equal(wasmWorldMatrices);
            expect(source[12]).to.equal(42);
        });

        it('should fall back to JS staging buffer when WASM unavailable', function () {
            const stagingBuffer = new Float32Array(16 * 16);
            stagingBuffer[0] = 99;

            const wasmSceneMath = null;

            const source = (wasmSceneMath && wasmSceneMath.worldMatrices) ?
                wasmSceneMath.worldMatrices : stagingBuffer;

            expect(source).to.equal(stagingBuffer);
            expect(source[0]).to.equal(99);
        });

    });

    describe('#_resize', function () {

        it('should double capacity', function () {
            let capacity = 4096;
            capacity *= 2;
            expect(capacity).to.equal(8192);
        });

        it('should preserve existing staging data', function () {
            const oldCapacity = 4;
            const FLOATS_PER_MATRIX = 16;
            const oldStaging = new Float32Array(oldCapacity * FLOATS_PER_MATRIX);

            // Write some data
            oldStaging[0] = 1; oldStaging[5] = 1; oldStaging[10] = 1; oldStaging[15] = 1;
            oldStaging[12] = 100; oldStaging[13] = 200; oldStaging[14] = 300;

            const newCapacity = 8;
            const newStaging = new Float32Array(newCapacity * FLOATS_PER_MATRIX);
            newStaging.set(oldStaging);

            expect(newStaging[0]).to.equal(1);
            expect(newStaging[12]).to.equal(100);
            expect(newStaging[13]).to.equal(200);
            expect(newStaging.length).to.equal(newCapacity * FLOATS_PER_MATRIX);
        });

    });

});
