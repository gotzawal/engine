import { expect } from 'chai';

import { DrawCallGrouper, DrawGroup } from '../../../src/scene/renderer/draw-call-group.js';

describe('DrawGroup', function () {

    describe('#constructor()', function () {

        it('should initialize with the given key', function () {
            const group = new DrawGroup('mesh1:shader2:blend3:depth4:0');
            expect(group.key).to.equal('mesh1:shader2:blend3:depth4:0');
            expect(group.indices).to.be.an('array').that.is.empty;
            expect(group.needsRebundle).to.equal(true);
        });

    });

});

describe('DrawCallGrouper', function () {

    // Helper to create a mock draw call
    function mockDrawCall(meshId, materialBundleVersion = 0, shaderDefs = 0) {
        return {
            mesh: { id: meshId },
            material: {
                blendState: { key: 'blend-default' },
                depthState: { key: 'depth-default' },
                stencilFront: null,
                _bundleVersion: materialBundleVersion
            },
            stencilFront: null,
            _shaderDefs: shaderDefs
        };
    }

    function mockShaderInstance(shaderId) {
        return {
            shader: { id: shaderId }
        };
    }

    describe('.generateKey()', function () {

        it('should produce a consistent key for the same mesh+shader+state', function () {
            const dc = mockDrawCall(42);
            const si = mockShaderInstance(7);

            const key1 = DrawCallGrouper.generateKey(dc, si);
            const key2 = DrawCallGrouper.generateKey(dc, si);
            expect(key1).to.equal(key2);
        });

        it('should produce different keys for different mesh ids', function () {
            const dc1 = mockDrawCall(1);
            const dc2 = mockDrawCall(2);
            const si = mockShaderInstance(7);

            expect(DrawCallGrouper.generateKey(dc1, si))
                .to.not.equal(DrawCallGrouper.generateKey(dc2, si));
        });

        it('should produce different keys for different shader ids', function () {
            const dc = mockDrawCall(1);
            const si1 = mockShaderInstance(10);
            const si2 = mockShaderInstance(20);

            expect(DrawCallGrouper.generateKey(dc, si1))
                .to.not.equal(DrawCallGrouper.generateKey(dc, si2));
        });

        it('should include blend state in the key', function () {
            const dc1 = mockDrawCall(1);
            const dc2 = mockDrawCall(1);
            dc2.material.blendState = { key: 'blend-additive' };
            const si = mockShaderInstance(7);

            expect(DrawCallGrouper.generateKey(dc1, si))
                .to.not.equal(DrawCallGrouper.generateKey(dc2, si));
        });

    });

    describe('.isBundleable()', function () {

        it('should return true for a static draw call', function () {
            const dc = mockDrawCall(1);
            expect(DrawCallGrouper.isBundleable(dc)).to.equal(true);
        });

        it('should return false for a skinned draw call', function () {
            // SHADERDEF_SKIN = 2 (from constants.js)
            const dc = mockDrawCall(1, 0, 2);
            expect(DrawCallGrouper.isBundleable(dc)).to.equal(false);
        });

    });

    describe('#groupDrawCalls()', function () {

        it('should group draw calls with the same key together', function () {
            const grouper = new DrawCallGrouper();
            const dc1 = mockDrawCall(1);
            const dc2 = mockDrawCall(1);
            const dc3 = mockDrawCall(2);
            const si = mockShaderInstance(7);

            const prepared = {
                drawCalls: [dc1, dc2, dc3],
                shaderInstances: [si, si, si]
            };

            const groups = grouper.groupDrawCalls(prepared);

            // dc1 and dc2 share the same mesh+shader → one group
            // dc3 has a different mesh → separate group
            expect(groups.size).to.equal(2);

            // find the group that has 2 items
            let found2 = false;
            let found1 = false;
            for (const group of groups.values()) {
                if (group.indices.length === 2) found2 = true;
                if (group.indices.length === 1) found1 = true;
            }
            expect(found2).to.equal(true);
            expect(found1).to.equal(true);
        });

        it('should exclude non-bundleable draw calls', function () {
            const grouper = new DrawCallGrouper();
            // SHADERDEF_SKIN = 2
            const dcSkinned = mockDrawCall(1, 0, 2);
            const dcStatic = mockDrawCall(1);
            const si = mockShaderInstance(7);

            const prepared = {
                drawCalls: [dcSkinned, dcStatic],
                shaderInstances: [si, si]
            };

            const groups = grouper.groupDrawCalls(prepared);

            // only the static draw call should be grouped
            let totalIndices = 0;
            for (const group of groups.values()) {
                totalIndices += group.indices.length;
            }
            expect(totalIndices).to.equal(1);
        });

        it('should detect group count changes between frames', function () {
            const grouper = new DrawCallGrouper();
            const dc1 = mockDrawCall(1);
            const si = mockShaderInstance(7);

            // frame 1: one draw call
            grouper.groupDrawCalls({
                drawCalls: [dc1],
                shaderInstances: [si]
            });

            // Mark as not needing rebundle (simulating successful recording)
            for (const group of grouper.groups.values()) {
                group.needsRebundle = false;
            }

            // frame 2: two draw calls with same key
            const dc2 = mockDrawCall(1);
            grouper.groupDrawCalls({
                drawCalls: [dc1, dc2],
                shaderInstances: [si, si]
            });

            // group count changed 1→2, should need rebundle
            for (const group of grouper.groups.values()) {
                expect(group.needsRebundle).to.equal(true);
            }
        });

        it('should detect material version changes', function () {
            const grouper = new DrawCallGrouper();
            const dc = mockDrawCall(1, 0);
            const si = mockShaderInstance(7);

            // frame 1
            grouper.groupDrawCalls({
                drawCalls: [dc],
                shaderInstances: [si]
            });

            // Mark as not needing rebundle
            for (const group of grouper.groups.values()) {
                group.needsRebundle = false;
            }

            // simulate material change
            dc.material._bundleVersion = 1;

            // frame 2: same draw call but material version changed
            grouper.groupDrawCalls({
                drawCalls: [dc],
                shaderInstances: [si]
            });

            for (const group of grouper.groups.values()) {
                expect(group.needsRebundle).to.equal(true);
            }
        });

        it('should remove empty groups', function () {
            const grouper = new DrawCallGrouper();
            const dc = mockDrawCall(1);
            const si = mockShaderInstance(7);

            // frame 1: one draw call
            grouper.groupDrawCalls({
                drawCalls: [dc],
                shaderInstances: [si]
            });
            expect(grouper.groups.size).to.equal(1);

            // frame 2: empty draw calls
            grouper.groupDrawCalls({
                drawCalls: [],
                shaderInstances: []
            });
            expect(grouper.groups.size).to.equal(0);
        });

    });

    describe('#invalidateGroup()', function () {

        it('should mark a specific group as needing rebundle', function () {
            const grouper = new DrawCallGrouper();
            const dc = mockDrawCall(1);
            const si = mockShaderInstance(7);

            grouper.groupDrawCalls({
                drawCalls: [dc],
                shaderInstances: [si]
            });

            // mark all as not needing rebundle
            for (const group of grouper.groups.values()) {
                group.needsRebundle = false;
            }

            // invalidate
            const key = DrawCallGrouper.generateKey(dc, si);
            grouper.invalidateGroup(key);

            const group = grouper.groups.get(key);
            expect(group.needsRebundle).to.equal(true);
        });

    });

    describe('#invalidateAll()', function () {

        it('should mark all groups as needing rebundle', function () {
            const grouper = new DrawCallGrouper();
            const dc1 = mockDrawCall(1);
            const dc2 = mockDrawCall(2);
            const si = mockShaderInstance(7);

            grouper.groupDrawCalls({
                drawCalls: [dc1, dc2],
                shaderInstances: [si, si]
            });

            // mark all as not needing rebundle
            for (const group of grouper.groups.values()) {
                group.needsRebundle = false;
            }

            grouper.invalidateAll();

            for (const group of grouper.groups.values()) {
                expect(group.needsRebundle).to.equal(true);
            }
        });

    });

    describe('#destroy()', function () {

        it('should clear all groups', function () {
            const grouper = new DrawCallGrouper();
            const dc = mockDrawCall(1);
            const si = mockShaderInstance(7);

            grouper.groupDrawCalls({
                drawCalls: [dc],
                shaderInstances: [si]
            });

            grouper.destroy();
            expect(grouper.groups.size).to.equal(0);
        });

    });

});
