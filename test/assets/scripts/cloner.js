class Cloner extends pc.Script {
    static scriptName = 'cloner';

    initialize() {
        window.initializeCalls.push(`${this.entity.getGuid()} initialize cloner`);
        const clone = this.entityToClone.clone();
        clone.name += ' - clone';
        this.app.root.addChild(clone);
    }

    postInitialize() {
        window.initializeCalls.push(`${this.entity.getGuid()} postInitialize cloner`);
    }
}

Cloner.attributes.add('entityToClone', { type: 'entity' });

pc.registerScript(Cloner);
