/**
 * WGSL struct definition for DrawInstance (32 bytes = 8 x u32).
 * Exported separately so it can be used as a structPreamble for storage buffer declarations.
 */
export const drawInstanceStructWGSL = /* wgsl */`
struct DrawInstance {
    transformSlot: u32,
    materialSlot: u32,
    firstIndex: u32,
    indexCount: u32,
    baseVertex: i32,
    batchId: u32,
    pipelineGroupId: u32,
    _pad1: u32,
};`;

export default /* wgsl */`

// DrawInstance struct is declared via structPreamble in the bind group format
// (see renderer.js viewBindGroupFormat setup)

// private bridge: set in getModelMatrix(), copied to output.vMaterialSlot in litMain
var<private> dMaterialSlotGlobal: u32;

fn getDrawInstance() -> DrawInstance {
    return drawInstances[pcInstanceIndex];
}

fn getModelMatrix() -> mat4x4f {
    let di = drawInstances[pcInstanceIndex];
    dMaterialSlotGlobal = di.materialSlot;
    return globalTransforms[di.transformSlot];
}
`;
