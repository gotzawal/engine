export default /* wgsl */`
#include "indirectCoreCS"

struct CullUniforms {
    frustumPlanes: array<vec4f, 6>,
    objectCount: u32,
    indirectOffset: u32
};

@group(0) @binding(0) var<uniform> uniforms: CullUniforms;
@group(0) @binding(1) var<storage, read> aabbData: array<vec4f>;
@group(0) @binding(2) var<storage, read> meshMeta: array<vec4u>;
@group(0) @binding(3) var<storage, read_write> indirectDrawBuffer: array<DrawIndexedIndirectArgs>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let idx = gid.x;
    if (idx >= uniforms.objectCount) { return; }

    let sphere = aabbData[idx];
    let center = sphere.xyz;
    let radius = sphere.w;

    // Frustum culling: test bounding sphere against 6 planes
    var visible = true;
    for (var p = 0u; p < 6u; p = p + 1u) {
        let plane = uniforms.frustumPlanes[p];
        if (dot(plane.xyz, center) + plane.w < -radius) {
            visible = false;
            break;
        }
    }

    let meta = meshMeta[idx];
    let slot = uniforms.indirectOffset + idx;
    indirectDrawBuffer[slot].indexCount = meta.x;
    indirectDrawBuffer[slot].instanceCount = select(0u, 1u, visible);
    indirectDrawBuffer[slot].firstIndex = meta.y;
    indirectDrawBuffer[slot].baseVertex = i32(meta.z);
    indirectDrawBuffer[slot].firstInstance = meta.w;
}
`;
