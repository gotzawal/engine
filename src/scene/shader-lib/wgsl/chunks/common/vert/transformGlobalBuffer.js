export default /* wgsl */`

var<storage, read> globalTransforms: array<mat4x4<f32>>;

fn getModelMatrix() -> mat4x4f {
    return globalTransforms[pcInstanceIndex];
}
`;
