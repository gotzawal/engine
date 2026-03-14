import { VertexBuffer } from '../../platform/graphics/vertex-buffer.js';
import { IndexBuffer } from '../../platform/graphics/index-buffer.js';
import { BUFFER_STATIC, INDEXFORMAT_UINT32 } from '../../platform/graphics/constants.js';

/**
 * @import { GraphicsDevice } from '../../platform/graphics/graphics-device.js'
 * @import { Mesh } from '../mesh.js'
 * @import { VertexFormat } from '../../platform/graphics/vertex-format.js'
 */

/**
 * Entry describing where a mesh's geometry lives in a shared GeometryBatch.
 *
 * @ignore
 */
class MeshEntry {
    /** @type {number} */
    baseVertex;

    /** @type {number} */
    firstIndex;

    /** @type {number} */
    indexCount;

    /** @type {number} */
    vertexCount;

    /** @type {number} */
    batchId;

    /**
     * @param {number} baseVertex - Vertex offset in shared buffer.
     * @param {number} firstIndex - Index offset in shared buffer.
     * @param {number} indexCount - Number of indices.
     * @param {number} vertexCount - Number of vertices.
     * @param {number} batchId - Id of the GeometryBatch this entry belongs to.
     */
    constructor(baseVertex, firstIndex, indexCount, vertexCount, batchId) {
        this.baseVertex = baseVertex;
        this.firstIndex = firstIndex;
        this.indexCount = indexCount;
        this.vertexCount = vertexCount;
        this.batchId = batchId;
    }
}

/**
 * A batch of merged geometry sharing the same VertexFormat. Contains a single large
 * vertex buffer and index buffer that multiple meshes write into.
 *
 * @ignore
 */
class GeometryBatch {
    /** @type {number} */
    id;

    /** @type {GraphicsDevice} */
    device;

    /** @type {VertexFormat} */
    vertexFormat;

    /** @type {VertexBuffer|null} */
    vertexBuffer = null;

    /** @type {IndexBuffer|null} */
    indexBuffer = null;

    /** @type {number} */
    vertexCapacity;

    /** @type {number} */
    indexCapacity;

    /** @type {number} */
    nextVertex = 0;

    /** @type {number} */
    nextIndex = 0;

    /** @type {Map<number, MeshEntry>} */
    meshEntries = new Map();

    /**
     * @param {number} id - Batch identifier.
     * @param {GraphicsDevice} device - The graphics device.
     * @param {VertexFormat} vertexFormat - The vertex format for this batch.
     * @param {number} [initialVertexCapacity] - Initial vertex capacity.
     * @param {number} [initialIndexCapacity] - Initial index capacity.
     */
    constructor(id, device, vertexFormat, initialVertexCapacity = 16384, initialIndexCapacity = 65536) {
        this.id = id;
        this.device = device;
        this.vertexFormat = vertexFormat;
        this.vertexCapacity = initialVertexCapacity;
        this.indexCapacity = initialIndexCapacity;
        this._createBuffers();
    }

    _createBuffers() {
        this.vertexBuffer?.destroy();
        this.indexBuffer?.destroy();

        this.vertexBuffer = new VertexBuffer(this.device, this.vertexFormat, this.vertexCapacity, {
            usage: BUFFER_STATIC,
            storage: true
        });

        this.indexBuffer = new IndexBuffer(this.device, INDEXFORMAT_UINT32, this.indexCapacity, BUFFER_STATIC, undefined, {
            storage: true
        });
    }

