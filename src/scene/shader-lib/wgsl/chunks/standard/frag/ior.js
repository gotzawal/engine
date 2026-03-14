export default /* wgsl */`
#ifdef STD_IOR_CONSTANT
    #ifndef MATERIAL_STORAGE_BUFFER
    uniform material_refractionIndex: f32;
    #endif
#endif

fn getIor() {
#ifdef STD_IOR_CONSTANT
    #ifdef MATERIAL_STORAGE_BUFFER
    dIor = getMaterialRefractionIndex();
    #else
    dIor = uniform.material_refractionIndex;
    #endif
#else
    dIor = 1.0 / 1.5;
#endif
}
`;
