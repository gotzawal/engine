import { BooleanInput, LabelGroup, Panel } from '@playcanvas/pcui/react';
import { Component } from 'react';

import { jsx } from '../jsx.mjs';
import { iframe } from '../iframe.mjs';

const STORAGE_KEY_GPU_CULLING = 'gpuCullingEnabled';
const STORAGE_KEY_INDIRECT_DRAW = 'indirectDrawEnabled';

/**
 * @typedef {object} State
 * @property {boolean} gpuCulling - GPU frustum culling enabled.
 * @property {boolean} indirectDraw - Indirect draw enabled.
 */

/** @type {typeof Component<{}, State>} */
const TypedComponent = Component;

class GpuPipelineSelector extends TypedComponent {
    state = {
        gpuCulling: localStorage.getItem(STORAGE_KEY_GPU_CULLING) !== 'false',
        indirectDraw: localStorage.getItem(STORAGE_KEY_INDIRECT_DRAW) !== 'false'
    };

    /**
     * @param {boolean} value - New value.
     */
    onGpuCullingChange = (value) => {
        localStorage.setItem(STORAGE_KEY_GPU_CULLING, String(value));
        this.setState({ gpuCulling: value });
        iframe.fire('gpuPipelineChange', { gpuCulling: value, indirectDraw: this.state.indirectDraw });
    };

    /**
     * @param {boolean} value - New value.
     */
    onIndirectDrawChange = (value) => {
        localStorage.setItem(STORAGE_KEY_INDIRECT_DRAW, String(value));
        this.setState({ indirectDraw: value });
        iframe.fire('gpuPipelineChange', { gpuCulling: this.state.gpuCulling, indirectDraw: value });
    };

    render() {
        const { gpuCulling, indirectDraw } = this.state;
        return jsx(
            Panel,
            {
                headerText: 'GPU Pipeline',
                id: 'gpuPipelinePanel',
                collapsible: true,
                collapsed: true
            },
            jsx(
                LabelGroup,
                { text: 'GPU Frustum Culling' },
                jsx(BooleanInput, {
                    type: 'toggle',
                    value: gpuCulling,
                    onChange: this.onGpuCullingChange
                })
            ),
            jsx(
                LabelGroup,
                { text: 'Indirect Draw' },
                jsx(BooleanInput, {
                    type: 'toggle',
                    value: indirectDraw,
                    onChange: this.onIndirectDrawChange
                })
            )
        );
    }
}

export { GpuPipelineSelector, STORAGE_KEY_GPU_CULLING, STORAGE_KEY_INDIRECT_DRAW };
