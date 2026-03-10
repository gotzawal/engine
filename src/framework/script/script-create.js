import { AppBase } from '../app-base.js';
import { Script } from './script.js';
import { ScriptTypes } from './script-types.js';

const reservedScriptNames = new Set([
    'system', 'entity', 'create', 'destroy', 'swap', 'move', 'data',
    'scripts', '_scripts', '_scriptsIndex', '_scriptsData',
    'enabled', '_oldState', 'onEnable', 'onDisable', 'onPostStateChange',
    '_onSetEnabled', '_checkState', '_onBeforeRemove',
    '_onInitializeAttributes', '_onInitialize', '_onPostInitialize',
    '_onUpdate', '_onPostUpdate',
    '_callbacks', '_callbackActive', 'has', 'get', 'on', 'off', 'fire', 'once', 'hasEvent',
    // 'worker' is reserved to prevent users from overwriting the native Worker constructor
    'worker'
]);

function getReservedScriptNames() {
    return reservedScriptNames;
}

/**
 * Register a existing class type as a Script Type to {@link ScriptRegistry}. Useful when defining
 * a ES6 script class that extends {@link Script} (see example).
 *
 * @param {typeof Script} script - The existing class type (constructor function) to be
 * registered as a Script Type. Class must extend {@link Script} (see example).
 * @param {string} [name] - Optional unique name of the Script Type. By default it will use the
 * same name as the existing class. If a Script Type with the same name has already been registered
 * and the new one has a `swap` method defined in its prototype, then it will perform hot swapping
 * of existing Script Instances on entities using this new Script Type. Note: There is a reserved
 * list of names that cannot be used, such as list below as well as some starting from `_`
 * (underscore): system, entity, create, destroy, swap, move, scripts, onEnable, onDisable,
 * onPostStateChange, has, on, off, fire, once, hasEvent.
 * @param {AppBase} [app] - Optional application handler, to choose which {@link ScriptRegistry}
 * to register the script type to. By default it will use `Application.getApplication()` to get
 * current {@link AppBase}.
 * @example
 * // define a ES6 script class
 * class PlayerController extends pc.Script {
 *
 *     initialize() {
 *         // called once on initialize
 *     }
 *
 *     update(dt) {
 *         // called each tick
 *     }
 * }
 *
 * // register the class as a script
 * pc.registerScript(PlayerController);
 *
 * // declare script attributes (Must be after pc.registerScript())
 * PlayerController.attributes.add('attribute1', {type: 'number'});
 * @category Script
 */
function registerScript(script, name, app) {
    if (typeof script !== 'function') {
        throw new Error(`script class: '${script}' must be a constructor function (i.e. class).`);
    }

    if (!(script.prototype instanceof Script)) {
        throw new Error(`script class: '${Script.__getScriptName(script)}' does not extend pc.Script.`);
    }

    name = name || script.__name || Script.__getScriptName(script);

    if (reservedScriptNames.has(name)) {
        throw new Error(`script name: '${name}' is reserved, please change script name`);
    }

    script.__name = name;

    // add to scripts registry
    const registry = app ? app.scripts : AppBase.getApplication().scripts;
    registry.add(script);

    ScriptTypes.push(script);
}

export { registerScript, getReservedScriptNames };
