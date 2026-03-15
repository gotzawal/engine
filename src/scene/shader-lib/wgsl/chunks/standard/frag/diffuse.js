export default /* wgsl */`
#ifndef MATERIAL_STORAGE_BUFFER
uniform material_diffuse: vec3f;
#endif

#ifdef STD_DIFFUSEDETAIL_TEXTURE
    #include "detailModesPS"
#endif

#if defined(GPU_DRIVEN) && defined(TEXTURE_ARRAY_BATCHING) && defined(STD_DIFFUSE_TEXTURE)
    var globalDiffuseArray: texture_2d_array<f32>;
    var globalDiffuseArraySampler: sampler;
#endif

fn getAlbedo() {
    #ifdef MATERIAL_STORAGE_BUFFER
        dAlbedo = getMaterialBaseColor().rgb;
    #else
        dAlbedo = uniform.material_diffuse.rgb;
    #endif

    #ifdef STD_DIFFUSE_TEXTURE
        #if defined(GPU_DRIVEN) && defined(TEXTURE_ARRAY_BATCHING)
            // Texture array path: sample from shared globalDiffuseArray using per-material layer index
            let diffLayerIdx = max(i32(getMaterialTexArrayLayers().x), 0);
            var albedoTexture: vec3f = {STD_DIFFUSE_TEXTURE_DECODE}(textureSampleBias(globalDiffuseArray, globalDiffuseArraySampler, {STD_DIFFUSE_TEXTURE_UV}, diffLayerIdx, uniform.textureBias)).{STD_DIFFUSE_TEXTURE_CHANNEL};
        #else
            var albedoTexture: vec3f = {STD_DIFFUSE_TEXTURE_DECODE}(textureSampleBias({STD_DIFFUSE_TEXTURE_NAME}, {STD_DIFFUSE_TEXTURE_NAME}Sampler, {STD_DIFFUSE_TEXTURE_UV}, uniform.textureBias)).{STD_DIFFUSE_TEXTURE_CHANNEL};
        #endif

        #ifdef STD_DIFFUSEDETAIL_TEXTURE
            var albedoDetail: vec3f = {STD_DIFFUSEDETAIL_TEXTURE_DECODE}(textureSampleBias({STD_DIFFUSEDETAIL_TEXTURE_NAME}, {STD_DIFFUSEDETAIL_TEXTURE_NAME}Sampler, {STD_DIFFUSEDETAIL_TEXTURE_UV}, uniform.textureBias)).{STD_DIFFUSEDETAIL_TEXTURE_CHANNEL};
            albedoTexture = detailMode_{STD_DIFFUSEDETAIL_DETAILMODE}(albedoTexture, albedoDetail);
        #endif

        dAlbedo = dAlbedo * albedoTexture;
    #endif

    #ifdef STD_DIFFUSE_VERTEX
        dAlbedo = dAlbedo * saturate3(vVertexColor.{STD_DIFFUSE_VERTEX_CHANNEL});
    #endif
}
`;
