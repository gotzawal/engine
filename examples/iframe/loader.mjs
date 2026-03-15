import files from 'examples/files';
import { data, refresh } from 'examples/observer';
import { updateDeviceType, fetchFile, localImport, clearImports, parseConfig, fire } from 'examples/utils';

import MiniStats from './ministats.mjs';

class ExampleLoader {
    /**
     * @type {Record<string, any>}
     * @private
     */
    _config;

    /**
     * @type {import('playcanvas').AppBase}
     * @private
     */
    _app;

    /**
     * @type {boolean}
     * @private
     */
    _started = false;

    /**
     * @type {boolean}
     * @private
     */
    _allowRestart = true;

    /**
     * @type {Function[]}
     * @private
     */
    destroyHandlers = [];

    /**
     * @type {boolean}
     */
    ready = false;

    _appStart() {
        // set ready state
        this.ready = true;

        if (this._app) {
            if (!this._app?.graphicsDevice?.canvas) {
                console.warn('No canvas found.');
                return;
            }
            this.setMiniStats(true);
        }

        if (!this._started) {
            // Sets code editor component files
            // Sets example component files (for controls + description)
            // Sets mini stats enabled state based on UI
            fire('exampleLoad', { observer: data, files, description: this._config.DESCRIPTION || '' });
        }
        this._started = true;

        // Updates controls UI
        fire('updateFiles', { observer: data, files });

        if (this._app) {
            // Updates device UI
            fire('updateActiveDevice', { deviceType: this._app?.graphicsDevice?.deviceType });

            // Apply saved cluster mode preference
            const clusterMode = localStorage.getItem('preferredClusterMode') ?? 'gpu';
            if (this._app.scene) {
                this._app.scene._gpuClusterLightingEnabled = (clusterMode === 'gpu');
            }
            fire('updateActiveClusterMode', { clusterMode });

            // Apply saved render bundle mode preference
            const renderBundleMode = localStorage.getItem('preferredRenderBundleMode') ?? 'enabled';
            const renderer = this._app.renderer;
            if (renderer) {
                renderer.renderBundlesEnabled = (renderBundleMode === 'enabled');
            }
            fire('updateActiveRenderBundleMode', { renderBundleMode });

            // Apply saved material storage mode preference
            const materialStorageMode = localStorage.getItem('preferredMaterialStorageMode') ?? 'disabled';
            if (renderer) {
                renderer.materialStorageBufferEnabled = (materialStorageMode === 'enabled');
            }
            fire('updateActiveMaterialStorageMode', { materialStorageMode });

            // Apply saved GPU-driven mode preference
            const gpuDrivenMode = localStorage.getItem('preferredGpuDrivenMode') ?? 'disabled';
            if (renderer) {
                renderer.gpuDrivenEnabled = (gpuDrivenMode === 'enabled');
            }
            fire('updateActiveGpuDrivenMode', { gpuDrivenMode });

            // Apply saved texture array batching mode preference
            const textureArrayMode = localStorage.getItem('preferredTextureArrayMode') ?? 'disabled';
            if (renderer) {
                renderer.textureArrayBatchingEnabled = (textureArrayMode === 'enabled');
            }
            fire('updateActiveTextureArrayMode', { textureArrayMode });
        }

        this._allowRestart = true;
    }

    /**
     * @param {string} stack - The stack trace.
     * @returns {{ file: string, line: number, column: number }[]} - The error locations.
     */
    _parseErrorLocations(stack) {
        const lines = stack.split('\n');
        /**
         * @type {{ file: string, line: number, column: number }[]}
         */
        const locations = [];
        lines.forEach((line) => {
            const match = /^\s*at\s(.+):(\d+):(\d+)$/.exec(line);
            if (!match) {
                return;
            }
            locations.push({
                file: match[1],
                line: +match[2],
                column: +match[3]
            });
        });
        return locations;
    }

