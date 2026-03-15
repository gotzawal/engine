export default /* wgsl */`

struct DrawInstance {
    transformSlot: u32,
    materialSlot: u32,
    firstIndex: u32,
    indexCount: u32,
    baseVertex: i32,
    batchId: u32,
    _pad0: u32,
    _pad1: u32,
};

// flat varying: vertex -> fragment로 materialSlot 전달
varying @interpolate(flat) vMaterialSlot: u32;

fn getDrawInstance() -> DrawInstance {
    return drawInstances[pcInstanceIndex];
}

fn getModelMatrix() -> mat4x4f {
    let di = drawInstances[pcInstanceIndex];
    vMaterialSlot = di.materialSlot;
    return globalTransforms[di.transformSlot];
}
`;
