export default /* wgsl */`
#ifndef MATERIAL_STORAGE_BUFFER
uniform material_clearCoat: f32;
#endif

fn getClearCoat() {
    #ifdef MATERIAL_STORAGE_BUFFER
    ccSpecularity = getMaterialClearcoat();
    #else
    ccSpecularity = uniform.material_clearCoat;
    #endif

    #ifdef STD_CLEARCOAT_TEXTURE
    ccSpecularity = ccSpecularity * textureSampleBias({STD_CLEARCOAT_TEXTURE_NAME}, {STD_CLEARCOAT_TEXTURE_NAME}Sampler, {STD_CLEARCOAT_TEXTURE_UV}, uniform.textureBias).{STD_CLEARCOAT_TEXTURE_CHANNEL};
    #endif

    #ifdef STD_CLEARCOAT_VERTEX
    ccSpecularity = ccSpecularity * saturate(vVertexColor.{STD_CLEARCOAT_VERTEX_CHANNEL});
    #endif
}
`;
