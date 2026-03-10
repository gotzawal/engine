class postCloner extends pc.Script {
    static scriptName = 'postCloner';

    postInitialize() {

        const clone = this.entityToClone.clone();

        this.app.root.addChild(clone);

        clone.enabled = true;
    }
}

postCloner.attributes.add('entityToClone', { type: 'entity' });

pc.registerScript(postCloner);
