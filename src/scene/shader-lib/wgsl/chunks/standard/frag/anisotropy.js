export default /* wgsl */`
#ifdef LIT_GGX_SPECULAR
    #ifndef MATERIAL_STORAGE_BUFFER
        uniform material_anisotropyIntensity: f32;
    #endif
    uniform material_anisotropyRotation: vec2f;
#endif

fn getAnisotropy() {
    dAnisotropy = 0.0;
    dAnisotropyRotation = vec2f(1.0, 0.0);

#ifdef LIT_GGX_SPECULAR
    #ifdef MATERIAL_STORAGE_BUFFER
        dAnisotropy = getMaterialAnisotropy();
    #else
        dAnisotropy = uniform.material_anisotropyIntensity;
    #endif
    dAnisotropyRotation = uniform.material_anisotropyRotation;
#endif

#ifdef STD_ANISOTROPY_TEXTURE
    let anisotropyTex: vec3f = textureSampleBias({STD_ANISOTROPY_TEXTURE_NAME}, {STD_ANISOTROPY_TEXTURE_NAME}Sampler, {STD_ANISOTROPY_TEXTURE_UV}, uniform.textureBias).rgb;
    dAnisotropy *= anisotropyTex.b;

    let anisotropyRotationFromTex: vec2f = anisotropyTex.rg * 2.0 - vec2f(1.0);
    let rotationMatrix: mat2x2f = mat2x2f(dAnisotropyRotation.x, dAnisotropyRotation.y, -dAnisotropyRotation.y, dAnisotropyRotation.x);
    dAnisotropyRotation = rotationMatrix * anisotropyRotationFromTex;
#endif

    dAnisotropy = clamp(dAnisotropy, 0.0, 1.0);
}
`;
