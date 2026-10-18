'use strict';

// Anthropic structured outputs support this reduced JSON Schema subset; callers still validate against their canonical schemas.
function makeWireSchema(schema) {
  if (Array.isArray(schema)) return schema.map(makeWireSchema);
  if (!schema || typeof schema !== 'object') return schema;
  if (Object.keys(schema).length === 1 && Array.isArray(schema.anyOf) && schema.anyOf.length === 2) {
    const nullBranch = schema.anyOf.find(branch => branch?.type === 'null');
    const objectBranch = schema.anyOf.find(branch => branch?.type === 'object');
    if (nullBranch && Object.keys(nullBranch).length === 1 && objectBranch) {
      return { ...makeWireSchema(objectBranch), type: ['object', 'null'] };
    }
  }
  const wire = {};
  for (const [key, value] of Object.entries(schema)) {
    if (['maxItems', 'minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength'].includes(key)) continue;
    if (key === 'minItems' && value > 1) continue;
    wire[key] = makeWireSchema(value);
  }
  return wire;
}

module.exports = { makeWireSchema };
