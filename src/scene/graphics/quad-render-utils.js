import { Debug } from '../../core/debug.js';
import { Vec4 } from '../../core/math/vec4.js';
import { QuadRender } from './quad-render.js';
import { RenderPassQuad } from './render-pass-quad.js';

/**
 * @import { GraphicsDevice } from '../../platform/graphics/graphics-device.js'
 * @import { RenderTarget } from '../../platform/graphics/render-target.js'
 * @import { Shader } from '../../platform/graphics/shader.js'
 * @import { Texture } from '../../platform/graphics/texture.js'
 */

const _tempRect = new Vec4();

/**
 * Draws a screen-space quad using a specific shader.
 *
 * @param {GraphicsDevice} device - The graphics device used to draw the quad.
 * @param {RenderTarget|null} target - The destination render target. If undefined, target is the
 * frame buffer.
 * @param {Shader} shader - The shader used for rendering the quad. Vertex shader should contain
 * `attribute vec2 vertex_position`.
 * @param {Vec4} [rect] - The viewport rectangle of the quad, in pixels. Defaults to fullscreen:
 * `[0, 0, target.width, target.height]`.
 * @param {Vec4} [scissorRect] - The scissor rectangle of the quad, in pixels. Defaults to fullscreen:
 * `[0, 0, target.width, target.height]`.
 * @category Graphics
 */
function drawQuadWithShader(device, target, shader, rect, scissorRect) {

    // a valid target or a null target (framebuffer) are supported
    Debug.assert(target !== undefined);

    const useBlend = arguments[5];
    Debug.call(() => {
        if (useBlend !== undefined) {
            Debug.warnOnce('pc.drawQuadWithShader no longer accepts useBlend parameter, and blending state needs to be set up using GraphicsDevice.setBlendState.');
        }
    });

    // prepare the quad for rendering with the shader
    const quad = new QuadRender(shader);

    // by default render to the whole render target
    if (!rect) {
        rect = _tempRect;
        rect.x = 0;
        rect.y = 0;
        rect.z = target ? target.width : device.width;
        rect.w = target ? target.height : device.height;
    }

    // prepare a render pass to render the quad to the render target
    const renderPass = new RenderPassQuad(device, quad, rect, scissorRect);
    renderPass.init(target);
    renderPass.colorOps.clear = false;
    renderPass.depthStencilOps.clearDepth = false;

    // When rendering to the default multi-sampled framebuffer, store the color buffer instead of
    // only resolving it, as subsequent render passes may also write to it.
    if (target === null && device.samples > 1) {
        renderPass.colorOps.store = true;
    }

    renderPass.render();

    quad.destroy();
}

export { drawQuadWithShader };
