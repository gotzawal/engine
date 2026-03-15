export default /* wgsl */`
#ifndef MATERIAL_STORAGE_BUFFER
uniform material_diffuse: vec3f;
#endif

#ifdef STD_DIFFUSEDETAIL_TEXTURE
    #include "detailModesPS"
#endif

fn getAlbedo() {
    #ifdef MATERIAL_STORAGE_BUFFER
        dAlbedo = getMaterialBaseColor().rgb;
    #else
        dAlbedo = uniform.material_diffuse.rgb;
    #endif

    #if defined(GPU_DRIVEN) && defined(TEXTURE_ARRAY_BATCHING) && defined(STD_DIFFUSE_TEXTURE)
        // Texture array path: layer index from material storage buffer
        {
            let matData = getMaterialData();
            let diffuseLayerIdx = i32(matData.texArrayLayers.x);
            if (diffuseLayerIdx >= 0) {
                var albedoTexture: vec3f = textureSampleBias(
                    globalDiffuseArray,
                    globalDiffuseArray_sampler,
                    {STD_DIFFUSE_TEXTURE_UV},
                    diffuseLayerIdx,
                    uniform.textureBias
                ).{STD_DIFFUSE_TEXTURE_CHANNEL};
                dAlbedo = dAlbedo * albedoTexture;
            }
            // diffuseLayerIdx < 0: no texture, use flat color from baseColor (already set)
        }
    #elif defined(STD_DIFFUSE_TEXTURE)
        var albedoTexture: vec3f = {STD_DIFFUSE_TEXTURE_DECODE}(textureSampleBias({STD_DIFFUSE_TEXTURE_NAME}, {STD_DIFFUSE_TEXTURE_NAME}Sampler, {STD_DIFFUSE_TEXTURE_UV}, uniform.textureBias)).{STD_DIFFUSE_TEXTURE_CHANNEL};

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