    /**
     * @param {{ engineUrl: string, fileNames: string[] }} options - Options to start the loader
     */
    async start({ engineUrl, fileNames }) {
        window.pc = await import(engineUrl);

        // @ts-ignore
        window.top.pc = window.pc;

        // Listen for runtime cluster mode changes from the parent UI
        window.addEventListener('updateClusterMode', (/** @type {CustomEvent} */ e) => {
            const mode = e.detail.clusterMode;
            if (this._app?.scene) {
                this._app.scene._gpuClusterLightingEnabled = (mode === 'gpu');
                // Trigger shader recompilation by clearing all material variants
                this._app.scene.layers?.layerList?.forEach((layer) => {
                    layer.meshInstances.forEach((mi) => {
                        mi.material?.clearVariants?.();
                    });
                });
            }
            fire('updateActiveClusterMode', { clusterMode: mode });
        });

        // Listen for runtime render bundle mode changes from the parent UI
        window.addEventListener('updateRenderBundleMode', (/** @type {CustomEvent} */ e) => {
            const mode = e.detail.renderBundleMode;
            const renderer = this._app?.renderer;
            if (renderer) {
                renderer.renderBundlesEnabled = (mode === 'enabled');
                // invalidate all cached bundles when toggling
                renderer._bundleCache?.invalidateAll();
                renderer._drawCallGrouper?.invalidateAll();
            }
            fire('updateActiveRenderBundleMode', { renderBundleMode: mode });
        });

        // Listen for runtime material storage mode changes from the parent UI
        window.addEventListener('updateMaterialStorageMode', (/** @type {CustomEvent} */ e) => {
            const mode = e.detail.materialStorageMode;
            const renderer = this._app?.renderer;
            if (renderer) {
                renderer.materialStorageBufferEnabled = (mode === 'enabled');
                // Trigger shader recompilation by clearing all material variants
                this._app?.scene?.layers?.layerList?.forEach((layer) => {
                    layer.meshInstances.forEach((mi) => {
                        mi.material?.clearVariants?.();
                    });
                });
                // invalidate all cached bundles
                renderer._bundleCache?.invalidateAll();
                renderer._drawCallGrouper?.invalidateAll();
            }
            fire('updateActiveMaterialStorageMode', { materialStorageMode: mode });
        });

        // Listen for runtime GPU-driven mode changes from the parent UI
        window.addEventListener('updateGpuDrivenMode', (/** @type {CustomEvent} */ e) => {
            const mode = e.detail.gpuDrivenMode;
            const renderer = this._app?.renderer;
            if (renderer) {
                renderer.gpuDrivenEnabled = (mode === 'enabled');
                // Trigger shader recompilation (GPU_DRIVEN define changes shaders)
                this._app?.scene?.layers?.layerList?.forEach((layer) => {
                    layer.meshInstances.forEach((mi) => {
                        mi.material?.clearVariants?.();
                    });
                });
                // invalidate all cached bundles
                renderer._bundleCache?.invalidateAll();
                renderer._drawCallGrouper?.invalidateAll();
            }
            fire('updateActiveGpuDrivenMode', { gpuDrivenMode: mode });
        });

        // Listen for runtime texture array batching mode changes from the parent UI
        window.addEventListener('updateTextureArrayMode', (/** @type {CustomEvent} */ e) => {
            const mode = e.detail.textureArrayMode;
            const renderer = this._app?.renderer;
            if (renderer) {
                renderer.textureArrayBatchingEnabled = (mode === 'enabled');
                // Trigger shader recompilation (TEXTURE_ARRAY_BATCHING define changes shaders)
                this._app?.scene?.layers?.layerList?.forEach((layer) => {
                    layer.meshInstances.forEach((mi) => {
                        mi.material?.clearVariants?.();
                    });
                });
                // invalidate all cached bundles
                renderer._bundleCache?.invalidateAll();
                renderer._drawCallGrouper?.invalidateAll();
            }
            fire('updateActiveTextureArrayMode', { textureArrayMode: mode });
        });

        // extracts example category and name from the URL
        const match = /([^/]+)\.html$/.exec(new URL(location.href).pathname);
        if (!match) {
            return;
        }

        // loads each files
        /**
         * @type {Record<string, string>}
         */
        const unorderedFiles = {};
        await Promise.all(fileNames.map(async (name) => {
            unorderedFiles[name] = await fetchFile(`./${match[1]}.${name}`);
        }));
        for (const name of Object.keys(unorderedFiles).sort()) {
            files[name] = unorderedFiles[name];
        }


        await this.load();
    }

    async load() {
        this._allowRestart = false;

        // refresh observer instance
        refresh();

        // parse config
        this._config = parseConfig(files['example.mjs']);

        // update device type
        updateDeviceType(this._config);

        if (!this._started) {
            // just notify to clean UI, but not during hot-reload
            fire('exampleLoading', { showDeviceSelector: !this._config.NO_DEVICE_SELECTOR });
        }

        clearImports();

        try {
            // import local file
            const module = await localImport('example.mjs');
            this._app = module.app;

            // additional destroy handler in case no app provided
            if (typeof module.destroy === 'function') {
                this.destroyHandlers.push(module.destroy);
            }
        } catch (e) {
            console.error(e);
            const locations = this._parseErrorLocations(e.stack);
            window.top?.dispatchEvent(new CustomEvent('exampleError', {
                detail: {
                    name: e.constructor.name,
                    message: e.message,
                    locations
                }
            }));

            this._allowRestart = true;
            return;
        }

        if (this._app) {
            // Check if app has already started (frame is a number, including 0)
            if (this._app.frame !== undefined) {
                this._appStart();
            } else {
                this._app.once('start', () => this._appStart());
            }
        } else {
            this._appStart();
        }
    }

    sendRequestedFiles() {
        fire('requestedFiles', { files });
    }

    /**
     * @param {boolean} enabled - The enabled state of ministats
     */
    setMiniStats(enabled = false) {
        if (this._config.NO_MINISTATS) {
            return;
        }
        MiniStats.enable(this._app, enabled);
    }

    hotReload() {
        if (!this._allowRestart) {
            console.warn('Dropping restart while still restarting');
            return;
        }
        window.top?.dispatchEvent(new CustomEvent('exampleHotReload'));
        this.destroy();
        this.load();
    }

    destroy() {
        MiniStats.destroy();
        if (this._app && this._app.graphicsDevice) {
            this._app.destroy();
        }
        this.destroyHandlers.forEach(destroy => destroy());
        this.ready = false;
    }

    exit() {
        clearImports();
        this.destroy();
    }
}

export { ExampleLoader };
