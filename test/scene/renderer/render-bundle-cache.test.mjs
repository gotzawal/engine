import { expect } from 'chai';

import { RenderBundleCache } from '../../../src/scene/renderer/render-bundle-cache.js';

describe('RenderBundleCache', function () {

    describe('#constructor()', function () {

        it('should start with an empty cache', function () {
            const cache = new RenderBundleCache();
            expect(cache._cache.size).to.equal(0);
            expect(cache._version).to.equal(0);
            expect(cache.stats.hits).to.equal(0);
            expect(cache.stats.misses).to.equal(0);
        });

    });

    describe('#set() and #get()', function () {

        it('should store and retrieve a bundle by group key', function () {
            const cache = new RenderBundleCache();
            const fakeBundle = { id: 'bundle1' };
            cache.set('group-a', fakeBundle);

            const result = cache.get('group-a');
            expect(result).to.equal(fakeBundle);
            expect(cache.stats.hits).to.equal(1);
        });

        it('should return null for a key that was never stored', function () {
            const cache = new RenderBundleCache();
            const result = cache.get('nonexistent');
            expect(result).to.be.null;
            expect(cache.stats.misses).to.equal(1);
        });

        it('should return null after global version changes', function () {
            const cache = new RenderBundleCache();
            const fakeBundle = { id: 'bundle1' };
            cache.set('group-a', fakeBundle);

            // simulate a global invalidation by incrementing version
            cache._version++;

            const result = cache.get('group-a');
            expect(result).to.be.null;
            expect(cache.stats.misses).to.equal(1);
        });

    });

    describe('#invalidateGroup()', function () {

        it('should remove a specific group from the cache', function () {
            const cache = new RenderBundleCache();
            cache.set('group-a', { id: 'a' });
            cache.set('group-b', { id: 'b' });

            cache.invalidateGroup('group-a');

            expect(cache.get('group-a')).to.be.null;
            expect(cache.get('group-b')).to.not.be.null;
        });

        it('should not throw for a nonexistent key', function () {
            const cache = new RenderBundleCache();
            expect(() => cache.invalidateGroup('nope')).to.not.throw();
        });

    });

    describe('#invalidateAll()', function () {

        it('should clear all cached bundles and increment version', function () {
            const cache = new RenderBundleCache();
            cache.set('group-a', { id: 'a' });
            cache.set('group-b', { id: 'b' });
            const prevVersion = cache._version;

            cache.invalidateAll();

            expect(cache._cache.size).to.equal(0);
            expect(cache._version).to.equal(prevVersion + 1);
            expect(cache.get('group-a')).to.be.null;
            expect(cache.get('group-b')).to.be.null;
        });

    });

    describe('#destroy()', function () {

        it('should clear all internal maps', function () {
            const cache = new RenderBundleCache();
            cache.set('group-a', { id: 'a' });
            cache.destroy();

            expect(cache._cache.size).to.equal(0);
            expect(cache._versions.size).to.equal(0);
        });

    });

    describe('stats tracking', function () {

        it('should correctly count hits and misses', function () {
            const cache = new RenderBundleCache();
            cache.set('key1', { id: 1 });

            cache.get('key1');      // hit
            cache.get('key1');      // hit
            cache.get('missing');   // miss
            cache.get('missing2');  // miss

            expect(cache.stats.hits).to.equal(2);
            expect(cache.stats.misses).to.equal(2);
        });

    });

});
