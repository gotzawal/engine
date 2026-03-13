export default /* wgsl */`

fn getModelMatrix() -> mat4x4f {
    return globalTransforms[pcInstanceIndex];
}
`;
