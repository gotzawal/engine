import { now } from '../../core/time.js';
import { Debug } from '../../core/debug.js';
import { Vec3 } from '../../core/math/vec3.js';
import { Color } from '../../core/math/color.js';
import { DebugGraphics } from '../../platform/graphics/debug-graphics.js';
import {
    FOG_NONE, FOG_LINEAR,
    LIGHTTYPE_DIRECTIONAL,
    LIGHTSHAPE_PUNCTUAL,
    LAYERID_DEPTH,
    PROJECTION_ORTHOGRAPHIC,
    SHADERDEF_SKIN, SHADERDEF_MORPH_POSITION, SHADERDEF_MORPH_NORMAL, SHADERDEF_MORPH_TEXTURE_BASED_INT,
    SHADERDEF_BATCH, SHADERDEF_INSTANCING,
    GPU_DRIVEN_EXCLUDE_DEFS
} from '../constants.js';
import { WorldClustersDebug } from '../lighting/world-clusters-debug.js';
import { Renderer } from './renderer.js';
import { RenderPassForward } from './render-pass-forward.js';
import { RenderBundleCache } from './render-bundle-cache.js';
import { DrawCallGrouper } from './draw-call-group.js';

// GPU render feature flags — must match mesh-instance.js constants
const GPU_RENDER_DEF_GPU_DRIVEN = 1;
const GPU_RENDER_DEF_MSB = 2;

import { BINDGROUP_VIEW } from '../../platform/graphics/constants.js';

/**
 * @import { BindGroup } from '../../platform/graphics/bind-group.js'
 * @import { Camera } from '../camera.js'
 * @import { FrameGraph } from '../frame-graph.js'
 * @import { GraphicsDevice } from '../../platform/graphics/graphics-device.js'
 * @import { LayerComposition } from '../composition/layer-composition.js'
 * @import { Layer } from '../layer.js'
 * @import { MeshInstance } from '../mesh-instance.js'
 * @import { RenderTarget } from '../../platform/graphics/render-target.js'
 * @import { Scene } from '../scene.js'
 * @import { WorldClusters } from '../lighting/world-clusters.js'
 */

const _noLights = [[], [], []];
const _indirectArgs = new Uint32Array(5);
const tmpColor = new Color();


const _drawCallList = {
    drawCalls: [],
    shaderInstances: [],
    isNewMaterial: [],
    lightMaskChanged: [],

    clear: function () {
        this.drawCalls.length = 0;
        this.shaderInstances.length = 0;
        this.isNewMaterial.length = 0;
        this.lightMaskChanged.length = 0;
    }
};

function vogelDiskPrecalculationSamples(numSamples) {
    const samples = [];
    for (let i = 0; i < numSamples; ++i) {
        const r = Math.sqrt(i + 0.5) / Math.sqrt(numSamples);
        samples.push(r);
    }
    return samples;
}

function vogelSpherePrecalculationSamples(numSamples) {
    const samples = [];
    for (let i = 0; i < numSamples; i++) {
        const weight = i / numSamples;
        const radius = Math.sqrt(weight * weight);
        samples.push(radius);
    }
    return samples;
}

/**
 * The forward renderer renders {@link Scene}s.
 *
 * @ignore
 */
class ForwardRenderer extends Renderer {
    /**
     * Create a new ForwardRenderer instance.
     *
     * @param {GraphicsDevice} graphicsDevice - The graphics device used by the renderer.
     * @param {Scene} scene - The scene.
     */
    constructor(graphicsDevice, scene) {
        super(graphicsDevice, scene);

        const device = this.device;

        this._forwardDrawCalls = 0;
        this._materialSwitches = 0;
        this._forwardTime = 0;
        this._sortTime = 0;

        /**
         * Whether opaque render bundles are enabled. When true, eligible opaque draw calls
         * are grouped by pipeline state and recorded into GPURenderBundles for efficient replay.
         *
         * @type {boolean}
         */
        this.renderBundlesEnabled = false;

        /**
         * Whether material data is packed into a global StorageBuffer array.
         * When true, material properties are accessed via materialIndex in shaders.
         * Can be toggled at runtime from the examples UI.
         *
         * @type {boolean}
         */
        this.materialStorageBufferEnabled = false;

        /**
         * Whether GPU-driven rendering is enabled. When true, eligible static mesh instances
         * are rendered using merged geometry buffers, compute-based culling, and compacted
         * indirect draw calls. This eliminates per-draw setVertexBuffer and setBindGroup overhead.
         *
         * @type {boolean}
         */
        this.gpuDrivenEnabled = false;

        /**
         * Whether texture array batching is enabled for GPU-driven rendering.
         * When true, compatible textures are merged into texture_2d_array resources
         * and sampled via per-draw layer indices from the MaterialData storage buffer.
         *
         * @type {boolean}
         */
        this.textureArrayBatchingEnabled = false;

        /**
         * Pipeline groups for compacted indirect draws, set by _dispatchGpuDrivenCompaction.
         *
         * @type {Array|null}
         * @private
         */
        this._pipelineGroups = null;

        /**
         * @type {RenderBundleCache}
         * @private
         */
        this._bundleCache = new RenderBundleCache();

        /**
         * @type {DrawCallGrouper}
         * @private
         */
        this._drawCallGrouper = new DrawCallGrouper();

        // Uniforms
        const scope = device.scope;

        this.materialIndexId = scope.resolve('materialIndex');

        this.fogColorId = scope.resolve('fog_color');
        this.fogStartId = scope.resolve('fog_start');
        this.fogEndId = scope.resolve('fog_end');
        this.fogDensityId = scope.resolve('fog_density');

        this.ambientId = scope.resolve('light_globalAmbient');
        this.skyboxIntensityId = scope.resolve('skyboxIntensity');
        this.cubeMapRotationMatrixId = scope.resolve('cubeMapRotationMatrix');
        this.pcssDiskSamplesId = scope.resolve('pcssDiskSamples[0]');
        this.pcssSphereSamplesId = scope.resolve('pcssSphereSamples[0]');
        this.lightColorId = [];
        this.lightDir = [];
        this.lightDirId = [];
        this.lightShadowMapId = [];
        this.lightShadowMatrixId = [];
        this.lightShadowParamsId = [];
        this.lightShadowIntensity = [];
        this.lightRadiusId = [];
        this.lightPos = [];
        this.lightPosId = [];
        this.lightWidth = [];
        this.lightWidthId = [];
        this.lightHeight = [];
        this.lightHeightId = [];
        this.lightInAngleId = [];
        this.lightOutAngleId = [];
        this.lightCookieId = [];
        this.lightCookieIntId = [];
        this.lightCookieMatrixId = [];
        this.lightCookieOffsetId = [];
        this.lightShadowSearchAreaId = [];
        this.lightCameraParamsId = [];
        this.lightSoftShadowParamsId = [];

        // shadow cascades
        this.shadowMatrixPaletteId = [];
        this.shadowCascadeDistancesId = [];
        this.shadowCascadeCountId = [];
        this.shadowCascadeBlendId = [];

        this.screenSizeId = scope.resolve('uScreenSize');
        this._screenSize = new Float32Array(4);

        this.fogColor = new Float32Array(3);
        this.ambientColor = new Float32Array(3);

        this.pcssDiskSamples = vogelDiskPrecalculationSamples(16);
        this.pcssSphereSamples = vogelSpherePrecalculationSamples(16);
    }

