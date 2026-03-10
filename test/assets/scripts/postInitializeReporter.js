class postInitializeReporter extends pc.Script {
    static scriptName = 'postInitializeReporter';

    initialize() {
        console.log(`${this.entity.getGuid()} initialize postInitializeReporter`);
    }

    postInitialize() {
        window.initializeCalls.push(`${this.entity.getGuid()} postInitialize postInitializeReporter`);
    }
}

pc.registerScript(postInitializeReporter);
