import { Debug } from '../../core/debug.js';
import {
    SEMANTIC_POSITION, SEMANTIC_NORMAL, SEMANTIC_TANGENT, SEMANTIC_TEXCOORD0, SEMANTIC_TEXCOORD1, SEMANTIC_TEXCOORD2,
    SEMANTIC_TEXCOORD3, SEMANTIC_TEXCOORD4, SEMANTIC_TEXCOORD5, SEMANTIC_TEXCOORD6, SEMANTIC_TEXCOORD7,
    SEMANTIC_COLOR, SEMANTIC_BLENDINDICES, SEMANTIC_BLENDWEIGHT,
    SHADERLANGUAGE_WGSL,
    primitiveGlslToWgslTypeMap
} from './constants.js';
import wgslFS from './shader-chunks/frag/webgpu-wgsl.js';
import wgslVS from './shader-chunks/vert/webgpu-wgsl.js';
import sharedWGSL from './shader-chunks/frag/shared-wgsl.js';
import halfTypes from './shader-chunks/frag/half-types.js';

/**
 * @import { GraphicsDevice } from './graphics-device.js'
 */

const _attrib2Semantic = {
    vertex_position: SEMANTIC_POSITION,
    vertex_normal: SEMANTIC_NORMAL,
    vertex_tangent: SEMANTIC_TANGENT,
    vertex_texCoord0: SEMANTIC_TEXCOORD0,
    vertex_texCoord1: SEMANTIC_TEXCOORD1,
    vertex_texCoord2: SEMANTIC_TEXCOORD2,
    vertex_texCoord3: SEMANTIC_TEXCOORD3,
    vertex_texCoord4: SEMANTIC_TEXCOORD4,
    vertex_texCoord5: SEMANTIC_TEXCOORD5,
    vertex_texCoord6: SEMANTIC_TEXCOORD6,
    vertex_texCoord7: SEMANTIC_TEXCOORD7,
    vertex_color: SEMANTIC_COLOR,
    vertex_boneIndices: SEMANTIC_BLENDINDICES,
    vertex_boneWeights: SEMANTIC_BLENDWEIGHT
};

/**
 * A class providing utility functions for shader definition creation.
 *
 * @ignore
 */
