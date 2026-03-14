export default /* wgsl */`
struct ClusterConfig {
    numTilesX: u32,
    numTilesY: u32,
    numSlicesZ: u32,
    tilePixelSize: u32,
    cameraNear: f32,
    cameraFar: f32,
    screenWidth: f32,
    screenHeight: f32,
    invProjectionMat: mat4x4f
};

struct ClusterAABB {
    minBound: vec4f,
    maxBound: vec4f
};

@group(0) @binding(0) var<uniform> config: ClusterConfig;
@group(0) @binding(1) var<storage, read_write> clusterAABBs: array<ClusterAABB>;

// Reconstruct view-space position from NDC coordinates and linear depth
fn ndcToView(ndcXY: vec2f, linearDepth: f32) -> vec3f {
    // Use inverse projection to unproject
    let clipPos = vec4f(ndcXY, 0.0, 1.0);
    var viewPos = config.invProjectionMat * clipPos;
    viewPos = viewPos / viewPos.w;
    // Scale the XY by depth ratio
    let ratio = linearDepth / -viewPos.z;
    return vec3f(viewPos.x * ratio, viewPos.y * ratio, -linearDepth);
}

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let clusterIndex = gid.x;
    let totalClusters = config.numTilesX * config.numTilesY * config.numSlicesZ;
    if (clusterIndex >= totalClusters) {
        return;
    }

    // Decompose flat index into 3D tile coordinates
    let tileX = clusterIndex % config.numTilesX;
    let tileY = (clusterIndex / config.numTilesX) % config.numTilesY;
    let sliceZ = clusterIndex / (config.numTilesX * config.numTilesY);

    // Screen-space tile boundaries in NDC [-1, 1]
    // X: tileX=0 is left of screen (NDC X = -1)
    let tilePx = f32(config.tilePixelSize);
    let minScreenX = f32(tileX) * tilePx / config.screenWidth * 2.0 - 1.0;
    let maxScreenX = f32(tileX + 1u) * tilePx / config.screenWidth * 2.0 - 1.0;
    // Y: tileY=0 is top of screen (NDC Y = +1) to match fragment shader's pcPosition.y convention
    let maxScreenY = 1.0 - f32(tileY) * tilePx / config.screenHeight * 2.0;
    let minScreenY = 1.0 - f32(tileY + 1u) * tilePx / config.screenHeight * 2.0;

    // Logarithmic depth slicing for near/far of this cluster
    let logRatio = log(config.cameraFar / config.cameraNear);
    let sliceNear = config.cameraNear * exp(logRatio * f32(sliceZ) / f32(config.numSlicesZ));
    let sliceFar = config.cameraNear * exp(logRatio * f32(sliceZ + 1u) / f32(config.numSlicesZ));

    // Compute view-space AABB from 8 corner points (4 screen corners × 2 depths)
    var minBound = vec3f(1e20);
    var maxBound = vec3f(-1e20);

    let cornersX = array<f32, 2>(minScreenX, maxScreenX);
    let cornersY = array<f32, 2>(minScreenY, maxScreenY);
    let depths = array<f32, 2>(sliceNear, sliceFar);

    for (var cx = 0u; cx < 2u; cx++) {
        for (var cy = 0u; cy < 2u; cy++) {
            for (var cd = 0u; cd < 2u; cd++) {
                let viewPos = ndcToView(vec2f(cornersX[cx], cornersY[cy]), depths[cd]);
                minBound = min(minBound, viewPos);
                maxBound = max(maxBound, viewPos);
            }
        }
    }

    clusterAABBs[clusterIndex].minBound = vec4f(minBound, 0.0);
    clusterAABBs[clusterIndex].maxBound = vec4f(maxBound, 0.0);
}
`;
