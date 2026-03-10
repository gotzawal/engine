class ScriptB extends pc.Script {
    static scriptName = 'scriptB';

    initialize() {
        const guid = this.entity.getGuid();
        window.initializeCalls.push(`${guid} initialize scriptB`);
        this.entity.script.on('enable', () => {
            window.initializeCalls.push(`${guid} enable scriptB`);
        });
        this.entity.script.on('disable', () => {
            window.initializeCalls.push(`${guid} disable scriptB`);
        });
        this.entity.script.on('state', (enabled) => {
            window.initializeCalls.push(`${guid} state ${enabled} scriptB`);
        });
        this.on('destroy', function () {
            window.initializeCalls.push(`${this.entity.getGuid()} destroy scriptB`);
        });
    }

    postInitialize() {
        window.initializeCalls.push(`${this.entity.getGuid()} postInitialize scriptB`);
    }

    update() {
        window.initializeCalls.push(`${this.entity.getGuid()} update scriptB`);
    }

    postUpdate() {
        window.initializeCalls.push(`${this.entity.getGuid()} postUpdate scriptB`);
    }
}

pc.registerScript(ScriptB);
