import { SelectInput } from '@playcanvas/pcui/react';
import { Component } from 'react';

import { jsx } from '../jsx.mjs';
import { iframe } from '../iframe.mjs';

/** @typedef {{ detail: { materialStorageMode: string } }} MaterialStorageModeEvent */

/**
 * @typedef {object} Props
 */

/**
 * @typedef {object} State
 * @property {string} activeMode - The active material storage mode.
 */

/** @type {typeof Component<Props, State>} */
const TypedComponent = Component;

class MaterialStorageSelector extends TypedComponent {
    state = {
        activeMode: localStorage.getItem('preferredMaterialStorageMode') ?? 'disabled'
    };

    constructor(props) {
        super(props);
        this._handleUpdate = this._handleUpdate.bind(this);
    }

    /**
     * @param {MaterialStorageModeEvent} event - The event.
     */
    _handleUpdate(event) {
        this.setState({ activeMode: event.detail.materialStorageMode });
    }

    componentDidMount() {
        window.addEventListener('updateActiveMaterialStorageMode', this._handleUpdate);
    }

    componentWillUnmount() {
        window.removeEventListener('updateActiveMaterialStorageMode', this._handleUpdate);
    }

    /**
     * @param {string} value - The selected material storage mode.
     */
    onSelect(value) {
        this.setState({ activeMode: value });
        localStorage.setItem('preferredMaterialStorageMode', value);
        iframe.fire('updateMaterialStorageMode', { materialStorageMode: value });
    }

    render() {
        return jsx(SelectInput, {
            id: 'materialStorageModeSelectInput',
            options: [
                { t: 'Material SB', v: 'enabled' },
                { t: 'Per-Material UB', v: 'disabled' }
            ],
            value: this.state.activeMode,
            onSelect: this.onSelect.bind(this),
            prefix: 'Material: '
        });
    }
}

export { MaterialStorageSelector };
