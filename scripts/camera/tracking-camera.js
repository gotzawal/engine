class TrackingCamera extends pc.Script {
    static scriptName = 'trackingCamera';

    // update code called every frame
    postUpdate(dt) {
        if (this.target) {
            var targetPos = this.target.getPosition();
            this.entity.lookAt(targetPos);
        }
    }
}

TrackingCamera.attributes.add('target', { type: 'entity' });

pc.registerScript(TrackingCamera);
