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
    // vec4 9-15: reserved / padding
    _reserved0: vec4f,
    _reserved1: vec4f,
    _reserved2: vec4f,
    _reserved3: vec4f,
    _reserved4: vec4f,
    _reserved5: vec4f,
    _reserved6: vec4f,
};`;

export default /* wgsl */`

#ifdef MATERIAL_STORAGE_BUFFER

#ifdef GPU_DRIVEN

// GPU-driven path: material slot comes from the DrawInstance buffer via a flat varying
// set by the vertex shader (no per-draw uniform needed).
varying @interpolate(flat) vGpuDrivenMaterialSlot: u32;

fn getMaterialSlot() -> i32 {
    return i32(vGpuDrivenMaterialSlot);
}

#else

// Standard path: material slot comes from a per-draw uniform
uniform materialIndex: f32;

fn getMaterialSlot() -> i32 {
    return i32(uniform.materialIndex);
}

#endif

// Access material data from the global storage buffer
fn getMaterialData() -> MaterialData {
    return globalMaterials[getMaterialSlot()];
}

fn getMaterialBaseColor() -> vec4f {
    return globalMaterials[getMaterialSlot()].baseColor;
}

fn getMaterialEmissive() -> vec3f {
    return globalMaterials[getMaterialSlot()].emissive_opacity.xyz;
}

fn getMaterialOpacity() -> f32 {
    return globalMaterials[getMaterialSlot()].emissive_opacity.w;
}

fn getMaterialSpecular() -> vec3f {
    return globalMaterials[getMaterialSlot()].specular_glossiness.xyz;
}

fn getMaterialGlossiness() -> f32 {
    return globalMaterials[getMaterialSlot()].specular_glossiness.w;
}

fn getMaterialMetalness() -> f32 {
    return globalMaterials[getMaterialSlot()].params1.x;
}

fn getMaterialRoughness() -> f32 {
    return globalMaterials[getMaterialSlot()].params1.y;
}

fn getMaterialAlphaTest() -> f32 {
    return globalMaterials[getMaterialSlot()].params1.z;
}

fn getMaterialBumpiness() -> f32 {
    return globalMaterials[getMaterialSlot()].params1.w;
}

fn getMaterialReflectivity() -> f32 {
    return globalMaterials[getMaterialSlot()].params2.x;
}

fn getMaterialRefraction() -> f32 {
    return globalMaterials[getMaterialSlot()].params2.y;
}

fn getMaterialRefractionIndex() -> f32 {
    return globalMaterials[getMaterialSlot()].params2.z;
}

fn getMaterialThickness() -> f32 {
    return globalMaterials[getMaterialSlot()].params2.w;
}

fn getMaterialClearcoat() -> f32 {
    return globalMaterials[getMaterialSlot()].params3.x;
}

fn getMaterialClearcoatGloss() -> f32 {
    return globalMaterials[getMaterialSlot()].params3.y;
}

fn getMaterialAO() -> f32 {
    return globalMaterials[getMaterialSlot()].params3.z;
}

fn getMaterialLightMapIntensity() -> f32 {
    return globalMaterials[getMaterialSlot()].params3.w;
}

fn getMaterialSheenGloss() -> f32 {
    return globalMaterials[getMaterialSlot()].params4.x;
}

fn getMaterialIridescence() -> f32 {
    return globalMaterials[getMaterialSlot()].params4.y;
}

fn getMaterialIridescenceThickness() -> f32 {
    return globalMaterials[getMaterialSlot()].params4.z;
}

fn getMaterialAnisotropy() -> f32 {
    return globalMaterials[getMaterialSlot()].params4.w;
}

fn getMaterialSheenColor() -> vec3f {
    return globalMaterials[getMaterialSlot()].sheen_dispersion.xyz;
}

fn getMaterialDispersion() -> f32 {
    return globalMaterials[getMaterialSlot()].sheen_dispersion.w;
}

fn getMaterialAttenuationColor() -> vec3f {
    return globalMaterials[getMaterialSlot()].attenuation.xyz;
}

fn getMaterialAttenuationDistance() -> f32 {
    return globalMaterials[getMaterialSlot()].attenuation.w;
}

#endif
`;
