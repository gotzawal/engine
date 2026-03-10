import {
    Vec3,
    ShaderMaterial,
    SEMANTIC_POSITION,
    SEMANTIC_NORMAL,
    SEMANTIC_ATTR12,
    SEMANTIC_ATTR13,
    SEMANTIC_TEXCOORD0
} from 'playcanvas';

const createGoochMaterial = (texture, color) => {

    // create a new material with a custom shader
    const material = new ShaderMaterial({
        uniqueName: 'GoochShader',

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

            // out custom uniforms
            uniform uLightDir: vec3f;

            // variables we pass to the fragment shader
            varying uv0: vec2f;
            varying brightness: f32;

            // use instancing if required
            #if INSTANCING

                // add instancing attributes we need for our case - here we have position and scale
                attribute aInstPosition: vec3f;
                attribute aInstScale: f32;

                // instancing needs to provide a model matrix, the rest is handled by the engine when using transformCore
                fn getModelMatrix() -> mat4x4f {
                    return mat4x4f(
                        vec4f(aInstScale, 0.0, 0.0, 0.0),
                        vec4f(0.0, aInstScale, 0.0, 0.0),
                        vec4f(0.0, 0.0, aInstScale, 0.0),
                        vec4f(aInstPosition, 1.0)
                    );
                }

            #endif

            @vertex
            fn vertexMain(input: VertexInput) -> VertexOutput {
                var output: VertexOutput;

                // use functionality from transformCore to get a world position, which includes skinning, morphing or instancing as needed
                let modelMatrix: mat4x4f = getModelMatrix();
                let localPos: vec3f = getLocalPosition(input.vertex_position.xyz);
                let worldPos: vec4f = modelMatrix * vec4f(localPos, 1.0);

                // use functionality from normalCore to get the world normal, which includes skinning, morphing or instancing as needed
                let normalMatrix: mat3x3f = getNormalMatrix(modelMatrix);
                let localNormal: vec3f = getLocalNormal(input.vertex_normal);
                let worldNormal: vec3f = normalize(normalMatrix * localNormal);

                // wrap-around diffuse lighting
                output.brightness = (dot(worldNormal, uniform.uLightDir) + 1.0) * 0.5;

                // Pass the texture coordinates
                output.uv0 = input.aUv0;

                // Transform the geometry
                output.position = uniform.matrix_viewProjection * worldPos;

                return output;
            }
        `,

        fragmentWGSL: /* wgsl */ `

            #include "gammaPS"
            #include "tonemappingPS"
            #include "fogPS"

            varying brightness: f32;
            varying uv0: vec2f;

            uniform uColor: vec3f;
            #ifdef DIFFUSE_MAP
                var uDiffuseMap: texture_2d<f32>;
                var uDiffuseMapSampler: sampler;
            #endif

            // Gooch shading constants - could be exposed as uniforms instead
            const diffuseCool: f32 = 0.4;
            const diffuseWarm: f32 = 0.4;
            const cool: vec3f = vec3f(0.0, 0.0, 0.6);
            const warm: vec3f = vec3f(0.6, 0.0, 0.0);

            @fragment
            fn fragmentMain(input: FragmentInput) -> FragmentOutput {
                var output: FragmentOutput;

                var alpha: f32 = 1.0;
                var colorLinear: vec3f = uniform.uColor;

                // shader variant using a diffuse texture
                #ifdef DIFFUSE_MAP
                    let diffuseLinear: vec4f = textureSample(uDiffuseMap, uDiffuseMapSampler, input.uv0);
                    colorLinear = colorLinear * diffuseLinear.rgb;
                    alpha = diffuseLinear.a;
                #endif

                // simple Gooch shading that highlights structural and contextual data
                let kCool: vec3f = min(cool + diffuseCool * colorLinear, vec3f(1.0));
                let kWarm: vec3f = min(warm + diffuseWarm * colorLinear, vec3f(1.0));
                colorLinear = mix(kCool, kWarm, input.brightness);

                // handle standard color processing - the called functions are automatically attached to the
                // shader based on the current fog / tone-mapping / gamma settings
                let fogged: vec3f = addFog(colorLinear);
                let toneMapped: vec3f = toneMap(fogged);
                let final_rgb: vec3f = gammaCorrectOutput(toneMapped);
                output.color = vec4f(final_rgb, alpha);

                return output;
            }        
        `,

        attributes: {
            vertex_position: SEMANTIC_POSITION,
            vertex_normal: SEMANTIC_NORMAL,
            aUv0: SEMANTIC_TEXCOORD0,

            // instancing attributes
            aInstPosition: SEMANTIC_ATTR12,
            aInstScale: SEMANTIC_ATTR13
        }
    });

    // default parameters
    material.setParameter('uColor', color ?? [1, 1, 1]);

    if (texture) {
        material.setParameter('uDiffuseMap', texture);
        material.setDefine('DIFFUSE_MAP', true);
    }

    const lightDir = new Vec3(0.5, -0.5, 0.5).normalize();
    material.setParameter('uLightDir', [-lightDir.x, -lightDir.y, -lightDir.z]);

    return material;
};

export { createGoochMaterial };
