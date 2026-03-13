export default /* wgsl */`
#include "indirectCoreCS"

struct CullUniforms {
    frustumPlanes: array<vec4f, 6>,
    drawCount: u32,
    indirectStartSlot: u32
};

@group(0) @binding(0) var<uniform> uniforms: CullUniforms;
@group(0) @binding(1) var<storage, read> boundingSpheres: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> indirectDrawBuffer: array<DrawIndexedIndirectArgs>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let idx = gid.x;
    if (idx >= uniforms.drawCount) { return; }

    let entryIdx = uniforms.indirectStartSlot + idx;
    let transformSlot = indirectDrawBuffer[entryIdx].firstInstance;
    let sphere = boundingSpheres[transformSlot];
    let center = sphere.xyz;
    let radius = sphere.w;

    var visible = true;
    for (var p = 0u; p < 6u; p++) {
        let plane = uniforms.frustumPlanes[p];
        let dist = dot(plane.xyz, center) + plane.w;
        if (dist < -radius) {
            visible = false;
            break;
        }
    }

    if (!visible) {
        indirectDrawBuffer[entryIdx].instanceCount = 0u;
    }
}
`;
