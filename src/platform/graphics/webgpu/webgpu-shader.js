import { Debug, DebugHelper } from '../../../core/debug.js';
import { StringIds } from '../../../core/string-ids.js';
import { SHADERLANGUAGE_WGSL } from '../constants.js';
import { DebugGraphics } from '../debug-graphics.js';
import { WebgpuDebug } from './webgpu-debug.js';
import { WebgpuShaderProcessorWGSL } from './webgpu-shader-processor-wgsl.js';

/**
 * @import { GraphicsDevice } from '../graphics-device.js'
 * @import { Shader } from '../shader.js'
 */

// Shared StringIds instance for content-based compute shader keys
const computeShaderIds = new StringIds();

/**
 * A WebGPU implementation of the Shader.
 *
 * @ignore
 */
class WebgpuShader {
    /**
     * Transpiled vertex shader code.
     *
     * @type {string|null}
     */
    _vertexCode = null;

    /**
     * Transpiled fragment shader code.
     *
     * @type {string|null}
     */
    _fragmentCode = null;

    /**
     * Compute shader code.
     *
     * @type {string|null}
     */
    _computeCode = null;

    /**
     * Cached content-based key for compute shader.
     *
     * @type {number|undefined}
     * @private
     */
    _computeKey;

    /**
     * Name of the vertex entry point function.
     */
    vertexEntryPoint = 'vertexMain';

    /**
     * Name of the fragment entry point function.
     */
    fragmentEntryPoint = 'fragmentMain';

    /**
     * Name of the compute entry point function.
     */
    computeEntryPoint = 'main';

    /**
     * @param {Shader} shader - The shader.
     */
    constructor(shader) {
        /** @type {Shader} */
        this.shader = shader;

        const definition = shader.definition;
        Debug.assert(definition);
        Debug.assert(definition.shaderLanguage === SHADERLANGUAGE_WGSL, 'Only WGSL shaders are supported.');

        if (definition.cshader) {

            this._computeCode = definition.cshader ?? null;
            this.computeUniformBufferFormats = definition.computeUniformBufferFormats;
            this.computeBindGroupFormat = definition.computeBindGroupFormat;
            if (definition.computeEntryPoint) {
                this.computeEntryPoint = definition.computeEntryPoint;
            }

        } else {

            if (definition.processingOptions) {

                this.processWGSL();

            } else {

                this._vertexCode = definition.vshader ?? null;
                this._fragmentCode = definition.fshader ?? null;

                shader.meshUniformBufferFormat = definition.meshUniformBufferFormat;
                shader.meshBindGroupFormat = definition.meshBindGroupFormat;
            }
        }

        shader.ready = true;
    }

    /**
     * Free the WebGPU resources associated with a shader.
     *
     * @param {Shader} shader - The shader to free.
     */
    destroy(shader) {
        this._vertexCode = null;
        this._fragmentCode = null;
    }

    createShaderModule(code, shaderType) {
        const device = this.shader.device;
        const wgpu = device.wgpu;

        WebgpuDebug.validate(device);

        const shaderModule = wgpu.createShaderModule({
            code: code
        });
        DebugHelper.setLabel(shaderModule, `${shaderType}:${this.shader.label}`);

        WebgpuDebug.endShader(device, shaderModule, code, 6, {
            shaderType,
            source: code,
            shader: this.shader
        });

        return shaderModule;
    }

    getVertexShaderModule() {
        return this.createShaderModule(this._vertexCode, 'Vertex');
    }

    getFragmentShaderModule() {
        return this.createShaderModule(this._fragmentCode, 'Fragment');
    }

    getComputeShaderModule() {
        return this.createShaderModule(this._computeCode, 'Compute');
    }

    processWGSL() {
        const shader = this.shader;

        // process the shader source to allow for uniforms
        const processed = WebgpuShaderProcessorWGSL.run(shader.device, shader.definition, shader);

        // keep reference to processed shaders in debug mode
        Debug.call(() => {
            this.processed = processed;
        });

        this._vertexCode = processed.vshader;
        this._fragmentCode = processed.fshader;

        shader.meshUniformBufferFormat = processed.meshUniformBufferFormat;
        shader.meshBindGroupFormat = processed.meshBindGroupFormat;
        shader.attributes = processed.attributes;
    }

    get vertexCode() {
        Debug.assert(this._vertexCode);
        return this._vertexCode;
    }

    get fragmentCode() {
        Debug.assert(this._fragmentCode);
        return this._fragmentCode;
    }

    /**
     * Content-based key for compute shader caching. Returns the same key for identical
     * shader code and entry point combinations, regardless of how many Shader instances exist.
     *
     * @type {number}
     * @ignore
     */
    get computeKey() {
        if (this._computeKey === undefined) {
            const keyString = `${this._computeCode}|${this.computeEntryPoint}`;
            this._computeKey = computeShaderIds.get(keyString);
        }
        return this._computeKey;
    }

    /**
     * Dispose the shader when the context has been lost.
     */
    loseContext() {
    }

    /**
     * Restore shader after the context has been obtained.
     *
     * @param {GraphicsDevice} device - The graphics device.
     * @param {Shader} shader - The shader to restore.
     */
    restoreContext(device, shader) {
    }
}

export { WebgpuShader };