    destroy() {
        super.destroy();
    }

    // #if _PROFILER
    // Static properties used by the Profiler in the Editor's Launch Page
    static skipRenderCamera = null;

    static _skipRenderCounter = 0;

    static skipRenderAfter = 0;
    // #endif

    /**
     * @param {Scene} scene - The scene.
     */
    dispatchGlobalLights(scene) {
        const ambientUniform = this.ambientColor;

        // color in linear space
        tmpColor.linear(scene.ambientLight);
        ambientUniform[0] = tmpColor.r;
        ambientUniform[1] = tmpColor.g;
        ambientUniform[2] = tmpColor.b;

        if (scene.physicalUnits) {
            for (let i = 0; i < 3; i++) {
                ambientUniform[i] *= scene.ambientLuminance;
            }
        }
        this.ambientId.setValue(ambientUniform);

        this.skyboxIntensityId.setValue(scene.physicalUnits ? scene.skyboxLuminance : scene.skyboxIntensity);
        this.cubeMapRotationMatrixId.setValue(scene._skyboxRotationMat3.data);
    }

    _resolveLight(scope, i) {
        const light = `light${i}`;
        this.lightColorId[i] = scope.resolve(`${light}_color`);
        this.lightDir[i] = new Float32Array(3);
        this.lightDirId[i] = scope.resolve(`${light}_direction`);
        this.lightShadowMapId[i] = scope.resolve(`${light}_shadowMap`);
        this.lightShadowMatrixId[i] = scope.resolve(`${light}_shadowMatrix`);
        this.lightShadowParamsId[i] = scope.resolve(`${light}_shadowParams`);
        this.lightShadowIntensity[i] = scope.resolve(`${light}_shadowIntensity`);
        this.lightShadowSearchAreaId[i] = scope.resolve(`${light}_shadowSearchArea`);
        this.lightRadiusId[i] = scope.resolve(`${light}_radius`);
        this.lightPos[i] = new Float32Array(3);
        this.lightPosId[i] = scope.resolve(`${light}_position`);
        this.lightWidth[i] = new Float32Array(3);
        this.lightWidthId[i] = scope.resolve(`${light}_halfWidth`);
        this.lightHeight[i] = new Float32Array(3);
        this.lightHeightId[i] = scope.resolve(`${light}_halfHeight`);
        this.lightInAngleId[i] = scope.resolve(`${light}_innerConeAngle`);
        this.lightOutAngleId[i] = scope.resolve(`${light}_outerConeAngle`);
        this.lightCookieId[i] = scope.resolve(`${light}_cookie`);
        this.lightCookieIntId[i] = scope.resolve(`${light}_cookieIntensity`);
        this.lightCookieMatrixId[i] = scope.resolve(`${light}_cookieMatrix`);
        this.lightCookieOffsetId[i] = scope.resolve(`${light}_cookieOffset`);
        this.lightCameraParamsId[i] = scope.resolve(`${light}_cameraParams`);
        this.lightSoftShadowParamsId[i] = scope.resolve(`${light}_softShadowParams`);

        // shadow cascades
        this.shadowMatrixPaletteId[i] = scope.resolve(`${light}_shadowMatrixPalette[0]`);
        this.shadowCascadeDistancesId[i] = scope.resolve(`${light}_shadowCascadeDistances`);
        this.shadowCascadeCountId[i] = scope.resolve(`${light}_shadowCascadeCount`);
        this.shadowCascadeBlendId[i] = scope.resolve(`${light}_shadowCascadeBlend`);
    }

    setLTCDirectionalLight(wtm, cnt, dir, campos, far) {
        this.lightPos[cnt][0] = campos.x - dir.x * far;
        this.lightPos[cnt][1] = campos.y - dir.y * far;
        this.lightPos[cnt][2] = campos.z - dir.z * far;
        this.lightPosId[cnt].setValue(this.lightPos[cnt]);

        const hWidth = wtm.transformVector(new Vec3(-0.5, 0, 0));
        this.lightWidth[cnt][0] = hWidth.x * far;
        this.lightWidth[cnt][1] = hWidth.y * far;
        this.lightWidth[cnt][2] = hWidth.z * far;
        this.lightWidthId[cnt].setValue(this.lightWidth[cnt]);

        const hHeight = wtm.transformVector(new Vec3(0, 0, 0.5));
        this.lightHeight[cnt][0] = hHeight.x * far;
        this.lightHeight[cnt][1] = hHeight.y * far;
        this.lightHeight[cnt][2] = hHeight.z * far;
        this.lightHeightId[cnt].setValue(this.lightHeight[cnt]);
    }

    dispatchDirectLights(dirs, mask, camera) {
        let cnt = 0;

        const scope = this.device.scope;

        for (let i = 0; i < dirs.length; i++) {
            if (!(dirs[i].mask & mask)) continue;

            const directional = dirs[i];
            const wtm = directional._node.getWorldTransform();

            if (!this.lightColorId[cnt]) {
                this._resolveLight(scope, cnt);
            }

            this.lightColorId[cnt].setValue(directional._colorLinear);

            // Directional lights shine down the negative Y axis
            wtm.getY(directional._direction).mulScalar(-1);
            directional._direction.normalize();
            this.lightDir[cnt][0] = directional._direction.x;
            this.lightDir[cnt][1] = directional._direction.y;
            this.lightDir[cnt][2] = directional._direction.z;
            this.lightDirId[cnt].setValue(this.lightDir[cnt]);

            if (directional.shape !== LIGHTSHAPE_PUNCTUAL) {
                // non-punctual shape - NB directional area light specular is approximated by putting the area light at the far clip
                this.setLTCDirectionalLight(wtm, cnt, directional._direction, camera._node.getPosition(), camera.farClip);
            }

            if (directional.castShadows) {

                // ortho projection does not support cascades
                Debug.call(() => {
                    if (camera.projection === PROJECTION_ORTHOGRAPHIC && directional.numCascades !== 1) {
                        Debug.errorOnce(`Camera [${camera.node.name}] with orthographic projection cannot use cascaded shadows, expect incorrect rendering.`);
                    }
                });

                const lightRenderData = directional.getRenderData(camera, 0);
                const biases = directional._getUniformBiasValues(lightRenderData);

                this.lightShadowMapId[cnt].setValue(lightRenderData.shadowBuffer);
                this.lightShadowMatrixId[cnt].setValue(lightRenderData.shadowMatrix.data);

                this.shadowMatrixPaletteId[cnt].setValue(directional._shadowMatrixPalette);
                this.shadowCascadeDistancesId[cnt].setValue(directional._shadowCascadeDistances);
                this.shadowCascadeCountId[cnt].setValue(directional.numCascades);
                this.shadowCascadeBlendId[cnt].setValue(1 - directional.cascadeBlend);
                this.lightShadowIntensity[cnt].setValue(directional.shadowIntensity);
                this.lightSoftShadowParamsId[cnt].setValue(directional._softShadowParams);

                const shadowRT = lightRenderData.shadowCamera.renderTarget;
                if (shadowRT) {
                    this.lightShadowSearchAreaId[cnt].setValue(directional.penumbraSize / lightRenderData.shadowCamera.renderTarget.width * lightRenderData.projectionCompensation);
                }

                const cameraParams = directional._shadowCameraParams;
                cameraParams.length = 4;
                cameraParams[0] = 0; // unused
                cameraParams[1] = lightRenderData.shadowCamera._farClip;
                cameraParams[2] = lightRenderData.shadowCamera._nearClip;
                cameraParams[3] = 1;
                this.lightCameraParamsId[cnt].setValue(cameraParams);

                const params = directional._shadowRenderParams;
                params.length = 4;
                params[0] = directional._shadowResolution;  // Note: this needs to change for non-square shadow maps (2 cascades). Currently square is used
                params[1] = biases.normalBias;
                params[2] = biases.bias;
                params[3] = 0;
                this.lightShadowParamsId[cnt].setValue(params);
            }
            cnt++;
        }
        return cnt;
    }