    /**
     * Add a mesh's geometry to this batch. Copies vertex and index data into the shared buffers.
     *
     * @param {Mesh} mesh - The mesh to add.
     * @returns {MeshEntry|null} The entry, or null if the mesh has no index buffer.
     */
    addMesh(mesh) {
        if (this.meshEntries.has(mesh.id)) {
            return this.meshEntries.get(mesh.id);
        }

        const srcVB = mesh.vertexBuffer;
        const srcIB = mesh.indexBuffer[0]; // RENDERSTYLE_SOLID
        if (!srcVB || !srcIB) return null;

        const vertexCount = srcVB.getNumVertices();
        const indexCount = srcIB.getNumIndices();

        // grow if needed
        if (this.nextVertex + vertexCount > this.vertexCapacity ||
            this.nextIndex + indexCount > this.indexCapacity) {
            this._grow(vertexCount, indexCount);
        }

        const baseVertex = this.nextVertex;
        const firstIndex = this.nextIndex;

        // copy vertex data
        const srcVBData = srcVB.lock();
        const dstVBData = this.vertexBuffer.lock();
        const bytesPerVertex = this.vertexFormat.size;
        const srcView = new Uint8Array(srcVBData);
        const dstView = new Uint8Array(dstVBData);
        dstView.set(srcView.subarray(0, vertexCount * bytesPerVertex), baseVertex * bytesPerVertex);
        this.vertexBuffer.unlock();

        // copy index data (rebase indices by adding baseVertex is NOT needed here -
        // we use drawIndexedIndirect's baseVertex field instead)
        const srcIBData = srcIB.lock();
        const dstIBData = this.indexBuffer.lock();
        const srcIndices = srcIB.bytesPerIndex === 2 ?
            new Uint16Array(srcIBData) :
            new Uint32Array(srcIBData);
        const dstIndices = new Uint32Array(dstIBData);
        for (let i = 0; i < indexCount; i++) {
            dstIndices[firstIndex + i] = srcIndices[i];
        }
        this.indexBuffer.unlock();

        this.nextVertex += vertexCount;
        this.nextIndex += indexCount;

        const entry = new MeshEntry(baseVertex, firstIndex, indexCount, vertexCount, this.id);
        this.meshEntries.set(mesh.id, entry);
        return entry;
    }

    /**
     * Grow buffers to accommodate additional geometry.
     *
     * @param {number} addVertices - Additional vertices needed.
     * @param {number} addIndices - Additional indices needed.
     * @private
     */
    _grow(addVertices, addIndices) {
        while (this.nextVertex + addVertices > this.vertexCapacity) {
            this.vertexCapacity *= 2;
        }
        while (this.nextIndex + addIndices > this.indexCapacity) {
            this.indexCapacity *= 2;
        }

        // save old data
        const oldVBData = new Uint8Array(this.vertexBuffer.lock()).slice(0, this.nextVertex * this.vertexFormat.size);
        const oldIBData = new Uint32Array(this.indexBuffer.lock()).slice(0, this.nextIndex);

        // recreate with larger capacity
        this._createBuffers();

        // restore old data
        const newVBData = new Uint8Array(this.vertexBuffer.lock());
        newVBData.set(oldVBData);
        this.vertexBuffer.unlock();

        const newIBData = new Uint32Array(this.indexBuffer.lock());
        newIBData.set(oldIBData);
        this.indexBuffer.unlock();
    }

    destroy() {
        this.vertexBuffer?.destroy();
        this.indexBuffer?.destroy();
        this.vertexBuffer = null;
        this.indexBuffer = null;
        this.meshEntries.clear();
    }
}

let nextBatchId = 0;

/**
 * Manages merged vertex/index buffers (mega mesh buffers) for GPU-driven rendering.
 * Compatible meshes (same VertexFormat) are grouped into shared GeometryBatch instances,
 * eliminating per-draw setVertexBuffer/setIndexBuffer calls.
 *
 * @ignore
 */
class GeometryPool {
    /** @type {GraphicsDevice} */
    device;

    /**
     * Map from VertexFormat.batchingHash to GeometryBatch.
     *
     * @type {Map<number, GeometryBatch>}
     */
    batches = new Map();

    /**
     * Map from batchId to GeometryBatch for fast lookup.
     *
     * @type {Map<number, GeometryBatch>}
     */
    batchesById = new Map();

    /**
     * @param {GraphicsDevice} device - The graphics device.
     */
    constructor(device) {
        this.device = device;
    }

    /**
     * Add a mesh to the pool. If a compatible batch already exists, the mesh is appended.
     * Otherwise a new batch is created.
     *
     * @param {Mesh} mesh - The mesh to add.
     * @returns {MeshEntry|null} The entry describing where the mesh lives in the shared buffer,
     * or null if the mesh could not be added (e.g. no index buffer).
     */
    addMesh(mesh) {
        const vb = mesh.vertexBuffer;
        if (!vb) return null;

        const format = vb.getFormat();
        const hash = format.batchingHash;

        let batch = this.batches.get(hash);
        if (!batch) {
            const batchId = nextBatchId++;
            batch = new GeometryBatch(batchId, this.device, format);
            this.batches.set(hash, batch);
            this.batchesById.set(batchId, batch);
        }

        return batch.addMesh(mesh);
    }

    /**
     * Get a batch by its id.
     *
     * @param {number} batchId - The batch id.
     * @returns {GeometryBatch|undefined} The batch.
     */
    getBatch(batchId) {
        return this.batchesById.get(batchId);
    }

    destroy() {
        for (const batch of this.batches.values()) {
            batch.destroy();
        }
        this.batches.clear();
        this.batchesById.clear();
    }
}

export { GeometryPool, GeometryBatch, MeshEntry };
