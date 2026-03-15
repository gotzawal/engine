import { SelectInput } from '@playcanvas/pcui/react';
import { Component } from 'react';

import { jsx } from '../jsx.mjs';
import { iframe } from '../iframe.mjs';

/** @typedef {{ detail: { textureArrayMode: string } }} TextureArrayModeEvent */

/**
 * @typedef {object} Props
 */

/**
 * @typedef {object} State
 * @property {string} activeMode - The active texture array batching mode.
 */

/** @type {typeof Component<Props, State>} */
const TypedComponent = Component;

class TextureArraySelector extends TypedComponent {
    state = {
        activeMode: localStorage.getItem('preferredTextureArrayMode') ?? 'disabled'
    };

    constructor(props) {
        super(props);
        this._handleUpdate = this._handleUpdate.bind(this);
    }

    /**
     * @param {TextureArrayModeEvent} event - The event.
     */
    _handleUpdate(event) {
        this.setState({ activeMode: event.detail.textureArrayMode });
    }

    componentDidMount() {
        window.addEventListener('updateActiveTextureArrayMode', this._handleUpdate);
    }

    componentWillUnmount() {
        window.removeEventListener('updateActiveTextureArrayMode', this._handleUpdate);
    }

    /**
     * @param {string} value - The selected texture array batching mode.
     */
    onSelect(value) {
        this.setState({ activeMode: value });
        localStorage.setItem('preferredTextureArrayMode', value);
        iframe.fire('updateTextureArrayMode', { textureArrayMode: value });
    }

    render() {
        return jsx(SelectInput, {
            id: 'textureArrayModeSelectInput',
            options: [
                { t: 'Tex Array', v: 'enabled' },
                { t: 'Per-Material', v: 'disabled' }
            ],
            value: this.state.activeMode,
            onSelect: this.onSelect.bind(this),
            prefix: 'Textures: '
        });
    }
}

export { TextureArraySelector };