    // execute first pass over draw calls, in order to update materials / shaders
    renderForwardPrepareMaterials(camera, renderTarget, drawCalls, sortedLights, layer, pass) {

        // fog params from the scene, or overridden by the camera
        const fogParams = camera.fogParams ?? this.scene.fog;

        // camera shader params
        const shaderParams = camera.shaderParams;
        shaderParams.fog = fogParams.type;
        shaderParams.srgbRenderTarget = renderTarget?.isColorBufferSrgb(0) ?? false;    // output gamma correction is determined by the render target

        const addCall = (drawCall, shaderInstance, isNewMaterial, lightMaskChanged) => {
            _drawCallList.drawCalls.push(drawCall);
            _drawCallList.shaderInstances.push(shaderInstance);
            _drawCallList.isNewMaterial.push(isNewMaterial);
            _drawCallList.lightMaskChanged.push(lightMaskChanged);
        };

        // start with empty arrays
        _drawCallList.clear();

        const device = this.device;
        const scene = this.scene;
        const lightHash = layer?.getLightHash(true) ?? 0;
        let prevMaterial = null, prevObjDefs, prevLightMask;

        const drawCallsCount = drawCalls.length;
        for (let i = 0; i < drawCallsCount; i++) {

            /** @type {MeshInstance} */
            const drawCall = drawCalls[i];

            // #if _PROFILER
            if (camera === ForwardRenderer.skipRenderCamera) {
                if (ForwardRenderer._skipRenderCounter >= ForwardRenderer.skipRenderAfter) {
                    continue;
                }
                ForwardRenderer._skipRenderCounter++;
            }
            if (layer) {
                if (layer._skipRenderCounter >= layer.skipRenderAfter) {
                    continue;
                }
                layer._skipRenderCounter++;
            }
            // #endif

            // skip instanced rendering with 0 instances
            const instancingData = drawCall.instancingData;
            if (instancingData && instancingData.count <= 0) {
                continue;
            }

            drawCall.ensureMaterial(device);
            const material = drawCall.material;

            const objDefs = drawCall._shaderDefs;
            const lightMask = drawCall.mask;

            if (material && material === prevMaterial && objDefs !== prevObjDefs) {
                prevMaterial = null; // force change shader if the object uses a different variant of the same material
            }

            if (material !== prevMaterial) {
                this._materialSwitches++;
                material._scene = scene;

                if (material.dirty) {
                    DebugGraphics.pushGpuMarker(device, `Node: ${drawCall.node.name}, Material: ${material.name}`);
                    material.updateUniforms(device, scene);
                    material.dirty = false;
                    DebugGraphics.popGpuMarker(device);
                }

                // Pack material into global storage buffer when enabled
                if (this.materialStorageBufferEnabled && this.materialStorageBuffer) {
                    const msb = this.materialStorageBuffer;
                    if (material._materialSlot < 0) {
                        material._materialSlot = msb.allocateSlot();
                        material._materialStorageBuffer = msb;
                    }

                    // Texture array batching: register diffuse textures BEFORE packing
                    // so texArrayLayers contains correct layer indices on the first pack
                    const tam = this.textureArrayManager;
                    if (tam && this.textureArrayBatchingEnabled) {
                        if (material.diffuseMap && !material._diffuseArrayEntry) {
                            material._diffuseArrayEntry = tam.addTexture(material.diffuseMap);
                        }
                        const hasDiffuse = !!material.diffuseMap;
                        const diffuseInArray = !!material._diffuseArrayEntry;
                        material._textureArrayCompatible = !hasDiffuse || diffuseInArray;
                    }

                    if (material.packToStorageBuffer) {
                        material.packToStorageBuffer(msb, material._materialSlot);
                    }
                }
            }

            // GPU render feature flags — stored in _gpuRenderDefs (not _shaderDefs)
            // to avoid corrupting the light mask in the upper 16 bits of _shaderDefs.
            let gpuDefs = 0;
            if (this.materialStorageBufferEnabled) gpuDefs |= GPU_RENDER_DEF_MSB;
            if (this.gpuDrivenEnabled) {
                const entry = drawCall._geometryPoolEntry;
                const noExclude = !(drawCall._shaderDefs & GPU_DRIVEN_EXCLUDE_DEFS);

                if (entry && noExclude &&
                    drawCall._globalTransformSlot >= 0 &&
                    this.materialStorageBufferEnabled && material._materialSlot >= 0 &&
                    drawCall._gpuDrivenDrawId >= 0) {
                    gpuDefs |= GPU_RENDER_DEF_GPU_DRIVEN;
                }
            }
            drawCall._gpuRenderDefs = gpuDefs;

            const shaderInstance = drawCall.getShaderInstance(pass, lightHash, scene, shaderParams, this.viewUniformFormat, this.viewBindGroupFormat, sortedLights);

            addCall(drawCall, shaderInstance, material !== prevMaterial, !prevMaterial || lightMask !== prevLightMask);

            prevMaterial = material;
            prevObjDefs = objDefs;
            prevLightMask = lightMask;
        }

        return _drawCallList;
    }

