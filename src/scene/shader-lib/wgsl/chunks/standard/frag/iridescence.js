export default /* wgsl */`
#ifdef STD_IRIDESCENCE_CONSTANT
    #ifndef MATERIAL_STORAGE_BUFFER
    uniform material_iridescence: f32;
    #endif
#endif

fn getIridescence() {
    var iridescence = 1.0;

    #ifdef STD_IRIDESCENCE_CONSTANT
        #ifdef MATERIAL_STORAGE_BUFFER
        iridescence = iridescence * getMaterialIridescence();
        #else
        iridescence = iridescence * uniform.material_iridescence;
        #endif
    #endif

    #ifdef STD_IRIDESCENCE_TEXTURE
    iridescence = iridescence * textureSampleBias({STD_IRIDESCENCE_TEXTURE_NAME}, {STD_IRIDESCENCE_TEXTURE_NAME}Sampler, {STD_IRIDESCENCE_TEXTURE_UV}, uniform.textureBias).{STD_IRIDESCENCE_TEXTURE_CHANNEL};
    #endif

    dIridescence = iridescence; 
}
`;
