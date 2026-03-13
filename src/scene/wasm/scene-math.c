/**
 * WASM SIMD128 batch matrix operations for PlayCanvas engine.
 *
 * Compile with:
 *   emcc scene-math.c -O3 -msimd128 -s STANDALONE_WASM=1 \
 *     --no-entry -o scene-math.wasm
 *
 * Result: ~2-4KB standalone WASM module.
 *
 * Memory layout (external, passed via pointers):
 *   localMatrices:  [capacity * 16] floats - local transform matrices (column-major mat4x4)
 *   parentIndices:  [capacity] uint32     - parent slot index (0xFFFFFFFF for root)
 *   worldMatrices:  [capacity * 16] floats - output: world transform matrices
 *   dirtyList:      [dirtyCount] uint32   - indices of dirty objects (topologically sorted)
 */

#include <wasm_simd128.h>
#include <stdint.h>

/**
 * SIMD128 mat4x4 multiplication: out = A * B (column-major)
 *
 * Each column of B is multiplied by rows of A using splat + multiply-add.
 * This reduces 64 scalar multiply-adds to 16 SIMD operations.
 */
static inline void mat4_mul_simd(const float *A, const float *B, float *out) {
    // Load all 4 columns of A
    v128_t a0 = wasm_v128_load(&A[0]);
    v128_t a1 = wasm_v128_load(&A[4]);
    v128_t a2 = wasm_v128_load(&A[8]);
    v128_t a3 = wasm_v128_load(&A[12]);

    for (int col = 0; col < 4; col++) {
        v128_t b0 = wasm_f32x4_splat(B[col * 4 + 0]);
        v128_t b1 = wasm_f32x4_splat(B[col * 4 + 1]);
        v128_t b2 = wasm_f32x4_splat(B[col * 4 + 2]);
        v128_t b3 = wasm_f32x4_splat(B[col * 4 + 3]);

        v128_t r = wasm_f32x4_mul(a0, b0);
        r = wasm_f32x4_add(r, wasm_f32x4_mul(a1, b1));
        r = wasm_f32x4_add(r, wasm_f32x4_mul(a2, b2));
        r = wasm_f32x4_add(r, wasm_f32x4_mul(a3, b3));

        wasm_v128_store(&out[col * 4], r);
    }
}

/**
 * Batch compute world matrices for dirty objects.
 *
 * IMPORTANT: dirty_list must be topologically sorted (parents before children)
 * so that a parent's world matrix is already computed when its child is processed.
 *
 * @param dirty_list     Pointer to array of dirty object indices
 * @param dirty_count    Number of dirty objects
 * @param local_matrices Pointer to array of local matrices [capacity * 16 floats]
 * @param parent_indices Pointer to array of parent indices [capacity uint32s]
 * @param world_matrices Pointer to array of world matrices [capacity * 16 floats] (output)
 */
__attribute__((export_name("compute_world_matrices")))
void compute_world_matrices(
    uint32_t *dirty_list,
    uint32_t dirty_count,
    float *local_matrices,
    uint32_t *parent_indices,
    float *world_matrices
) {
    for (uint32_t i = 0; i < dirty_count; i++) {
        uint32_t obj_id = dirty_list[i];
        float *local = &local_matrices[obj_id * 16];
        float *world = &world_matrices[obj_id * 16];
        uint32_t parent_id = parent_indices[obj_id];

        if (parent_id == 0xFFFFFFFF) {
            // Root node: world = local (direct copy using SIMD)
            wasm_v128_store(&world[0], wasm_v128_load(&local[0]));
            wasm_v128_store(&world[4], wasm_v128_load(&local[4]));
            wasm_v128_store(&world[8], wasm_v128_load(&local[8]));
            wasm_v128_store(&world[12], wasm_v128_load(&local[12]));
        } else {
            // Child node: world = parent.world * local
            float *parent_world = &world_matrices[parent_id * 16];
            mat4_mul_simd(parent_world, local, world);
        }
    }
}
