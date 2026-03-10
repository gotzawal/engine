import { math } from '../../core/math/math.js';
import {
    LIGHTTYPE_OMNI, LIGHTTYPE_SPOT
} from '../constants.js';

/**
 * @import { GraphicsDevice } from '../../platform/graphics/graphics-device.js'
 * @import { Light } from '../../scene/light.js'
 * @import { Renderer } from './renderer.js'
 * @import { ShadowRenderer } from './shadow-renderer.js'
 */

class ShadowRendererLocal {
    // temporary list to collect lights to render shadows for
    shadowLights = [];

    /** @type {Renderer} */
    renderer;

    /** @type {ShadowRenderer} */
    shadowRenderer;

    /** @type {GraphicsDevice} */
    device;

    constructor(renderer, shadowRenderer) {
        this.renderer = renderer;
        this.shadowRenderer = shadowRenderer;
        this.device = renderer.device;
    }

    // cull local shadow map
    cull(light, comp, casters = null) {

        // force light visibility if function was manually called
        light.visibleThisFrame = true;

        const type = light._type;
        const faceCount = type === LIGHTTYPE_SPOT ? 1 : 6;

        for (let face = 0; face < faceCount; face++) {

            // render data are shared between cameras for local lights, so pass null for camera
            const lightRenderData = light.getRenderData(null, face);
            const shadowCam = lightRenderData.shadowCamera;

            shadowCam.nearClip = light.attenuationEnd / 1000;
            shadowCam.farClip = light.attenuationEnd;

            const shadowCamNode = shadowCam._node;
            const lightNode = light._node;
            shadowCamNode.setPosition(lightNode.getPosition());

            if (type === LIGHTTYPE_SPOT) {
                shadowCam.fov = light._outerConeAngle * 2;

                // Camera looks down the negative Z, and spot light points down the negative Y
                shadowCamNode.setRotation(lightNode.getRotation());
                shadowCamNode.rotateLocal(-90, 0, 0);

            } else if (type === LIGHTTYPE_OMNI) {

                // use larger fov by few pixels to allow shadow filtering to stay on a single face
                const tileSize = this.shadowRenderer.lightTextureAtlas.shadowAtlasResolution * light.atlasViewport.z / 3;    // using 3x3 for cubemap
                const texelSize = 2 / tileSize;
                const filterSize = texelSize * this.shadowRenderer.lightTextureAtlas.shadowEdgePixels;
                shadowCam.fov = Math.atan(1 + filterSize) * math.RAD_TO_DEG * 2;
            }

            // cull shadow casters
            this.renderer.updateCameraFrustum(shadowCam);
            this.shadowRenderer.cullShadowCasters(comp, light, lightRenderData.visibleCasters, shadowCam, casters);
        }
    }

    prepareLights(shadowLights, lights) {

        let shadowCamera;
        for (let i = 0; i < lights.length; i++) {
            const light = lights[i];

            if (this.shadowRenderer.needsShadowRendering(light) && light.atlasViewportAllocated) {

                shadowLights.push(light);

                for (let face = 0; face < light.numShadowFaces; face++) {
                    shadowCamera = this.shadowRenderer.prepareFace(light, null, face);
                }
            }
        }

        return shadowCamera;
    }
}

export { ShadowRendererLocal };
