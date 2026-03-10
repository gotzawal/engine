class ScriptA extends pc.Script {
    static scriptName = 'scriptA';

    initialize() {
        const guid = this.entity.getGuid();
        window.initializeCalls.push(`${guid} initialize scriptA`);
        this.entity.script.on('enable', () => {
            window.initializeCalls.push(`${guid} enable scriptComponent scriptA`);
        });
        this.entity.script.on('disable', () => {
            window.initializeCalls.push(`${guid} disable scriptComponent scriptA`);
        });
        this.entity.script.on('state', (enabled) => {
            window.initializeCalls.push(`${guid} state scriptComponent ${enabled} scriptA`);
        });
        this.on('enable', () => {
            window.initializeCalls.push(`${guid} enable scriptA`);
        });
        this.on('disable', () => {
            window.initializeCalls.push(`${guid} disable scriptA`);
        });
        this.on('state', (enabled) => {
            window.initializeCalls.push(`${guid} state ${enabled} scriptA`);
        });
        this.on('destroy', function () {
            window.initializeCalls.push(`${this.entity.getGuid()} destroy scriptA`);
        });
    }

    postInitialize() {
        window.initializeCalls.push(`${this.entity.getGuid()} postInitialize scriptA`);
    }

    update() {
        window.initializeCalls.push(`${this.entity.getGuid()} update scriptA`);
    }

    postUpdate() {
        window.initializeCalls.push(`${this.entity.getGuid()} postUpdate scriptA`);
    }
}

pc.registerScript(ScriptA);
