class Enabler extends pc.Script {
    static scriptName = 'enabler';

    initialize() {
        window.initializeCalls.push(`${this.entity.getGuid()} initialize enabler`);
        this.entityToEnable.enabled = true;
        this.entityToEnable.script.enabled = true;
        if (this.entityToEnable.script.scriptA) {
            this.entityToEnable.script.scriptA.enabled = true;
        }
        if (this.entityToEnable.script.scriptB) {
            this.entityToEnable.script.scriptB.enabled = true;
        }
    }

    postInitialize() {
        window.initializeCalls.push(`${this.entity.getGuid()} postInitialize enabler`);
    }
}

Enabler.attributes.add('entityToEnable', { type: 'entity' });

pc.registerScript(Enabler);
