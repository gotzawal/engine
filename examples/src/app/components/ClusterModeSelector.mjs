import { SelectInput } from '@playcanvas/pcui/react';
import { Component } from 'react';

import { jsx } from '../jsx.mjs';
import { iframe } from '../iframe.mjs';

/** @typedef {{ detail: { clusterMode: string } }} ClusterModeEvent */

/**
 * @typedef {object} Props
 */

/**
 * @typedef {object} State
 * @property {string} activeMode - The active cluster mode.
 */

/** @type {typeof Component<Props, State>} */
const TypedComponent = Component;

class ClusterModeSelector extends TypedComponent {
    state = {
        activeMode: localStorage.getItem('preferredClusterMode') ?? 'gpu'
    };

    constructor(props) {
        super(props);
        this._handleUpdate = this._handleUpdate.bind(this);
    }

    /**
     * @param {ClusterModeEvent} event - The event.
     */
    _handleUpdate(event) {
        this.setState({ activeMode: event.detail.clusterMode });
    }

    componentDidMount() {
        window.addEventListener('updateActiveClusterMode', this._handleUpdate);
    }

    componentWillUnmount() {
        window.removeEventListener('updateActiveClusterMode', this._handleUpdate);
    }

    /**
     * @param {string} value - The selected cluster mode.
     */
    onSelect(value) {
        this.setState({ activeMode: value });
        localStorage.setItem('preferredClusterMode', value);
        iframe.fire('updateClusterMode', { clusterMode: value });
    }

    render() {
        return jsx(SelectInput, {
            id: 'clusterModeSelectInput',
            options: [
                { t: 'GPU Compute', v: 'gpu' },
                { t: 'CPU', v: 'cpu' }
            ],
            value: this.state.activeMode,
            onSelect: this.onSelect.bind(this),
            prefix: 'Cluster: '
        });
    }
}

export { ClusterModeSelector };
