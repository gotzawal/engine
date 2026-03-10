/**
 * Selection processor shader options for GSplatProcessor.
 * Marks splats inside AABB as selected (1), outside as not selected (0).
 */
export const selectionProcessor = {
    processWGSL: /* wgsl */ `
        uniform uBoxMin: vec3f;
        uniform uBoxMax: vec3f;
        uniform matrix_model: mat4x4f;

        fn process() {
            let center = getCenter();
            // Transform to world space
            let worldCenter = (uniform.matrix_model * vec4f(center, 1.0)).xyz;
            // Check if inside box
            if (all(worldCenter >= uniform.uBoxMin) && all(worldCenter <= uniform.uBoxMax)) {
                writeSplatSelection(vec4f(1.0, 0.0, 0.0, 0.0));
            } else {
                writeSplatSelection(vec4f(0.0));
            }
        }
    `
};