    renderForwardInternal(camera, preparedCalls, sortedLights, pass, drawCallback, flipFaces, viewBindGroups) {
        const device = this.device;
        const passFlag = 1 << pass;
        const flipFactor = flipFaces ? -1 : 1;

        // multiview xr rendering
        const viewList = camera.xr?.session && camera.xr.views.list.length ? camera.xr.views.list : null;

        // Render the scene
        const preparedCallsCount = preparedCalls.drawCalls.length;
        for (let i = 0; i < preparedCallsCount; i++) {

            /** @type {MeshInstance} */
            const drawCall = preparedCalls.drawCalls[i];

            // We have a mesh instance
            const newMaterial = preparedCalls.isNewMaterial[i];
            const lightMaskChanged = preparedCalls.lightMaskChanged[i];
            const shaderInstance = preparedCalls.shaderInstances[i];
            const material = drawCall.material;
            const lightMask = drawCall.mask;

            if (shaderInstance.shader.failed) continue;

            if (newMaterial) {

                const asyncCompile = false;
                device.setShader(shaderInstance.shader, asyncCompile);

                // Uniforms I: material
                if (this.materialStorageBufferEnabled && material._materialSlot >= 0) {
                    material.setParametersTextureOnly(device);
                } else {
                    material.setParameters(device);
                }

                if (lightMaskChanged) {
                    this.dispatchDirectLights(sortedLights[LIGHTTYPE_DIRECTIONAL], lightMask, camera);
                }

                this.alphaTestId.setValue(material.alphaTest);

                device.setBlendState(material.blendState);
                device.setDepthState(material.depthState);
                device.setAlphaToCoverage(material.alphaToCoverage);
            }

            DebugGraphics.pushGpuMarker(device, `Node: ${drawCall.node.name}, Material: ${material.name}`);

            this.setupCullModeAndFrontFace(camera._cullFaces, flipFactor, drawCall);

            const stencilFront = drawCall.stencilFront ?? material.stencilFront;
            const stencilBack = drawCall.stencilBack ?? material.stencilBack;
            device.setStencilState(stencilFront, stencilBack);

            // Uniforms II: meshInstance overrides
            drawCall.setParameters(device, passFlag);

            // mesh ID - used by the picker
            device.scope.resolve('meshInstanceId').setValue(drawCall.id);

            // Set materialIndex for global material storage buffer access
            if (this.materialStorageBufferEnabled && material._materialSlot >= 0) {
                this.materialIndexId.setValue(material._materialSlot);
            }

            const mesh = drawCall.mesh;
            this.setVertexBuffers(device, mesh);
            this.setMorphing(device, drawCall.morphInstance);
            this.setSkinning(device, drawCall);

            const instancingData = drawCall.instancingData;
            if (instancingData) {
                device.setVertexBuffer(instancingData.vertexBuffer);
            }

            this.setMeshInstanceMatrices(drawCall, true);

            const indirectData = drawCall.getDrawCommands(camera);

            this.setupMeshUniformBuffers(shaderInstance);

            const style = drawCall.renderStyle;
            const indexBuffer = mesh.indexBuffer[style];

            drawCallback?.(drawCall, i);

            if (viewList) {
                for (let v = 0; v < viewList.length; v++) {
                    const view = viewList[v];

                    device.setViewport(view.viewport.x, view.viewport.y, view.viewport.z, view.viewport.w);

                    if (device.supportsUniformBuffers) {

                        const viewBindGroup = viewBindGroups[v];
                        device.setBindGroup(BINDGROUP_VIEW, viewBindGroup);

                    } else {

                        this.setupViewUniforms(view, v);
                    }

                    const first = v === 0;
                    const last = v === viewList.length - 1;
                    device.draw(mesh.primitive[style], indexBuffer, instancingData?.count, indirectData, first, last);

                    this._forwardDrawCalls++;
                }
            } else {
                device.draw(mesh.primitive[style], indexBuffer, instancingData?.count, indirectData);

                this._forwardDrawCalls++;
            }

            // Unset meshInstance overrides back to material values if next draw call will use the same material
            if (i < preparedCallsCount - 1 && !preparedCalls.isNewMaterial[i + 1]) {
                material.setParameters(device, drawCall.parameters);
            }

            DebugGraphics.popGpuMarker(device);
        }
    }

    /**
     * Set up indirect draw commands for mesh instances that use the global transform buffer,
     * encoding the transform slot index in the firstInstance field.
     *
     * @param {import('../camera.js').Camera} camera - The camera.
     * @param {import('../mesh-instance.js').MeshInstance[]} drawCalls - The draw calls.
     * @ignore
     */
    setupGlobalTransformIndirectDraws(camera, drawCalls, transparent = false) {
        const gtb = this.globalTransformBuffer;
        if (!gtb) return;

        const device = this.device;
        const indirectBuffer = device.indirectDrawBuffer;
        const tempArgs = _indirectArgs;
        const gpuDriven = this.gpuDrivenEnabled;

        // track contiguous range of indirect slots for GPU frustum culling
        const startSlot = device._indirectDrawNextIndex;
        let count = 0;

        for (let i = 0; i < drawCalls.length; i++) {
            const drawCall = drawCalls[i];
            const slot = drawCall._globalTransformSlot;
            if (slot < 0) continue;

            // already has user-configured indirect/multi-draw — don't overwrite
            if (drawCall.getDrawCommands(null)) continue;

            // GPU_DRIVEN eligible draws use the compacted buffer — skip indirect slot allocation
            if (drawCall._gpuDrivenDrawId >= 0 &&
                !(drawCall._shaderDefs & GPU_DRIVEN_EXCLUDE_DEFS) &&
                !transparent) {
                continue;
            }

            // allocate a slot in the device's shared indirect draw buffer
            const indirectSlot = device.getIndirectDrawSlot();

            // For GPU-driven draws with geometry pool entries, use pool offsets
            const poolEntry = (gpuDriven && !transparent) ? drawCall._geometryPoolEntry : null;
            if (poolEntry) {
                // write draw args using geometry pool offsets
                tempArgs[0] = poolEntry.indexCount;
                tempArgs[1] = 1;
                tempArgs[2] = poolEntry.firstIndex;
                tempArgs[3] = poolEntry.baseVertex;
                // GPU_DRIVEN eligible: firstInstance = drawId (DIB index) for DrawInstance lookup
                // Legacy: firstInstance = transform slot for direct globalTransforms lookup
                if (drawCall._gpuDrivenDrawId >= 0 &&
                    !(drawCall._shaderDefs & GPU_DRIVEN_EXCLUDE_DEFS)) {
                    tempArgs[4] = drawCall._gpuDrivenDrawId;
                } else {
                    tempArgs[4] = slot;
                }
            } else {
                // write draw args using original mesh primitive offsets
                const prim = drawCall.mesh.primitive[drawCall.renderStyle];
                tempArgs[0] = prim.count;
                tempArgs[1] = 1;
                tempArgs[2] = prim.base;
                tempArgs[3] = prim.baseVertex ?? 0;
                tempArgs[4] = slot; // firstInstance encodes the transform slot
            }
            indirectBuffer.write(indirectSlot * 20, tempArgs, 0, 5);

            // wire the mesh instance to use this indirect slot (null = all cameras)
            drawCall.setIndirect(null, indirectSlot);
            count++;
        }

        // pass indirect slot range to GPU frustum culler
        const culler = this.gpuFrustumCuller;
        if (culler) {
            culler.indirectStartSlot = startSlot;
            culler.indirectDrawCount = count;
        }
    }

