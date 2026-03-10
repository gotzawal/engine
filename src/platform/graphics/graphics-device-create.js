import { platform } from '../../core/platform.js';

import { DEVICETYPE_WEBGPU, DEVICETYPE_NULL } from './constants.js';
import { WebgpuGraphicsDevice } from './webgpu/webgpu-graphics-device.js';
import { NullGraphicsDevice } from './null/null-graphics-device.js';

/**
 * Creates a graphics device.
 *
 * @param {HTMLCanvasElement} canvas - The canvas element.
 * @param {object} options - Graphics device options.
 * @param {string[]} [options.deviceTypes] - An array of DEVICETYPE_*** constants, defining the
 * order in which the devices are attempted to get created. Defaults to [{@link DEVICETYPE_WEBGPU}].
 * {@link DEVICETYPE_NULL} is automatically added as a fallback.
 * @param {boolean} [options.antialias] - Boolean that indicates whether or not to perform
 * anti-aliasing if possible. Defaults to true.
 * @param {string} [options.displayFormat] - The display format of the canvas. Defaults to
 * {@link DISPLAYFORMAT_LDR}. Can be:
 *
 * - {@link DISPLAYFORMAT_LDR}
 * - {@link DISPLAYFORMAT_LDR_SRGB}
 * - {@link DISPLAYFORMAT_HDR}
 *
 * @param {boolean} [options.depth] - Boolean that indicates that the drawing buffer is
 * requested to have a depth buffer of at least 16 bits. Defaults to true.
 * @param {boolean} [options.stencil] - Boolean that indicates that the drawing buffer is
 * requested to have a stencil buffer of at least 8 bits. Defaults to true.
 * @param {boolean} [options.xrCompatible] - Boolean that hints to the user agent to use a
 * compatible graphics adapter for an immersive XR device.
 * @param {'default'|'high-performance'|'low-power'} [options.powerPreference] - A hint indicating
 * what configuration of GPU would be selected. Possible values are:
 *
 * - 'default': Let the user agent decide which GPU configuration is most suitable. This is the
 * default value.
 * - 'high-performance': Prioritizes rendering performance over power consumption.
 * - 'low-power': Prioritizes power saving over rendering performance.
 *
 * Defaults to 'default'.
 * @returns {Promise} - Promise object representing the created graphics device.
 * @category Graphics
 */
function createGraphicsDevice(canvas, options = {}) {

    const deviceTypes = options.deviceTypes ?? [DEVICETYPE_WEBGPU];

    // automatically added fallback
    if (!deviceTypes.includes(DEVICETYPE_NULL)) {
        deviceTypes.push(DEVICETYPE_NULL);
    }

    // XR compatibility if not specified
    if (platform.browser && !!navigator.xr) {
        options.xrCompatible ??= true;
    }

    // make a list of device creation functions in priority order
    const deviceCreateFuncs = [];
    for (let i = 0; i < deviceTypes.length; i++) {
        const deviceType = deviceTypes[i];

        if (deviceType === DEVICETYPE_WEBGPU && window?.navigator?.gpu) {
            deviceCreateFuncs.push(() => {
                const device = new WebgpuGraphicsDevice(canvas, options);
                return device.initWebGpu();
            });
        }

        if (deviceType === DEVICETYPE_NULL) {
            deviceCreateFuncs.push(() => {
                return new NullGraphicsDevice(canvas, options);
            });
        }
    }

    // execute each device creation function returning the first successful result
    return new Promise((resolve, reject) => {
        let attempt = 0;
        const next = () => {
            if (attempt >= deviceCreateFuncs.length) {
                reject(new Error('Failed to create a graphics device'));
            } else {
                Promise.resolve(deviceCreateFuncs[attempt++]())
                .then((device) => {
                    if (device) {
                        resolve(device);
                    } else {
                        next();
                    }
                }).catch((err) => {
                    console.log(err);
                    next();
                });
            }
        };
        next();
    });
}

export { createGraphicsDevice };
