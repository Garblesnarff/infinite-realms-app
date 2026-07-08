export const dmResponseSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string' },
    narration_segments: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['dm', 'character', 'transition'] },
          text: { type: 'string' }, character: { type: ['string', 'null'] },
          voice_category: { type: ['string', 'null'] },
        },
        required: ['type', 'text', 'character', 'voice_category'],
      },
    },
    roll_requests: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['check', 'save', 'attack', 'damage', 'initiative'] },
          formula: { type: 'string' }, purpose: { type: 'string' },
          dc: { type: ['number', 'null'] }, advantage: { type: 'boolean' }, disadvantage: { type: 'boolean' },
        },
        required: ['type', 'formula', 'purpose', 'dc', 'advantage', 'disadvantage'],
      },
    },
    combat_transition: { type: 'string', enum: ['none', 'start', 'end'] },
    combatants: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          monster_id: { type: 'string' }, name: { type: 'string' }, count: { type: 'number' },
        },
        required: ['monster_id', 'name', 'count'],
      },
    },
    combat_actions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          actor_id: { type: 'string' }, action_type: { type: 'string', enum: ['attack', 'cast_spell', 'dash', 'disengage', 'dodge', 'help', 'hide', 'ready', 'use_object'] },
          target_ids: { type: 'array', items: { type: 'string' } },
          weapon_id: { type: ['string', 'null'] }, spell_id: { type: ['string', 'null'] },
          slot_level: { type: ['number', 'null'] },
          movement_feet: { type: 'number' },
        },
        required: ['actor_id', 'action_type', 'target_ids', 'weapon_id', 'spell_id', 'slot_level', 'movement_feet'],
      },
    },
  },
  required: ['text', 'narration_segments', 'roll_requests', 'combat_transition', 'combatants', 'combat_actions'],
};
