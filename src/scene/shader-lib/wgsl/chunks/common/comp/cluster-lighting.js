export default /* wgsl */`
struct ClusterConfig {
    numTilesX: u32,
    numTilesY: u32,
    numSlicesZ: u32,
    lightCount: u32,
    maxLightsPerCluster: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32
};

struct ClusterAABB {
    minBound: vec4f,
    maxBound: vec4f
};

// Compact light data for culling (position + range is sufficient for sphere-AABB test)
struct LightVolumeData {
    positionRange: vec4f,     // xyz = world-space position, w = range
    directionAngle: vec4f     // xyz = spot direction, w = cos(outerAngle), w==-2 means omni
};

struct LightGrid {
    offset: u32,
    count: u32
};

@group(0) @binding(0) var<uniform> config: ClusterConfig;
@group(0) @binding(1) var<storage, read> clusterAABBs: array<ClusterAABB>;
@group(0) @binding(2) var<storage, read> lightVolumes: array<LightVolumeData>;
@group(0) @binding(3) var<storage, read_write> lightGrid: array<LightGrid>;
@group(0) @binding(4) var<storage, read_write> lightIndices: array<u32>;
@group(0) @binding(5) var<storage, read_write> globalCounter: atomic<u32>;

// Shared memory for light data caching (batch of 64 lights per workgroup iteration)
const BATCH_SIZE: u32 = 64u;
var<workgroup> sharedLightPos: array<vec4f, 64>;   // xyz=pos, w=range
var<workgroup> sharedLightDir: array<vec4f, 64>;   // xyz=dir, w=cosAngle (-2=omni)

fn sphereAABBIntersect(center: vec3f, radius: f32, aabbMin: vec3f, aabbMax: vec3f) -> bool {
    // Find closest point on AABB to sphere center
    let closest = clamp(center, aabbMin, aabbMax);
    let d = center - closest;
    return dot(d, d) <= radius * radius;
}

fn spotConeAABBIntersect(lightPos: vec3f, lightDir: vec3f, cosAngle: f32, range: f32, aabbMin: vec3f, aabbMax: vec3f) -> bool {
    // Conservative test: first check sphere, then check cone
    // Sphere test with bounding sphere of the cone
    if (!sphereAABBIntersect(lightPos, range, aabbMin, aabbMax)) {
        return false;
    }

    // For spot lights, check if the AABB center is roughly within the cone direction
    // This is a conservative approximation - the full cone-AABB test is complex
    let aabbCenter = (aabbMin + aabbMax) * 0.5;
    let toCenter = normalize(aabbCenter - lightPos);
    let aabbRadius = length(aabbMax - aabbMin) * 0.5;
    let distToCenter = length(aabbCenter - lightPos);

    // Expand the cone angle to account for AABB size
    let sinExpand = aabbRadius / max(distToCenter, 0.001);
    let cosExpand = sqrt(max(1.0 - sinExpand * sinExpand, 0.0));
    let effectiveCos = cosAngle * cosExpand - sqrt(max(1.0 - cosAngle * cosAngle, 0.0)) * sinExpand;

    return dot(toCenter, lightDir) >= effectiveCos;
}

@compute @workgroup_size(128)
fn main(
    @builtin(global_invocation_id) gid: vec3u,
    @builtin(local_invocation_id) lid: vec3u
) {
    let clusterIndex = gid.x;
    let totalClusters = config.numTilesX * config.numTilesY * config.numSlicesZ;
    if (clusterIndex >= totalClusters) {
        return;
    }

    let aabb = clusterAABBs[clusterIndex];
    let aabbMin = aabb.minBound.xyz;
    let aabbMax = aabb.maxBound.xyz;

    var localCount: u32 = 0u;
    var localIndices: array<u32, 128>; // MAX_LIGHTS_PER_CLUSTER

    let numLights = config.lightCount;
    let numBatches = (numLights + BATCH_SIZE - 1u) / BATCH_SIZE;

    for (var batch: u32 = 0u; batch < numBatches; batch++) {
        // Cooperatively load lights into shared memory
        let loadIdx = batch * BATCH_SIZE + lid.x;
        if (lid.x < BATCH_SIZE && loadIdx < numLights) {
            sharedLightPos[lid.x] = lightVolumes[loadIdx].positionRange;
            sharedLightDir[lid.x] = lightVolumes[loadIdx].directionAngle;
        }
        workgroupBarrier();

        // Test each light in this batch against the cluster AABB
        let batchSize = min(BATCH_SIZE, numLights - batch * BATCH_SIZE);
        for (var i: u32 = 0u; i < batchSize; i++) {
            if (localCount >= config.maxLightsPerCluster) {
                break;
            }

            let lightPos = sharedLightPos[i].xyz;
            let lightRange = sharedLightPos[i].w;
            let lightDir = sharedLightDir[i].xyz;
            let cosAngle = sharedLightDir[i].w;

            var intersects: bool;
            if (cosAngle <= -1.5) {
                // Omni light (cosAngle == -2.0): simple sphere-AABB test
                intersects = sphereAABBIntersect(lightPos, lightRange, aabbMin, aabbMax);
            } else {
                // Spot light: cone-AABB test
                intersects = spotConeAABBIntersect(lightPos, lightDir, cosAngle, lightRange, aabbMin, aabbMax);
            }

            if (intersects) {
                localIndices[localCount] = batch * BATCH_SIZE + i;
                localCount++;
            }
        }

        workgroupBarrier();
    }

    // Allocate space in the global light index list
    if (localCount > 0u) {
        let offset = atomicAdd(&globalCounter, localCount);
        lightGrid[clusterIndex] = LightGrid(offset, localCount);
        for (var i: u32 = 0u; i < localCount; i++) {
            lightIndices[offset + i] = localIndices[i];
        }
    } else {
        lightGrid[clusterIndex] = LightGrid(0u, 0u);
    }
}
`;
