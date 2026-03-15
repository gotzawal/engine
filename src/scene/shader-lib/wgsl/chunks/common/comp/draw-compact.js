export default /* wgsl */`
#include "indirectCoreCS"

struct DrawInstance {
    transformSlot: u32,
    materialSlot: u32,
    firstIndex: u32,
    indexCount: u32,
    baseVertex: i32,
    batchId: u32,
    pipelineGroupId: u32,
    _pad1: u32,
};

struct CompactUniforms {
    frustumPlanes: array<vec4f, 6>,
    totalDrawCount: u32,
    groupCount: u32,
};

@group(0) @binding(0) var<uniform> uniforms: CompactUniforms;
@group(0) @binding(1) var<storage, read> drawInstances: array<DrawInstance>;
@group(0) @binding(2) var<storage, read> boundingSpheres: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> compactedDrawArgs: array<DrawIndexedIndirectArgs>;
@group(0) @binding(4) var<storage, read_write> groupCounts: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read> groupBaseOffsets: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let drawId = gid.x;
    if (drawId >= uniforms.totalDrawCount) { return; }

    let di = drawInstances[drawId];
    let sphere = boundingSpheres[di.transformSlot];
    let center = sphere.xyz;
    let radius = sphere.w;

    // frustum culling: test against 6 planes
    var visible = true;
    for (var p = 0u; p < 6u; p++) {
        let plane = uniforms.frustumPlanes[p];
        let dist = dot(plane.xyz, center) + plane.w;
        if (dist < -radius) {
            visible = false;
            break;
        }
    }

    if (visible) {
        let groupId = di.pipelineGroupId;
        let localIdx = atomicAdd(&groupCounts[groupId], 1u);
        let outIdx = groupBaseOffsets[groupId] + localIdx;
        compactedDrawArgs[outIdx] = DrawIndexedIndirectArgs(
            di.indexCount,
            1u,
            di.firstIndex,
            di.baseVertex,
            drawId
        );
    }
}
`;
