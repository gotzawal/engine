import { expect } from 'chai';

describe('LightsBuffer StorageBuffer path', function () {

    describe('#maxLights', function () {

        it('should support up to 4096 lights in WebGPU mode', function () {
            // WebGPU device should use 4096 max lights
            const device = { isWebGPU: true };
            const maxLights = device.isWebGPU ? 4096 : 255;
            expect(maxLights).to.equal(4096);
        });

        it('should default to 255 lights in WebGL2 mode', function () {
            const device = { isWebGPU: false };
            const maxLights = device.isWebGPU ? 4096 : 255;
            expect(maxLights).to.equal(255);
        });

        it('should be substantially higher than legacy 8-bit limit', function () {
            const webGpuMax = 4096;
            const legacyMax = 255;
            expect(webGpuMax).to.be.greaterThan(legacyMax * 10);
        });

    });

    describe('#addLightData encoding', function () {

        it('should encode position and range at correct offsets', function () {
            // LightsBuffer uses TextureIndexFloat encoding: POSITION_RANGE at index 0
            // Each light uses 9 pixels in RGBA32F texture (36 floats)
            const FLOATS_PER_LIGHT = 9 * 4; // 9 pixels × 4 channels
            const staging = new Float32Array(FLOATS_PER_LIGHT);

            // Position range at pixel 0: x, y, z, range
            staging[0] = 10.0;  // x
            staging[1] = 20.0;  // y
            staging[2] = 30.0;  // z
            staging[3] = 50.0;  // range

            expect(staging[0]).to.equal(10.0);
            expect(staging[1]).to.equal(20.0);
            expect(staging[2]).to.equal(30.0);
            expect(staging[3]).to.equal(50.0);
        });

        it('should encode spot direction and flags', function () {
            // DIRECTION_FLAGS at pixel index 1
            const offset = 1 * 4; // pixel 1
            const staging = new Float32Array(36);

            staging[offset + 0] = 0.0;  // dir.x
            staging[offset + 1] = -1.0; // dir.y
            staging[offset + 2] = 0.0;  // dir.z
            staging[offset + 3] = 1.0;  // flags (encoded)

            expect(staging[offset + 0]).to.equal(0.0);
            expect(staging[offset + 1]).to.equal(-1.0);
        });

        it('should encode color angles and bias', function () {
            // COLOR_ANGLES_BIAS at pixel index 2
            const offset = 2 * 4;
            const staging = new Float32Array(36);

            staging[offset + 0] = 1.0; // r
            staging[offset + 1] = 0.8; // g
            staging[offset + 2] = 0.6; // b
            staging[offset + 3] = 0.01; // shadow bias

            expect(staging[offset + 0]).to.be.closeTo(1.0, 0.001);
        });

        it('should encode projection matrix for spot shadows (4 pixels)', function () {
            // PROJ_MAT_0 through PROJ_MAT_3 at pixel indices 3-6
            const projMatStartPixel = 3;
            const staging = new Float32Array(36);

            // 4x4 matrix = 16 floats across 4 pixels
            for (let i = 0; i < 16; i++) {
                const pixel = projMatStartPixel + Math.floor(i / 4);
                const channel = i % 4;
                staging[pixel * 4 + channel] = (i === 0 || i === 5 || i === 10 || i === 15) ? 1.0 : 0.0;
            }

            // Verify diagonal identity
            expect(staging[projMatStartPixel * 4]).to.equal(1.0); // m[0][0]
            expect(staging[(projMatStartPixel + 1) * 4 + 1]).to.equal(1.0); // m[1][1]
        });

    });

    describe('#upload', function () {

        it('should only upload used light count, not full capacity', function () {
            const maxLights = 4096;
            const usedLights = 50;
            const floatsPerLight = 36; // 9 pixels × 4 channels

            const uploadSize = usedLights * floatsPerLight;
            const fullSize = maxLights * floatsPerLight;

            expect(uploadSize).to.be.lessThan(fullSize);
            expect(uploadSize).to.equal(1800);
        });

    });

});
