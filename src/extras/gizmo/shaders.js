import { SEMANTIC_POSITION } from '../../platform/graphics/constants.js';

/** @import { ShaderDesc } from '../../scene/materials/shader-material.js'; */

/**
 * @type {ShaderDesc}
 */
export const unlitShader = {
    uniqueName: 'gizmo-unlit',
    attributes: {
        vertex_position: SEMANTIC_POSITION
    },
    vertexWGSL: /* wgsl */`
        attribute vertex_position: vec3f;

        uniform matrix_model: mat4x4f;
        uniform matrix_viewProjection: mat4x4f;

        @vertex
        fn vertexMain(input: VertexInput) -> VertexOutput {
            var output: VertexOutput;
            let pos = vec4f(input.vertex_position, 1.0);
            output.position = uniform.matrix_viewProjection * uniform.matrix_model * pos;
            output.position.z = clamp(output.position.z, -abs(output.position.w), abs(output.position.w));
            return output;
        }
    `,
    fragmentWGSL: /* wgsl */`
        #include "gammaPS"

        uniform uColor: vec4f;
        uniform uDepth: f32;

        @fragment
        fn fragmentMain(input: FragmentInput) -> FragmentOutput {
            var output: FragmentOutput;
            if (uniform.uColor.a < 1.0 / 255.0) {
                discard;
            }
            output.color = vec4f(gammaCorrectOutput(decodeGamma(uniform.uColor)), uniform.uColor.a);
            #if DEPTH_WRITE == 1
                output.fragDepth = uniform.uDepth;
            #endif
            return output;
        }
    `
};
