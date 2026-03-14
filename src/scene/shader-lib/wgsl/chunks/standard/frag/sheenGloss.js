export default /* wgsl */`
#ifndef MATERIAL_STORAGE_BUFFER
uniform material_sheenGloss: f32;
#endif

fn getSheenGlossiness() {
    #ifdef MATERIAL_STORAGE_BUFFER
    var sheenGlossiness = getMaterialSheenGloss();
    #else
    var sheenGlossiness = uniform.material_sheenGloss;
    #endif

    #ifdef STD_SHEENGLOSS_TEXTURE
    sheenGlossiness = sheenGlossiness * textureSampleBias({STD_SHEENGLOSS_TEXTURE_NAME}, {STD_SHEENGLOSS_TEXTURE_NAME}Sampler, {STD_SHEENGLOSS_TEXTURE_UV}, uniform.textureBias).{STD_SHEENGLOSS_TEXTURE_CHANNEL};
    #endif

    #ifdef STD_SHEENGLOSS_VERTEX
    sheenGlossiness = sheenGlossiness * saturate(vVertexColor.{STD_SHEENGLOSS_VERTEX_CHANNEL});
    #endif

    #ifdef STD_SHEENGLOSS_INVERT
    sheenGlossiness = 1.0 - sheenGlossiness;
    #endif

    sGlossiness = sheenGlossiness + 0.0000001;
}
`;
