import { SelectInput } from '@playcanvas/pcui/react';
import { Component } from 'react';

import { jsx } from '../jsx.mjs';
import { iframe } from '../iframe.mjs';

/** @typedef {{ detail: { gpuDrivenMode: string } }} GpuDrivenModeEvent */

/**
 * @typedef {object} Props
 */

/**
 * @typedef {object} State
 * @property {string} activeMode - The active GPU-driven mode.
 */

/** @type {typeof Component<Props, State>} */
const TypedComponent = Component;

class GpuDrivenSelector extends TypedComponent {
    state = {
        activeMode: localStorage.getItem('preferredGpuDrivenMode') ?? 'disabled'
    };

    constructor(props) {
        super(props);
        this._handleUpdate = this._handleUpdate.bind(this);
    }

    /**
     * @param {GpuDrivenModeEvent} event - The event.
     */
    _handleUpdate(event) {
        this.setState({ activeMode: event.detail.gpuDrivenMode });
    }

    componentDidMount() {
        window.addEventListener('updateActiveGpuDrivenMode', this._handleUpdate);
    }

    componentWillUnmount() {
        window.removeEventListener('updateActiveGpuDrivenMode', this._handleUpdate);
    }

    /**
     * @param {string} value - The selected GPU-driven mode.
     */
    onSelect(value) {
        this.setState({ activeMode: value });
        localStorage.setItem('preferredGpuDrivenMode', value);
        iframe.fire('updateGpuDrivenMode', { gpuDrivenMode: value });
    }

    render() {
        return jsx(SelectInput, {
            id: 'gpuDrivenModeSelectInput',
            options: [
                { t: 'GPU-Driven', v: 'enabled' },
                { t: 'Per-Draw', v: 'disabled' }
            ],
            value: this.state.activeMode,
            onSelect: this.onSelect.bind(this),
            prefix: 'Pipeline: '
        });
    }
}

export { GpuDrivenSelector };
