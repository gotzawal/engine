// @config DESCRIPTION Demonstrates GPU-based frustum culling using a compute shader and indirect draw calls. Toggle GPU culling and indirect draw to compare CPU vs GPU rendering paths.
// @config WEBGPU_ONLY
import { data } from 'examples/observer';
import { deviceType, rootPath } from 'examples/utils';
import * as pc from 'playcanvas';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('application-canvas'));
window.focus();

const assets = {
    helipad: new pc.Asset(
        'helipad-env-atlas',
        'texture',
        { url: `${rootPath}/static/assets/cubemaps/helipad-env-atlas.png` },
        { type: pc.TEXTURETYPE_RGBP, mipmaps: false }
    )
};

const gfxOptions = {
    deviceTypes: [deviceType]
};

const device = await pc.createGraphicsDevice(canvas, gfxOptions);
device.maxPixelRatio = Math.min(window.devicePixelRatio, 2);

const createOptions = new pc.AppOptions();
createOptions.graphicsDevice = device;

createOptions.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem];
createOptions.resourceHandlers = [pc.TextureHandler];

const app = new pc.AppBase(canvas);
app.init(createOptions);

// Fill the window and auto-resize
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);

const resize = () => app.resizeCanvas();
window.addEventListener('resize', resize);
app.on('destroy', () => {
    window.removeEventListener('resize', resize);
});

const assetListLoader = new pc.AssetListLoader(Object.values(assets), app.assets);
assetListLoader.load(() => {
    app.start();

    // setup skydome
    app.scene.skyboxMip = 2;
    app.scene.exposure = 0.7;
    app.scene.envAtlas = assets.helipad.resource;

    // Camera
    const camera = new pc.Entity('Camera');
    camera.addComponent('camera', {
        toneMapping: pc.TONEMAP_ACES,
        farClip: 200
    });
    app.root.addChild(camera);
    camera.setLocalPosition(0, 15, 40);
    camera.lookAt(0, 0, 0);

    // Materials
    const materials = [];
    const colors = [
        new pc.Color(1, 0.3, 0.3),
        new pc.Color(0.3, 1, 0.3),
        new pc.Color(0.3, 0.3, 1),
        new pc.Color(1, 1, 0.3),
        new pc.Color(1, 0.3, 1),
        new pc.Color(0.3, 1, 1)
    ];
    for (const color of colors) {
        const mat = new pc.StandardMaterial();
        mat.diffuse = color;
        mat.gloss = 0.6;
        mat.metalness = 0.4;
        mat.useMetalness = true;
        mat.update();
        materials.push(mat);
    }

    // Create objects spread out so many are outside the frustum
    const entities = [];
    const objectCount = 200;
    const spread = 60;

    function createObjects(count) {
        // Remove old objects
        for (const e of entities) {
            e.destroy();
        }
        entities.length = 0;

        const types = ['box', 'sphere', 'cone', 'cylinder', 'capsule'];
        for (let i = 0; i < count; i++) {
            const entity = new pc.Entity(`Object_${i}`);
            entity.addComponent('render', {
                type: types[i % types.length],
                material: materials[i % materials.length]
            });

            // Spread objects in a large area so many are off-screen
            const x = (Math.random() - 0.5) * spread;
            const y = (Math.random() - 0.5) * spread * 0.5;
            const z = (Math.random() - 0.5) * spread;
            entity.setLocalPosition(x, y, z);

            const scale = 0.5 + Math.random() * 1.5;
            entity.setLocalScale(scale, scale, scale);

            app.root.addChild(entity);
            entities.push(entity);
        }
    }

    createObjects(objectCount);

    // Set initial data values
    data.set('data', {
        gpuCulling: true,
        indirectDraw: true,
        objectCount: objectCount
    });

    let prevObjectCount = objectCount;

    // Update loop
    let angle = 0;
    app.on('update', (dt) => {
        angle += dt * 0.3;

        // Orbit camera
        const radius = 40;
        camera.setLocalPosition(
            radius * Math.sin(angle),
            15,
            radius * Math.cos(angle)
        );
        camera.lookAt(0, 0, 0);

        // Apply UI toggles
        const renderer = app.renderer;
        if (renderer) {
            renderer.gpuCullingEnabled = data.get('data.gpuCulling') ?? true;
            renderer.indirectDrawEnabled = data.get('data.indirectDraw') ?? true;
        }

        // Recreate objects if count changed
        const newCount = Math.round(data.get('data.objectCount') ?? objectCount);
        if (newCount !== prevObjectCount) {
            createObjects(newCount);
            prevObjectCount = newCount;
        }
    });
});

export { app };
