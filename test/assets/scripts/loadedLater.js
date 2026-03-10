class LoadedLater extends pc.Script {
    static scriptName = 'loadedLater';

    initialize() {
        window.initializeCalls.push(`${this.entity.getGuid()} initialize loadedLater`);

        if (this.disableEntity) {
            this.entity.enabled = false;
        }

        if (this.disableScriptComponent) {
            this.entity.script.enabled = false;
        }

        if (this.disableScriptInstance) {
            this.entity.script.loadedLater.enabled = false;
        }
    }

    postInitialize() {
        window.initializeCalls.push(`${this.entity.getGuid()} postInitialize loadedLater`);
    }
}

LoadedLater.attributes.add('disableEntity', { type: 'boolean' });
LoadedLater.attributes.add('disableScriptComponent', { type: 'boolean' });
LoadedLater.attributes.add('disableScriptInstance', { type: 'boolean' });

pc.registerScript(LoadedLater);
