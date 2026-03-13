// @config DESCRIPTION Demonstrates GPU-based frustum culling using a compute shader and indirect draw calls. Use the GPU Pipeline panel (in CONTROLS) to toggle GPU culling and indirect draw across all examples. This example creates up to 50,000 objects to stress-test the pipeline.
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

// Allow enough indirect draw slots for the max object count
device.maxIndirectDrawCount = 65536;

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
        farClip: 500
    });
    app.root.addChild(camera);

    // Pre-create shared meshes to avoid duplicating geometry
    const meshes = [
        pc.Mesh.fromGeometry(device, new pc.BoxGeometry()),
        pc.Mesh.fromGeometry(device, new pc.SphereGeometry({ latitudeBands: 8, longitudeBands: 8 })),
        pc.Mesh.fromGeometry(device, new pc.ConeGeometry({ capSegments: 8 })),
        pc.Mesh.fromGeometry(device, new pc.CylinderGeometry({ capSegments: 8 }))
    ];

    // Materials
    const materials = [];
    const colors = [
        new pc.Color(1, 0.3, 0.3),
        new pc.Color(0.3, 1, 0.3),
        new pc.Color(0.3, 0.3, 1),
        new pc.Color(1, 1, 0.3),
        new pc.Color(1, 0.3, 1),
        new pc.Color(0.3, 1, 1),
        new pc.Color(1, 0.6, 0.2),
        new pc.Color(0.5, 0.8, 0.3)
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

    // Create a large number of objects spread across a wide area
    const entities = [];
    const DEFAULT_COUNT = 10000;
    const spread = 300;

    function createObjects(count) {
        // Remove old objects
        for (const e of entities) {
            e.destroy();
        }
        entities.length = 0;

        for (let i = 0; i < count; i++) {
            const entity = new pc.Entity();

            // Use shared mesh via MeshInstance for efficiency
            const mesh = meshes[i % meshes.length];
            const material = materials[i % materials.length];
            const meshInstance = new pc.MeshInstance(mesh, material);

            entity.addComponent('render', {
                meshInstances: [meshInstance],
                type: 'asset'
            });

            // Spread objects in a large volume
            const x = (Math.random() - 0.5) * spread;
            const y = (Math.random() - 0.5) * spread * 0.3;
            const z = (Math.random() - 0.5) * spread;
            entity.setLocalPosition(x, y, z);

            const scale = 0.3 + Math.random() * 0.7;
            entity.setLocalScale(scale, scale, scale);

            app.root.addChild(entity);
            entities.push(entity);
        }
    }

    createObjects(DEFAULT_COUNT);

    // Set initial data values
    data.set('data', {
        objectCount: DEFAULT_COUNT
    });

    let prevObjectCount = DEFAULT_COUNT;

    // Update loop
    let angle = 0;
    app.on('update', (dt) => {
        angle += dt * 0.15;

        // Orbit camera
        const radius = 100;
        camera.setLocalPosition(
            radius * Math.sin(angle),
            40,
            radius * Math.cos(angle)
        );
        camera.lookAt(0, 0, 0);

        // Recreate objects if count changed
        const newCount = Math.round(data.get('data.objectCount') ?? DEFAULT_COUNT);
        if (newCount !== prevObjectCount) {
            createObjects(newCount);
            prevObjectCount = newCount;
        }
    });
});

export { app };