    renderForward(camera, renderTarget, allDrawCalls, sortedLights, pass, drawCallback, layer, flipFaces, viewBindGroups, transparent = false) {

        // #if _PROFILER
        const forwardStartTime = now();
        // #endif

        // GPU-driven rendering requires the material storage buffer system
        if (this.gpuDrivenEnabled) {
            this.materialStorageBufferEnabled = true;
        }

        // sync flags to scene for shader options
        this.scene._materialStorageBufferEnabled = this.materialStorageBufferEnabled;
        this.scene._textureArrayBatchingEnabled = this.textureArrayBatchingEnabled;

        // DEBUG: log rendering flags once
        if (!this._debugLoggedFlags) {
            this._debugLoggedFlags = true;
            console.log('[TexArrayDebug] renderForward flags:', {
                gpuDrivenEnabled: this.gpuDrivenEnabled,
                materialStorageBufferEnabled: this.materialStorageBufferEnabled,
                textureArrayBatchingEnabled: this.textureArrayBatchingEnabled,
                hasTextureArrayManager: !!this.textureArrayManager
            });
        }

        // For GPU-driven mode: register eligible meshes in the geometry pool
        if (this.gpuDrivenEnabled && this.geometryPool) {
            for (let i = 0; i < allDrawCalls.length; i++) {
                allDrawCalls[i].ensureGeometryPoolEntry(this.geometryPool);
            }
        }

        // upload all world transforms to the global GPU buffer (single writeBuffer)
        this.updateGlobalTransforms(allDrawCalls);

        // set up indirect draw with firstInstance = globalTransformSlot for eligible draw calls
        this.setupGlobalTransformIndirectDraws(camera, allDrawCalls, transparent);

        // run first pass over draw calls and handle material / shader updates
        const preparedCalls = this.renderForwardPrepareMaterials(camera, renderTarget, allDrawCalls, sortedLights, layer, pass);

        // Upload material storage buffer AFTER packing (packToStorageBuffer runs inside prepareMaterials)
        const msb = this.materialStorageBuffer;
        if (msb && msb.dirty) {
            msb.upload();
            // Re-bind scope in case MSB resized (creates new StorageBuffer)
            if (this.globalMaterialsId) {
                this.globalMaterialsId.setValue(msb.storageBuffer);
            }
            // Re-update view bind groups so they pick up the latest globalMaterials buffer reference.
            // This is required when MSB resizes (new StorageBuffer object) after setupViewUniformBuffers
            // already captured the old reference.
            if (viewBindGroups) {
                for (let i = 0; i < viewBindGroups.length; i++) {
                    viewBindGroups[i].update();
                }
            }
        }

        // XR multiview uses setViewport per view which is incompatible with render bundles
        const hasXR = camera.xr?.session && camera.xr.views.list.length > 0;
        if (this.gpuDrivenEnabled && !drawCallback && !hasXR) {
            // GPU-driven path: merged geometry, compute culling, compacted indirect draws
            this.renderForwardGpuDriven(camera, renderTarget, preparedCalls, sortedLights, pass, flipFaces, viewBindGroups, transparent);
        } else if (this.renderBundlesEnabled && !drawCallback && !hasXR) {
            // bundle-accelerated path: group eligible draw calls and replay cached bundles
            this.renderForwardBundled(camera, renderTarget, preparedCalls, sortedLights, pass, flipFaces, viewBindGroups, transparent);
        } else {
            // legacy per-draw-call path
            this.renderForwardInternal(camera, preparedCalls, sortedLights, pass, drawCallback, flipFaces, viewBindGroups);
        }

        _drawCallList.clear();

        // #if _PROFILER
        this._forwardTime += now() - forwardStartTime;
        // #endif
    }

    /**
     * Bundle-accelerated rendering path.  Groups eligible draw calls by pipeline state and
     * replays cached GPURenderBundles.  Non-bundleable draw calls (skinned, morphed) fall
     * through to the standard per-draw path.
     *
     * When transparent=true and materialStorageBufferEnabled=true, transparent draw calls are
     * also bundled with sort-order tracking to detect when bundles need re-recording.
     *
     * @param {Camera} camera - The camera.
     * @param {RenderTarget|undefined} renderTarget - The render target.
     * @param {object} preparedCalls - Prepared draw calls from renderForwardPrepareMaterials.
     * @param {object} sortedLights - Sorted lights arrays.
     * @param {number} pass - The shader pass.
     * @param {boolean} flipFaces - Whether to flip faces.
     * @param {BindGroup[]} viewBindGroups - View-level bind groups.
     * @param {boolean} [transparent=false] - Whether these are transparent draw calls.
     * @private
     */
    renderForwardBundled(camera, renderTarget, preparedCalls, sortedLights, pass, flipFaces, viewBindGroups, transparent = false) {
        const device = this.device;
        const bundleCache = this._bundleCache;
        const grouper = this._drawCallGrouper;

        // sync materialStorageBufferEnabled flag so grouper can skip material version checks
        grouper.materialStorageBufferEnabled = this.materialStorageBufferEnabled;

        // For transparent draws, check if sort order has changed and invalidate bundles if needed
        if (transparent) {
            grouper.checkTransparentSortChange(preparedCalls.drawCalls);
        }

        // group draw calls by pipeline state
        const groups = grouper.groupDrawCalls(preparedCalls);

        // determine render target for bundle descriptor
        const rt = renderTarget || device.backBuffer;
        /** @type {import('../../platform/graphics/webgpu/webgpu-render-target.js').WebgpuRenderTarget} */
        const wrt = rt.impl;

        // bundle descriptor must match the current render pass attachments
        const bundleDesc = wrt.getRenderBundleDescriptor();

        // collect bundles to execute and unbundled indices
        const bundlesToExecute = [];
        const unbundledIndices = [];

        for (const [key, group] of groups) {
            if (group.indices.length === 0) continue;

            let bundle = null;
            if (!group.needsRebundle) {
                bundle = bundleCache.get(key, pass);
            }

            if (!bundle) {
                // record a new bundle for this group
                device.startBundleEncoder(bundleDesc);

                // The view bind group was set on the pass encoder before bundle recording
                // started, but the bundle encoder has fresh state with no bind groups.
                // We must explicitly set it on the bundle encoder.
                if (device.supportsUniformBuffers) {
                    device.setBindGroup(BINDGROUP_VIEW, viewBindGroups[0]);
                }

                for (let g = 0; g < group.indices.length; g++) {
                    const idx = group.indices[g];
                    this._renderSingleDrawCall(device, preparedCalls, idx, camera, sortedLights, pass, flipFaces, viewBindGroups);
                }

                bundle = device.finishBundleEncoder();
                bundleCache.set(key, bundle, pass);
                group.needsRebundle = false;
            }

            bundlesToExecute.push(bundle);
        }

        // execute all cached bundles in one batch
        if (bundlesToExecute.length > 0) {
            device.executeBundles(bundlesToExecute);
        }

        // collect indices for non-bundleable draw calls (skinned, morphed, etc.)
        const { drawCalls } = preparedCalls;
        for (let i = 0; i < drawCalls.length; i++) {
            if (!DrawCallGrouper.isBundleable(drawCalls[i])) {
                unbundledIndices.push(i);
            }
        }

        // render non-bundleable draw calls via the legacy per-draw path
        if (unbundledIndices.length > 0) {

            // After executeBundles the render pass state is reset (pipeline, bind groups
            // are all unset).  Re-bind the view bind group so that subsequent individual
            // draw calls have the correct bind group format at slot 0.
            if (device.supportsUniformBuffers) {
                device.setBindGroup(BINDGROUP_VIEW, viewBindGroups[0]);
            }

            for (let u = 0; u < unbundledIndices.length; u++) {
                const idx = unbundledIndices[u];
                this._renderSingleDrawCall(device, preparedCalls, idx, camera, sortedLights, pass, flipFaces, viewBindGroups);
            }
        }
    }