class ShaderDefinitionUtils {
    /**
     * Creates a shader definition.
     *
     * @param {GraphicsDevice} device - The graphics device.
     * @param {object} options - Object for passing optional arguments.
     * @param {string} [options.name] - A name of the shader.
     * @param {object} [options.attributes] - Attributes. Will be extracted from the vertexCode if
     * not provided.
     * @param {string} options.vertexCode - The vertex shader code.
     * @param {string} [options.fragmentCode] - The fragment shader code.
     * @param {Map<string, string>} [options.vertexIncludes] - A map containing key-value pairs of
     * include names and their content. These are used for resolving #include directives in the
     * vertex shader source.
     * @param {Map<string, string>} [options.vertexDefines] - A map containing key-value pairs of
     * define names and their values. These are used for resolving #ifdef style of directives in the
     * vertex code.
     * @param {Map<string, string>} [options.fragmentIncludes] - A map containing key-value pairs
     * of include names and their content. These are used for resolving #include directives in the
     * fragment shader source.
     * @param {Map<string, string>} [options.fragmentDefines] - A map containing key-value pairs of
     * define names and their values. These are used for resolving #ifdef style of directives in the
     * fragment code.
     * @param {string | string[]} [options.fragmentOutputTypes] - Fragment shader output types,
     * which default to vec4. Passing a string will set the output type for all color attachments.
     * Passing an array will set the output type for each color attachment.
     * @returns {object} Returns the created shader definition.
     */
    static createDefinition(device, options) {
        Debug.assert(options);
        Debug.assert(!options.vertexDefines || options.vertexDefines instanceof Map);
        Debug.assert(!options.vertexIncludes || options.vertexIncludes instanceof Map);
        Debug.assert(!options.fragmentDefines || options.fragmentDefines instanceof Map);
        Debug.assert(!options.fragmentIncludes || options.fragmentIncludes instanceof Map);

        // Normalize fragmentOutputTypes to an array
        const normalizedOutputTypes = (options) => {
            let fragmentOutputTypes = options.fragmentOutputTypes ?? 'vec4';
            if (!Array.isArray(fragmentOutputTypes)) {
                fragmentOutputTypes = [fragmentOutputTypes];
            }
            return fragmentOutputTypes;
        };

        const getDefinesWgsl = (isVertex, options) => {

            // Enable directives must come before all global declarations
            let code = ShaderDefinitionUtils.getWGSLEnables(device, isVertex ? 'vertex' : 'fragment');

            // Define the fragment shader output type, vec4 by default
            if (!isVertex) {
                const fragmentOutputTypes = normalizedOutputTypes(options);

                // create alias for each output type
                for (let i = 0; i < device.maxColorAttachments; i++) {
                    const glslOutType = fragmentOutputTypes[i] ?? 'vec4';
                    const wgslOutType = primitiveGlslToWgslTypeMap.get(glslOutType);
                    Debug.assert(wgslOutType, `Unknown output type translation: ${glslOutType} -> ${wgslOutType}`);
                    code += `alias pcOutType${i} = ${wgslOutType};\n`;
                }
            }

            return code;
        };

        const name = options.name ?? 'Untitled';

        const vertexDefinesCode = ShaderDefinitionUtils.getDefinesCode(device, options.vertexDefines);
        const fragmentDefinesCode = ShaderDefinitionUtils.getDefinesCode(device, options.fragmentDefines);

        const vertCode = `
            ${getDefinesWgsl(true, options)}
            ${vertexDefinesCode}
            ${halfTypes}
            ${wgslVS}
            ${sharedWGSL}
            ${options.vertexCode}
        `;

        const fragCode = `
            ${getDefinesWgsl(false, options)}
            ${fragmentDefinesCode}
            ${halfTypes}
            ${wgslFS}
            ${sharedWGSL}
            ${options.fragmentCode}
        `;

        return {
            name: name,
            shaderLanguage: SHADERLANGUAGE_WGSL,
            attributes: options.attributes,
            vshader: vertCode,
            vincludes: options.vertexIncludes,
            fincludes: options.fragmentIncludes,
            fshader: fragCode,
            meshUniformBufferFormat: options.meshUniformBufferFormat,
            meshBindGroupFormat: options.meshBindGroupFormat
        };
    }

    /**
     * Generates WGSL enable directives based on device capabilities. Enable directives must come
     * before all global declarations in WGSL shaders.
     *
     * @param {GraphicsDevice} device - The graphics device.
     * @param {'vertex'|'fragment'|'compute'} shaderType - The type of shader.
     * @returns {string} The WGSL enable directives code.
     * @ignore
     */
    static getWGSLEnables(device, shaderType) {
        let code = '';
        if (device.supportsShaderF16) {
            code += 'enable f16;\n';
        }
        if (shaderType === 'fragment' && device.supportsPrimitiveIndex) {
            code += 'enable primitive_index;\n';
        }
        return code;
    }

    /**
     * @param {GraphicsDevice} device - The graphics device.
     * @param {Map<string, string>} [defines] - A map containing key-value pairs.
     * @returns {string} The shader code for the defines.
     * @ignore
     */
    static getDefinesCode(device, defines) {
        let code = '';

        device.capsDefines.forEach((value, key) => {
            code += `#define ${key} ${value}\n`;
        });
        code += '\n';

        defines?.forEach((value, key) => {
            code += `#define ${key} ${value}\n`;
        });
        code += '\n';

        return code;
    }

    // SpectorJS integration
    static getShaderNameCode(name) {
        return `#define SHADER_NAME ${name}\n`;
    }
}

export { ShaderDefinitionUtils };
