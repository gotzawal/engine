import { Vec3 } from '../../core/math/vec3.js';
import { Mat4 } from '../../core/math/mat4.js';
import {
    PIXELFORMAT_RGBA8,
    SEMANTIC_POSITION
} from '../../platform/graphics/constants.js';
import { RenderTarget } from '../../platform/graphics/render-target.js';
import { ShaderUtils } from '../shader-lib/shader-utils.js';
import { ShaderChunks } from '../shader-lib/shader-chunks.js';
import { Vec2 } from '../../core/math/vec2.js';
import { RenderPass } from '../../platform/graphics/render-pass.js';
import { QuadRender } from '../graphics/quad-render.js';

const vertexWGSL = /* wgsl */`
    attribute vertex_position: vec2f;
    @vertex
    fn vertexMain(input: VertexInput) -> VertexOutput {
        var output: VertexOutput;
        output.position = vec4f(vertex_position, 0.0, 1.0);
        return output;
    }
`;

const fragmentWGSL = /* wgsl */`
    #include "gsplatEvalSHVS"

    // takes a normalized 3-component value, convert to (11, 11, 10) bit range and
    // then package into RGBA8
    fn packRgb(v: vec3f) -> vec4f {
        let vb = vec3u(clamp(v, vec3f(0.0), vec3f(1.0)) * vec3f(2047.0, 2047.0, 1023.0));
        let bits = dot(vb, vec3u(1 << 21, 1 << 10, 1));
        return vec4f((vec4u(bits) >> vec4u(24, 16, 8, 0)) & vec4u(0xff)) / vec4f(255.0);
    }

    uniform dir: vec3f;
    uniform shN_mins: f32;
    uniform shN_maxs: f32;

    var centroids: texture_2d<f32>;

    @fragment
    fn fragmentMain(input: FragmentInput) -> FragmentOutput {
        var output: FragmentOutput;

        var uv = vec2i(input.position.xy) * vec2i(SH_COEFFS, 1);
        var coefficients: array<vec3f, SH_COEFFS>;

        // read coefficients
        for (var i: i32 = 0; i < SH_COEFFS; i++) {
            let s: vec3f = textureLoad(centroids, vec2i(uv.x + i, uv.y), 0).xyz;
            coefficients[i] = mix(vec3f(uniform.shN_mins), vec3f(uniform.shN_maxs), s);
        }

        // evaluate
        output.color = packRgb(evalSH(&coefficients, uniform.dir) * 0.25 + 0.5);

        return output;
    }
`;

const gsplatSogColorWGSL = /* wgsl */`
    var sh0: texture_2d<f32>;
    var sh_labels: texture_2d<f32>;
    var sh_result: texture_2d<f32>;

    uniform sh0_mins: vec4f;
    uniform sh0_maxs: vec4f;

    const SH_C0: f32 = 0.28209479177387814;

    // unpack 11, 11, 10 normalized value from rgba8 texture sample
    fn unpackRgb(v: vec4f) -> vec3f {
        let bits = dot(vec4u(v * 255.0), vec4u(1u << 24, 1u << 16, 1u << 8, 1u));
        let vb = (vec3u(bits) >> vec3u(21, 10, 0)) & vec3u(0x7ffu, 0x7ffu, 0x3ffu);
        return vec3f(vb) / vec3f(2047.0, 2047.0, 1023.0);
    }

    fn getColor(source: ptr<function, SplatSource>) -> vec4f {
        // sample base color
        let baseSample: vec4f = mix(uniform.sh0_mins, uniform.sh0_maxs, textureLoad(sh0, source.uv, 0));
        let base = vec4f(vec3f(0.5) + baseSample.xyz * SH_C0, 1.0 / (1.0 + exp(-baseSample.w)));

        // extract spherical harmonics palette index
        let labelSample: vec2i = vec2i(textureLoad(sh_labels, source.uv, 0).xy * 255.0);
        let n = labelSample.x + labelSample.y * 256;

        let shSample: vec4f = textureLoad(sh_result, vec2i(n % 64, n / 64), 0);
        let sh: vec3f = (unpackRgb(shSample) - vec3f(0.5)) * 4.0;

        return vec4f(base.xyz + sh, base.w);
    }
`;

const resolve = (scope, values) => {
    for (const key in values) {
        scope.resolve(key).setValue(values[key]);
    }
};

class CustomRenderPass extends RenderPass {
    /**
     * @type {() => void | null}
     */
    executeCallback = null;

    execute() {
        this.executeCallback?.();
    }
}

const invModelMat = new Mat4();
const dir = new Vec3();

class GSplatResolveSH {
    prevDir = new Vec3();

    updateMode = 'enable'; // 'enable', 'disable', 'always'

    constructor(device, gsplatInstance) {
        this.device = device;
        this.gsplatInstance = gsplatInstance;

        const { resource } = gsplatInstance;

        const includes = new Map(ShaderChunks.get(device, 'wgsl'));

        this.shader = ShaderUtils.createShader(device, {
            uniqueName: 'gsplatResolveSH',
            vertexWGSL,
            fragmentWGSL,
            vertexIncludes: includes,
            fragmentIncludes: includes,
            fragmentDefines: new Map([
                ['SH_BANDS', resource.gsplatData.shBands.toString()]
            ]),
            attributes: {
                vertex_position: SEMANTIC_POSITION
            }
        });

        this.texture = resource.streams.createTexture('centroids', PIXELFORMAT_RGBA8, new Vec2(64, 1024));
        this.renderTarget = new RenderTarget({
            colorBuffer: this.texture,
            depth: false
        });

        this.renderPass = new CustomRenderPass(device);
        this.renderPass.init(this.renderTarget, {});
        this.renderPass.colorOps.clear = true;
        this.quadRender = new QuadRender(this.shader);

        const { material } = gsplatInstance;
        material.setDefine('SH_BANDS', '0');

        const { shaderChunks } = material;
        shaderChunks.wgsl.set('gsplatSogColorVS', gsplatSogColorWGSL);

        material.update();

        device.scope.resolve('sh_result').setValue(this.texture);
    }

    destroy() {
        const { gsplatInstance } = this;

        const { material } = gsplatInstance;
        material.setDefine('SH_BANDS', gsplatInstance.resource.gsplatData.shBands.toString());

        const { shaderChunks } = material;
        shaderChunks.glsl.delete('gsplatSogColorVS');
        shaderChunks.wgsl.delete('gsplatSogColorVS');

        material.update();

        this.quadRender.destroy();
        this.renderPass.destroy();
        this.renderTarget.destroy();
        this.texture.destroy();
        this.shader.destroy();
    }

    render(camera, modelMat) {
        const { prevDir, updateMode } = this;

        // disabled
        if (updateMode === 'disable') {
            return;
        }

        // calculate camera Z in model space
        invModelMat.invert(modelMat);
        invModelMat.transformVector(camera.forward, dir);

        // if direction hasn't changed early out
        dir.normalize();
        if (updateMode === 'enable' && dir.equalsApprox(prevDir, 1e-3)) {
            return;
        }
        prevDir.copy(dir);

        const execute = () => {
            const { device } = this;
            const { sh_centroids, meta } = this.gsplatInstance.resource.gsplatData;

            resolve(device.scope, {
                dir: dir.toArray(),
                centroids: sh_centroids,
                shN_mins: meta.shN.mins,
                shN_maxs: meta.shN.maxs
            });

            device.setDrawStates();

            this.quadRender.render();
        };

        this.renderPass.executeCallback = execute;
        this.renderPass.render();
    }
}

export { GSplatResolveSH };
