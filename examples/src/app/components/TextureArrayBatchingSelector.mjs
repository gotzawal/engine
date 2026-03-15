import { SelectInput } from '@playcanvas/pcui/react';
import { Component } from 'react';

import { jsx } from '../jsx.mjs';
import { iframe } from '../iframe.mjs';

/** @typedef {{ detail: { textureArrayBatchingMode: string } }} TextureArrayBatchingModeEvent */

/**
 * @typedef {object} Props
 */

/**
 * @typedef {object} State
 * @property {string} activeMode - The active texture array batching mode.
 */

/** @type {typeof Component<Props, State>} */
const TypedComponent = Component;

class TextureArrayBatchingSelector extends TypedComponent {
    state = {
        activeMode: localStorage.getItem('preferredTextureArrayBatchingMode') ?? 'disabled'
    };

    constructor(props) {
        super(props);
        this._handleUpdate = this._handleUpdate.bind(this);
    }

    /**
     * @param {TextureArrayBatchingModeEvent} event - The event.
     */
    _handleUpdate(event) {
        this.setState({ activeMode: event.detail.textureArrayBatchingMode });
    }

    componentDidMount() {
        window.addEventListener('updateActiveTextureArrayBatchingMode', this._handleUpdate);
    }

    componentWillUnmount() {
        window.removeEventListener('updateActiveTextureArrayBatchingMode', this._handleUpdate);
    }

    /**
     * @param {string} value - The selected texture array batching mode.
     */
    onSelect(value) {
        this.setState({ activeMode: value });
        localStorage.setItem('preferredTextureArrayBatchingMode', value);
        iframe.fire('updateTextureArrayBatchingMode', { textureArrayBatchingMode: value });
    }

    render() {
        return jsx(SelectInput, {
            id: 'textureArrayBatchingModeSelectInput',
            options: [
                { t: 'Tex Array', v: 'enabled' },
                { t: 'Per-Material', v: 'disabled' }
            ],
            value: this.state.activeMode,
            onSelect: this.onSelect.bind(this),
            prefix: 'Batching: '
        });
    }
}

export { TextureArrayBatchingSelector };