    /**
     * GPU-driven rendering path. Uses merged geometry buffers (GeometryPool) and the existing
     * indirect draw + GPU frustum culler. Draws are grouped by GeometryBatch (vertex format),
     * so vertex/index buffers are only set once per batch. Within each batch, draws are grouped
     * by material to minimize pipeline state changes.
     *
     * The existing GPU frustum culler zeros instanceCount on culled indirect draw entries,
     * making them no-ops without needing draw compaction.
     *
     * Non-eligible draws (skinned, morphed, instanced) fall through to per-draw path.
     *
     * @param {Camera} camera - The camera.
     * @param {RenderTarget|undefined} renderTarget - The render target.
     * @param {object} preparedCalls - Prepared draw calls from renderForwardPrepareMaterials.
     * @param {object} sortedLights - Sorted lights arrays.
     * @param {number} pass - The shader pass.
     * @param {boolean} flipFaces - Whether to flip faces.
     * @param {BindGroup[]} viewBindGroups - View-level bind groups.
     * @param {boolean} [transparent] - Whether these are transparent draw calls.
     * @private
     */
    renderForwardGpuDriven(camera, renderTarget, preparedCalls, sortedLights, pass, flipFaces, viewBindGroups, transparent = false) {
        const device = this.device;
        const pool = this.geometryPool;
        const compactor = this.gpuDrawCompactor;
        const dib = this.drawInstanceBuffer;
        const pipelineGroups = this._pipelineGroups;
        const { drawCalls, shaderInstances, lightMaskChanged } = preparedCalls;
        const flipFactor = flipFaces ? -1 : 1;

        // -- Categorize legacy vs GPU-driven --
        const legacyIndices = [];

        for (let i = 0; i < drawCalls.length; i++) {
            const drawCall = drawCalls[i];

            if (transparent) {
                legacyIndices.push(i);
                continue;
            }

            const entry = drawCall._geometryPoolEntry;
            if (entry && !(drawCall._shaderDefs & GPU_DRIVEN_EXCLUDE_DEFS) &&
                drawCall._globalTransformSlot >= 0 &&
                drawCall._gpuDrivenDrawId >= 0) {
                // GPU-driven: per-group compacted loop handles these
            } else {
                legacyIndices.push(i);
            }
        }

        // -- Legacy draws FIRST --
        if (legacyIndices.length > 0) {
            if (device.supportsUniformBuffers) {
                device.setBindGroup(BINDGROUP_VIEW, viewBindGroups[0]);
            }
            for (let u = 0; u < legacyIndices.length; u++) {
                this._renderSingleDrawCall(device, preparedCalls, legacyIndices[u],
                    camera, sortedLights, pass, flipFaces, viewBindGroups);
            }
        }

        // -- Per-group compacted indirect draws --
        if (pipelineGroups && pipelineGroups.length > 0 && compactor && dib && dib.count > 0) {

            if (device.supportsUniformBuffers) {
                device.setBindGroup(BINDGROUP_VIEW, viewBindGroups[0]);
            }

            // Build drawCall -> index map for O(1) lookup (replaces indexOf)
            const drawToIdx = new Map();
            for (let i = 0; i < drawCalls.length; i++) {
                drawToIdx.set(drawCalls[i], i);
            }

            const groupBaseOffsets = compactor._groupBaseOffsets;
            const compactedGpuBuffer = compactor.compactedDrawArgsBuffer.impl.buffer;

            for (let g = 0; g < pipelineGroups.length; g++) {
                const group = pipelineGroups[g];
                if (group.count === 0) continue;

                const firstDraw = group.draws[0];
                const material = firstDraw.material;
                const preparedIdx = drawToIdx.get(firstDraw) ?? -1;
                if (preparedIdx < 0) continue;
                const shaderInstance = shaderInstances[preparedIdx];
                if (!shaderInstance || shaderInstance.shader.failed || !shaderInstance.shader.ready) continue;

                const batch = pool.getBatch(group.batchId);
                if (!batch) continue;
                const ib = batch.indexBuffer;

                // Pipeline state (once per group)
                device.setShader(shaderInstance.shader, false);

                // Array-compatible group: array textures bound via mesh bind group scope,
                // per-material textures handled via SB layer index.
                // Only env textures and non-SB uniforms need binding.
                if (this.textureArrayBatchingEnabled && material._textureArrayCompatible) {
                    material.setParametersEnvOnly(device);

                    // Bind the correct texture array for this group's arrayIndex
                    const tam = this.textureArrayManager;
                    if (tam && this.globalDiffuseArrayId) {
                        const entry = material._diffuseArrayEntry;
                        const arrayIdx = entry ? entry.arrayIndex : 0;
                        const texArray = tam.getTextureArray(arrayIdx);
                        if (texArray) {
                            this.globalDiffuseArrayId.setValue(texArray);
                        }
                    }
                } else {
                    material.setParametersTextureOnly(device);
                }
                device.setBlendState(material.blendState);
                device.setDepthState(material.depthState);
                device.setAlphaToCoverage(material.alphaToCoverage);
                this.setupCullModeAndFrontFace(camera._cullFaces, flipFactor, firstDraw);
                device.setStencilState(
                    firstDraw.stencilFront ?? material.stencilFront,
                    firstDraw.stencilBack ?? material.stencilBack
                );
                if (lightMaskChanged[preparedIdx]) {
                    this.dispatchDirectLights(sortedLights[LIGHTTYPE_DIRECTIONAL], firstDraw.mask, camera);
                }
                this.setupMeshUniformBuffers(shaderInstance);

                // Pipeline resolve: device.draw() with numInstances=0 triggers
                // VB submit + pipeline creation/caching + setPipeline + setIndexBuffer
                // without actually drawing anything (drawIndexed with count 0 instances is a GPU no-op).
                device.setVertexBuffer(batch.vertexBuffer);
                const firstPrim = firstDraw.mesh.primitive[firstDraw.renderStyle];
                device.draw(firstPrim, ib, 0); // numInstances=0 -> pipeline resolved, no pixels drawn

                // Compacted indirect draws from GPU-compacted buffer
                const passEncoder = device.passEncoder;
                const baseOffset = groupBaseOffsets[g];

                for (let d = 0; d < group.count; d++) {
                    const indirectOffset = (baseOffset + d) * 20; // 5 x u32 = 20 bytes
                    if (ib) {
                        passEncoder.drawIndexedIndirect(compactedGpuBuffer, indirectOffset);
                    } else {
                        passEncoder.drawIndirect(compactedGpuBuffer, indirectOffset);
                    }
                }

                this._forwardDrawCalls += group.count;
            }
        }
    }

