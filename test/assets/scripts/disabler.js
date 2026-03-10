class Disabler extends pc.Script {
    static scriptName = 'disabler';

    initialize() {
        window.initializeCalls.push(`${this.entity.getGuid()} initialize disabler`);

        if (this.disableEntity) {
            this.entity.enabled = false;
        }

        if (this.disableScriptComponent) {
            this.entity.script.enabled = false;
        }

        if (this.disableScriptInstance) {
            if (this.entity.script.scriptA) {
                this.entity.script.scriptA.enabled = false;
            }

            if (this.entity.script.scriptB) {
                this.entity.script.scriptB.enabled = false;
            }
        }
    }

    postInitialize() {
        window.initializeCalls.push(`${this.entity.getGuid()} postInitialize disabler`);
    }
}

Disabler.attributes.add('disableEntity', { type: 'boolean' });
Disabler.attributes.add('disableScriptComponent', { type: 'boolean' });
Disabler.attributes.add('disableScriptInstance', { type: 'boolean' });

pc.registerScript(Disabler);
