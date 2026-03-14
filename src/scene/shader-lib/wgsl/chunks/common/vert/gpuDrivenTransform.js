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
    _pad0: u32,
    _pad1: u32,
};`;

export default /* wgsl */`

varying @interpolate(flat) vGpuDrivenMaterialSlot: u32;

fn getDrawInstance() -> DrawInstance {
    return drawInstances[pcInstanceIndex];
}

fn getModelMatrix() -> mat4x4f {
    let di = drawInstances[pcInstanceIndex];
    return globalTransforms[di.transformSlot];
}

fn getGpuDrivenMaterialSlot() -> u32 {
    return drawInstances[pcInstanceIndex].materialSlot;
}
`;