    /**
     * Render a single draw call at the given index in the prepared calls list.
     * Extracted from renderForwardInternal to allow reuse by both the legacy and bundle paths.
     *
     * @param {GraphicsDevice} device - The graphics device.
     * @param {object} preparedCalls - Prepared draw calls.
     * @param {number} i - Index into the prepared calls arrays.
     * @param {Camera} camera - The camera.
     * @param {object} sortedLights - Sorted lights.
     * @param {number} pass - The shader pass.
     * @param {boolean} flipFaces - Whether to flip faces.
     * @param {BindGroup[]} viewBindGroups - View-level bind groups.
     * @private
     */
    _renderSingleDrawCall(device, preparedCalls, i, camera, sortedLights, pass, flipFaces, viewBindGroups) {
        const passFlag = 1 << pass;
        const flipFactor = flipFaces ? -1 : 1;

        /** @type {MeshInstance} */
        const drawCall = preparedCalls.drawCalls[i];
        const newMaterial = preparedCalls.isNewMaterial[i];
        const lightMaskChanged = preparedCalls.lightMaskChanged[i];
        const shaderInstance = preparedCalls.shaderInstances[i];
        const material = drawCall.material;
        const lightMask = drawCall.mask;

        if (shaderInstance.shader.failed) return;

        if (newMaterial) {
            const asyncCompile = false;
            device.setShader(shaderInstance.shader, asyncCompile);
            if (this.materialStorageBufferEnabled && material._materialSlot >= 0) {
                material.setParametersTextureOnly(device);
            } else {
                material.setParameters(device);
            }

            if (lightMaskChanged) {
                this.dispatchDirectLights(sortedLights[LIGHTTYPE_DIRECTIONAL], lightMask, camera);
            }

            this.alphaTestId.setValue(material.alphaTest);
            device.setBlendState(material.blendState);
            device.setDepthState(material.depthState);
            device.setAlphaToCoverage(material.alphaToCoverage);
        }

        DebugGraphics.pushGpuMarker(device, `Node: ${drawCall.node.name}, Material: ${material.name}`);

        this.setupCullModeAndFrontFace(camera._cullFaces, flipFactor, drawCall);

        const stencilFront = drawCall.stencilFront ?? material.stencilFront;
        const stencilBack = drawCall.stencilBack ?? material.stencilBack;
        device.setStencilState(stencilFront, stencilBack);

        drawCall.setParameters(device, passFlag);
        device.scope.resolve('meshInstanceId').setValue(drawCall.id);

        // Set materialIndex for global material storage buffer access
        if (this.materialStorageBufferEnabled && material._materialSlot >= 0) {
            this.materialIndexId.setValue(material._materialSlot);
        }

        const mesh = drawCall.mesh;
        this.setVertexBuffers(device, mesh);
        this.setMorphing(device, drawCall.morphInstance);
        this.setSkinning(device, drawCall);

        const instancingData = drawCall.instancingData;
        if (instancingData) {
            device.setVertexBuffer(instancingData.vertexBuffer);
        }

        this.setMeshInstanceMatrices(drawCall, true);

        const indirectData = drawCall.getDrawCommands(camera);
        this.setupMeshUniformBuffers(shaderInstance);

        const style = drawCall.renderStyle;
        const indexBuffer = mesh.indexBuffer[style];

        // multiview XR rendering
        const viewList = camera.xr?.session && camera.xr.views.list.length ? camera.xr.views.list : null;

        if (viewList) {
            for (let v = 0; v < viewList.length; v++) {
                const view = viewList[v];
                device.setViewport(view.viewport.x, view.viewport.y, view.viewport.z, view.viewport.w);

                if (device.supportsUniformBuffers) {
                    const viewBindGroup = viewBindGroups[v];
                    device.setBindGroup(BINDGROUP_VIEW, viewBindGroup);
                } else {
                    this.setupViewUniforms(view, v);
                }

                const first = v === 0;
                const last = v === viewList.length - 1;
                device.draw(mesh.primitive[style], indexBuffer, instancingData?.count, indirectData, first, last);
                this._forwardDrawCalls++;
            }
        } else {
            device.draw(mesh.primitive[style], indexBuffer, instancingData?.count, indirectData);
            this._forwardDrawCalls++;
        }

        // Unset meshInstance overrides back to material values if next draw call will use the same material
        const preparedCallsCount = preparedCalls.drawCalls.length;
        if (i < preparedCallsCount - 1 && !preparedCalls.isNewMaterial[i + 1]) {
            material.setParameters(device, drawCall.parameters);
        }

        DebugGraphics.popGpuMarker(device);
    }

    /**
     * Forward render mesh instances on a specified layer, using a camera and a render target.
     * Shaders used are based on the shaderPass provided, with optional clustered lighting support.
     *
     * @param {Camera} camera - The camera.
     * @param {RenderTarget|undefined} renderTarget - The render target.
     * @param {Layer} layer - The layer.
     * @param {boolean} transparent - True if transparent sublayer should be rendered, opaque
     * otherwise.
     * @param {number} shaderPass - A type of shader to use during rendering.
     * @param {BindGroup[]} viewBindGroups - An array storing the view level bing groups (can be
     * empty array, and this function populates if per view).
     * @param {object} [options] - Object for passing optional arguments.
     * @param {boolean} [options.clearColor] - True if the color buffer should be cleared.
     * @param {boolean} [options.clearDepth] - True if the depth buffer should be cleared.
     * @param {boolean} [options.clearStencil] - True if the stencil buffer should be cleared.
     * @param {WorldClusters} [options.lightClusters] - The world clusters object to be used for
     * clustered lighting.
     * @param {MeshInstance[]} [options.meshInstances] - The mesh instances to be rendered. Use
     * when layer is not provided.
     * @param {object} [options.splitLights] - The split lights to be used for clustered lighting.
     */
    renderForwardLayer(camera, renderTarget, layer, transparent, shaderPass, viewBindGroups, options = {}) {

        const { scene, device } = this;

        this.setupViewport(camera, renderTarget);

        let visible, splitLights;
        if (layer) {
            // #if _PROFILER
            const sortTime = now();
            // #endif

            layer.sortVisible(camera, transparent);

            // #if _PROFILER
            this._sortTime += now() - sortTime;
            // #endif

            const culledInstances = layer.getCulledInstances(camera);
            visible = transparent ? culledInstances.transparent : culledInstances.opaque;

            // add debug mesh instances to visible list
            scene.immediate.onPreRenderLayer(layer, visible, transparent);

            // set up layer uniforms
            if (layer.requiresLightCube) {
                this.lightCube.update(scene.ambientLight, layer._lights);
                this.constantLightCube.setValue(this.lightCube.colors);
            }

            splitLights = layer.splitLights;

        } else {
            visible = options.meshInstances;
            splitLights = options.splitLights ?? _noLights;
        }

        Debug.assert(visible, 'Either layer or options.meshInstances must be provided');

        // activate cluster lighting uniforms
        if (this.worldClustersAllocator._gpuCluster && this.scene._gpuClusterLightingEnabled) {
            this.worldClustersAllocator.activateGpuClusters();
        } else {
            const lightClusters = options.lightClusters ?? this.worldClustersAllocator.empty;
            lightClusters.activate();

            // debug rendering of clusters (CPU path only)
            if (layer) {
                if (!this.clustersDebugRendered && scene.lighting.debugLayer === layer.id) {
                    this.clustersDebugRendered = true;
                    WorldClustersDebug.render(lightClusters, this.scene);
                }
            }
        }

        // Set the not very clever global variable which is only useful when there's just one camera
        scene._activeCamera = camera;

        const fogParams = camera.fogParams ?? this.scene.fog;
        this.setFogConstants(fogParams);

        const viewList = this.setCameraUniforms(camera, renderTarget);
        if (device.supportsUniformBuffers) {
            this.setupViewUniformBuffers(viewBindGroups, this.viewUniformFormat, this.viewBindGroupFormat, viewList);
        }

        // clearing - do it after the view bind groups are set up, to avoid overriding those
        const clearColor = options.clearColor ?? false;
        const clearDepth = options.clearDepth ?? false;
        const clearStencil = options.clearStencil ?? false;
        if (clearColor || clearDepth || clearStencil) {
            this.clear(camera, clearColor, clearDepth, clearStencil);
        }

        // enable flip faces if either the camera has _flipFaces enabled or the render target has flipY enabled
        const flipFaces = !!(camera._flipFaces ^ renderTarget?.flipY);

        const forwardDrawCalls = this._forwardDrawCalls;
        this.renderForward(camera,
            renderTarget,
            visible,
            splitLights,
            shaderPass,
            null,
            layer,
            flipFaces,
            viewBindGroups,
            transparent);

        if (layer) {
            layer._forwardDrawCalls += this._forwardDrawCalls - forwardDrawCalls;
        }
    }

