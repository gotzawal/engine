/**
 * WGSL struct definition for MaterialData (256 bytes = 16 x vec4f).
 * Exported separately so it can be used as a structPreamble for storage buffer declarations.
 */
export const materialDataStructWGSL = /* wgsl */`
struct MaterialData {
    // vec4 0: baseColor (rgba)
    baseColor: vec4f,
    // vec4 1: emissive (rgb) + opacity
    emissive_opacity: vec4f,
    // vec4 2: specular (rgb) + glossiness
    specular_glossiness: vec4f,
    // vec4 3: metalness, roughness, alphaTest, bumpiness
    params1: vec4f,
    // vec4 4: reflectivity, refraction, refractionIndex, thickness
    params2: vec4f,
    // vec4 5: clearcoat, clearcoatGloss, ao, lightMapIntensity
    params3: vec4f,
    // vec4 6: sheenGloss, iridescence, iridescenceThickness, anisotropy
    params4: vec4f,
    // vec4 7: sheenColor (rgb) + dispersion
    sheen_dispersion: vec4f,
    // vec4 8: attenuationColor (rgb) + attenuationDistance
    attenuation: vec4f,
    // vec4 9: texture array layer indices (x=diffuse, y=normal, z=specular, w=emissive; -1 = not in array)
    texArrayLayers: vec4f,
    // vec4 10-15: reserved / padding
    _reserved1: vec4f,
    _reserved2: vec4f,
    _reserved3: vec4f,
    _reserved4: vec4f,
    _reserved5: vec4f,
    _reserved6: vec4f,
};`;

export default /* wgsl */`

#if defined(GPU_DRIVEN)

// GPU_DRIVEN: materialSlot is passed from DrawInstance via vertex -> fragment flat varying
varying @interpolate(flat) vMaterialSlot: u32;

#if defined(TEXTURE_ARRAY_BATCHING)
// Shared texture array for GPU-driven texture array batching.
// Declared here so the shader processor adds it to the mesh bind group.
var globalDiffuseArray: texture_2d_array<f32>;
var globalDiffuseArray_sampler: sampler;
#endif

fn getMaterialData() -> MaterialData {
    return globalMaterials[i32(vMaterialSlot)];
}

fn getMaterialBaseColor() -> vec4f {
    return globalMaterials[i32(vMaterialSlot)].baseColor;
}

fn getMaterialEmissive() -> vec3f {
    return globalMaterials[i32(vMaterialSlot)].emissive_opacity.xyz;
}

fn getMaterialOpacity() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].emissive_opacity.w;
}

fn getMaterialSpecular() -> vec3f {
    return globalMaterials[i32(vMaterialSlot)].specular_glossiness.xyz;
}

fn getMaterialGlossiness() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].specular_glossiness.w;
}

fn getMaterialMetalness() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].params1.x;
}

fn getMaterialRoughness() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].params1.y;
}

fn getMaterialAlphaTest() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].params1.z;
}

fn getMaterialBumpiness() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].params1.w;
}

fn getMaterialReflectivity() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].params2.x;
}

fn getMaterialRefraction() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].params2.y;
}

fn getMaterialRefractionIndex() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].params2.z;
}

fn getMaterialThickness() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].params2.w;
}

fn getMaterialClearcoat() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].params3.x;
}

fn getMaterialClearcoatGloss() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].params3.y;
}

fn getMaterialAO() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].params3.z;
}

fn getMaterialLightMapIntensity() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].params3.w;
}

fn getMaterialSheenGloss() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].params4.x;
}

fn getMaterialIridescence() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].params4.y;
}

fn getMaterialIridescenceThickness() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].params4.z;
}

fn getMaterialAnisotropy() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].params4.w;
}

fn getMaterialSheenColor() -> vec3f {
    return globalMaterials[i32(vMaterialSlot)].sheen_dispersion.xyz;
}

fn getMaterialDispersion() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].sheen_dispersion.w;
}

fn getMaterialAttenuationColor() -> vec3f {
    return globalMaterials[i32(vMaterialSlot)].attenuation.xyz;
}

fn getMaterialAttenuationDistance() -> f32 {
    return globalMaterials[i32(vMaterialSlot)].attenuation.w;
}

#elif defined(MATERIAL_STORAGE_BUFFER)

uniform materialIndex: f32;

// Access material data from the global storage buffer using materialIndex
fn getMaterialData() -> MaterialData {
    return globalMaterials[i32(uniform.materialIndex)];
}

fn getMaterialBaseColor() -> vec4f {
    return globalMaterials[i32(uniform.materialIndex)].baseColor;
}

fn getMaterialEmissive() -> vec3f {
    return globalMaterials[i32(uniform.materialIndex)].emissive_opacity.xyz;
}

fn getMaterialOpacity() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].emissive_opacity.w;
}

fn getMaterialSpecular() -> vec3f {
    return globalMaterials[i32(uniform.materialIndex)].specular_glossiness.xyz;
}

fn getMaterialGlossiness() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].specular_glossiness.w;
}

fn getMaterialMetalness() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].params1.x;
}

fn getMaterialRoughness() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].params1.y;
}

fn getMaterialAlphaTest() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].params1.z;
}

fn getMaterialBumpiness() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].params1.w;
}

fn getMaterialReflectivity() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].params2.x;
}

fn getMaterialRefraction() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].params2.y;
}

fn getMaterialRefractionIndex() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].params2.z;
}

fn getMaterialThickness() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].params2.w;
}

fn getMaterialClearcoat() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].params3.x;
}

fn getMaterialClearcoatGloss() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].params3.y;
}

fn getMaterialAO() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].params3.z;
}

fn getMaterialLightMapIntensity() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].params3.w;
}

fn getMaterialSheenGloss() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].params4.x;
}

fn getMaterialIridescence() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].params4.y;
}

fn getMaterialIridescenceThickness() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].params4.z;
}

fn getMaterialAnisotropy() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].params4.w;
}

fn getMaterialSheenColor() -> vec3f {
    return globalMaterials[i32(uniform.materialIndex)].sheen_dispersion.xyz;
}

fn getMaterialDispersion() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].sheen_dispersion.w;
}

fn getMaterialAttenuationColor() -> vec3f {
    return globalMaterials[i32(uniform.materialIndex)].attenuation.xyz;
}

fn getMaterialAttenuationDistance() -> f32 {
    return globalMaterials[i32(uniform.materialIndex)].attenuation.w;
}

#endif
`;
