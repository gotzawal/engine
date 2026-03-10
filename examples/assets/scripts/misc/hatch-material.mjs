import {
    ShaderMaterial,
    Texture,
    SEMANTIC_POSITION,
    SEMANTIC_NORMAL,
    SEMANTIC_TEXCOORD0,
    PIXELFORMAT_SRGBA8,
    ADDRESS_REPEAT,
    FILTER_LINEAR,
    FILTER_NEAREST_MIPMAP_LINEAR
} from 'playcanvas';

const createHatchMaterial = (device, textures) => {

    // create texture array from the provided textures
    const sources = textures.map(texture => texture.getSource());
    const hatchTexture = new Texture(device, {
        name: 'HatchTextureArray',
        format: PIXELFORMAT_SRGBA8,
        width: textures[0].width,
        height: textures[0].height,
        arrayLength: textures.length,
        magFilter: FILTER_LINEAR,
        minFilter: FILTER_NEAREST_MIPMAP_LINEAR,
        mipmaps: true,
        anisotropy: 16,
        addressU: ADDRESS_REPEAT,
        addressV: ADDRESS_REPEAT,
        levels: [sources]
    });

    // create a new material with a custom shader
    const material = new ShaderMaterial({
        uniqueName: 'HatchShader',
        vertexWGSL: /* wgsl */ `

            // include code transform shader functionality provided by the engine. It automatically
            // declares vertex_position attribute, and handles skinning and morphing if necessary.
            // It also adds uniforms: matrix_viewProjection, matrix_model, matrix_normal.
            // Functions added: getModelMatrix, getLocalPosition
            #include "transformCoreVS"

            // include code for normal shader functionality provided by the engine. It automatically
            // declares vertex_normal attribute, and handles skinning and morphing if necessary.
            // Functions added: getNormalMatrix, getLocalNormal
            #include "normalCoreVS"

            // add additional attributes we need
            attribute aUv0: vec2f;

            // engine supplied uniforms
            uniform view_position: vec3f;

            // out custom uniforms
            uniform uLightDir: vec3f;
            uniform uMetalness: f32;

            // variables we pass to the fragment shader
            varying uv0: vec2f;
            varying brightness: f32;

            @vertex
            fn vertexMain(input: VertexInput) -> VertexOutput
            {
                var output: VertexOutput;

                // use functionality from transformCore to get a world position, which includes skinning and morphing as needed
                let modelMatrix: mat4x4f = getModelMatrix();
                let localPos: vec3f = getLocalPosition(vertex_position.xyz);
                let worldPos: vec4f = modelMatrix * vec4f(localPos, 1.0);

                // use functionality from normalCore to get the world normal, which includes skinning and morphing as needed
                let normalMatrix: mat3x3f = getNormalMatrix(modelMatrix);
                let localNormal: vec3f = getLocalNormal(vertex_normal);
                let worldNormal: vec3f = normalize(normalMatrix * localNormal);

                // simple wrap-around diffuse lighting using normal and light direction
                let diffuse: f32 = dot(worldNormal, uniform.uLightDir) * 0.5 + 0.5;

                // a simple specular lighting
                let viewDir: vec3f = normalize(uniform.view_position - worldPos.xyz);
                let reflectDir: vec3f = reflect(-uniform.uLightDir, worldNormal);
                let specular: f32 = pow(max(dot(viewDir, reflectDir), 0.0), 9.0);

                // combine the lighting
                output.brightness = diffuse * (1.0 - uniform.uMetalness) + specular * uniform.uMetalness;

                // Pass the texture coordinates
                output.uv0 = aUv0;

                // Transform the geometry
                output.position = uniform.matrix_viewProjection * worldPos;

                return output;
            }
        `,
        fragmentWGSL: /* wgsl */ `
            // this gives us gamma correction functions, such as gammaCorrectOutput
            #include "gammaPS"

            // this give us tonemapping functionality: toneMap
            #include "tonemappingPS"

            // this gives us for functionality: addFog
            #include "fogPS"

            varying brightness: f32;
            varying uv0: vec2f;

            var uDiffuseMap: texture_2d_array<f32>;
            var uDiffuseMapSampler: sampler;
            uniform uDensity: f32;
            uniform uNumTextures: f32;
            uniform uColor: vec3f;

            @fragment
            fn fragmentMain(input: FragmentInput) -> FragmentOutput
            {
                var output: FragmentOutput;
                var colorLinear: half3;

                #ifdef TOON

                    // just a simple toon shader - no texture sampling
                    let level: half = half(i32(input.brightness * uniform.uNumTextures)) / half(uniform.uNumTextures);
                    colorLinear = level * half3(uniform.uColor);

                #else
                    // brightness dictates the hatch texture level
                    let level: half = (half(1.0) - half(input.brightness)) * half(uniform.uNumTextures);

                    // sample the two nearest levels and interpolate between them
                    let hatchUnder: half3 = half3(textureSample(uDiffuseMap, uDiffuseMapSampler, input.uv0 * uniform.uDensity, i32(floor(level))).xyz);
                    let hatchAbove: half3 = half3(textureSample(uDiffuseMap, uDiffuseMapSampler, input.uv0 * uniform.uDensity, i32(min(ceil(level), half(uniform.uNumTextures - 1.0)))).xyz);
                    colorLinear = mix(hatchUnder, hatchAbove, fract(level)) * half3(uniform.uColor);
                #endif

                // handle standard color processing - the called functions are automatically attached to the
                // shader based on the current fog / tone-mapping / gamma settings
                let fogged: vec3f = addFog(vec3f(colorLinear));
                let toneMapped: vec3f = toneMap(fogged);
                output.color = vec4f(gammaCorrectOutput(toneMapped), 1.0);

                return output;
            }
        `,
        attributes: {
            vertex_position: SEMANTIC_POSITION,
            vertex_normal: SEMANTIC_NORMAL,
            aUv0: SEMANTIC_TEXCOORD0
        }
    });

    // default parameters
    material.setParameter('uDiffuseMap', hatchTexture);
    material.setParameter('uDensity', 1);
    material.setParameter('uColor', [1, 1, 1]);
    material.setParameter('uMetalness', 0.5);
    material.setParameter('uNumTextures', textures.length);
    return material;
};

export { createHatchMaterial };