    setFogConstants(fogParams) {

        if (fogParams.type !== FOG_NONE) {

            // color in linear space
            tmpColor.linear(fogParams.color);
            const fogUniform = this.fogColor;
            fogUniform[0] = tmpColor.r;
            fogUniform[1] = tmpColor.g;
            fogUniform[2] = tmpColor.b;
            this.fogColorId.setValue(fogUniform);

            if (fogParams.type === FOG_LINEAR) {
                this.fogStartId.setValue(fogParams.start);
                this.fogEndId.setValue(fogParams.end);
            } else {
                this.fogDensityId.setValue(fogParams.density);
            }
        }
    }

    setSceneConstants() {
        const scene = this.scene;

        // Set up ambient/exposure
        this.dispatchGlobalLights(scene);

        // Set up screen size // should be RT size?
        const device = this.device;
        this._screenSize[0] = device.width;
        this._screenSize[1] = device.height;
        this._screenSize[2] = 1 / device.width;
        this._screenSize[3] = 1 / device.height;
        this.screenSizeId.setValue(this._screenSize);

        this.pcssDiskSamplesId.setValue(this.pcssDiskSamples);
        this.pcssSphereSamplesId.setValue(this.pcssSphereSamples);
    }

    /**
     * Builds a frame graph for the rendering of the whole frame.
     *
     * @param {FrameGraph} frameGraph - The frame-graph that is built.
     * @param {LayerComposition} layerComposition - The layer composition used to build the frame
     * graph.
     * @ignore
     */
    buildFrameGraph(frameGraph, layerComposition) {

        const scene = this.scene;
        frameGraph.reset();

        // clustered lighting passes
        const { shadowsEnabled, cookiesEnabled } = scene.lighting;
        this._renderPassUpdateClustered.update(frameGraph, shadowsEnabled, cookiesEnabled, this.lights, this.localLights);
        frameGraph.addRenderPass(this._renderPassUpdateClustered);

        // main passes
        let startIndex = 0;
        let newStart = true;
        let renderTarget = null;
        const renderActions = layerComposition._renderActions;

        for (let i = startIndex; i < renderActions.length; i++) {

            const renderAction = renderActions[i];
            const { layer, camera } = renderAction;

            if (renderAction.useCameraPasses)  {

                // schedule render passes from the camera
                camera.camera.renderPasses.forEach((renderPass) => {
                    frameGraph.addRenderPass(renderPass);
                });

            } else {

                const isDepthLayer = layer.id === LAYERID_DEPTH;
                const isGrabPass = isDepthLayer && (camera.renderSceneColorMap || camera.renderSceneDepthMap);

                // start of block of render actions rendering to the same render target
                if (newStart) {
                    newStart = false;
                    startIndex = i;
                    renderTarget = renderAction.renderTarget;
                }

                // info about the next render action
                const nextRenderAction = renderActions[i + 1];
                const isNextLayerDepth = nextRenderAction ? (!nextRenderAction.useCameraPasses && nextRenderAction.layer.id === LAYERID_DEPTH) : false;
                const isNextLayerGrabPass = isNextLayerDepth && (camera.renderSceneColorMap || camera.renderSceneDepthMap);
                const nextNeedDirShadows = nextRenderAction ? (nextRenderAction.firstCameraUse && this.cameraDirShadowLights.has(nextRenderAction.camera.camera)) : false;

                // end of the block using the same render target if the next render action uses a different render target, or needs directional shadows
                // rendered before it or similar or needs other pass before it.
                if (!nextRenderAction || nextRenderAction.renderTarget !== renderTarget ||
                    nextNeedDirShadows || isNextLayerGrabPass || isGrabPass) {

                    // render the render actions in the range
                    const isDepthOnly = isDepthLayer && startIndex === i;
                    if (!isDepthOnly) {
                        this.addMainRenderPass(frameGraph, layerComposition, renderTarget, startIndex, i);
                    }

                    // depth layer triggers grab passes if enabled
                    if (isDepthLayer) {

                        if (camera.renderSceneColorMap) {
                            const colorGrabPass = camera.camera.renderPassColorGrab;
                            colorGrabPass.source = camera.renderTarget;
                            frameGraph.addRenderPass(colorGrabPass);
                        }

                        if (camera.renderSceneDepthMap) {
                            frameGraph.addRenderPass(camera.camera.renderPassDepthGrab);
                        }
                    }

                    newStart = true;
                }
            }
        }
    }

    /**
     * @param {FrameGraph} frameGraph - The frame graph.
     * @param {LayerComposition} layerComposition - The layer composition.
     */
    addMainRenderPass(frameGraph, layerComposition, renderTarget, startIndex, endIndex) {

        const renderPass = new RenderPassForward(this.device, layerComposition, this.scene, this);
        renderPass.init(renderTarget);

        const renderActions = layerComposition._renderActions;
        for (let i = startIndex; i <= endIndex; i++) {
            renderPass.addRenderAction(renderActions[i]);
        }

        frameGraph.addRenderPass(renderPass);
    }

    /**
     * @param {LayerComposition} comp - The layer composition.
     */
    update(comp) {

        this.frameUpdate();
        this.shadowRenderer.frameUpdate();

        // update the skybox, since this might change _meshInstances
        this.scene._updateSkyMesh();

        // update layer composition
        this.updateLayerComposition(comp);

        this.collectLights(comp);

        // Single per-frame calculations
        this.beginFrame(comp);
        this.setSceneConstants();

        // update gsplat director
        this.gsplatDirector?.update(comp);

        // visibility culling of lights, meshInstances, shadows casters
        // after this the scene culling is done and script callbacks can be called to report which objects are visible
        this.cullComposition(comp);

        // GPU update for visible objects requiring one
        this.gpuUpdate(this.processingMeshInstances);
    }
}

export { ForwardRenderer };
