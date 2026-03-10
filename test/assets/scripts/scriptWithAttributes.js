class ScriptWithAttributes extends pc.Script {
    static scriptName = 'scriptWithAttributes';

    initialize() {
    }

    postInitialize() {
    }
}

const schema = [{
    name: 'fieldNumber',
    type: 'number',
    default: 1
}, {
    name: 'fieldEntity',
    type: 'entity'
}, {
    name: 'fieldNumberArray',
    type: 'number',
    array: true,
    default: 5
}];

ScriptWithAttributes.attributes.add('attribute1', {
    type: 'entity'
});

ScriptWithAttributes.attributes.add('attribute2', {
    type: 'number',
    default: 2
});

ScriptWithAttributes.attributes.add('attribute3', {
    type: 'json',
    schema: schema
});

ScriptWithAttributes.attributes.add('attribute4', {
    type: 'json',
    array: true,
    schema: schema
});

pc.registerScript(ScriptWithAttributes);
