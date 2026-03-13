import { SelectInput } from '@playcanvas/pcui/react';
import { Component } from 'react';

import { jsx } from '../jsx.mjs';
import { iframe } from '../iframe.mjs';

/** @typedef {{ detail: { renderBundleMode: string } }} RenderBundleModeEvent */

/**
 * @typedef {object} Props
 */

/**
 * @typedef {object} State
 * @property {string} activeMode - The active render bundle mode.
 */

/** @type {typeof Component<Props, State>} */
const TypedComponent = Component;

class RenderBundleSelector extends TypedComponent {
    state = {
        activeMode: localStorage.getItem('preferredRenderBundleMode') ?? 'enabled'
    };

    constructor(props) {
        super(props);
        this._handleUpdate = this._handleUpdate.bind(this);
    }

    /**
     * @param {RenderBundleModeEvent} event - The event.
     */
    _handleUpdate(event) {
        this.setState({ activeMode: event.detail.renderBundleMode });
    }

    componentDidMount() {
        window.addEventListener('updateActiveRenderBundleMode', this._handleUpdate);
    }

    componentWillUnmount() {
        window.removeEventListener('updateActiveRenderBundleMode', this._handleUpdate);
    }

    /**
     * @param {string} value - The selected render bundle mode.
     */
    onSelect(value) {
        this.setState({ activeMode: value });
        localStorage.setItem('preferredRenderBundleMode', value);
        iframe.fire('updateRenderBundleMode', { renderBundleMode: value });
    }

    render() {
        return jsx(SelectInput, {
            id: 'renderBundleModeSelectInput',
            options: [
                { t: 'Bundle (Opaque)', v: 'enabled' },
                { t: 'Per-Draw', v: 'disabled' }
            ],
            value: this.state.activeMode,
            onSelect: this.onSelect.bind(this),
            prefix: 'Render: '
        });
    }
}

export { RenderBundleSelector };
