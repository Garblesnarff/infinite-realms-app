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
    scene_spec: {
      type: ['object', 'null'], additionalProperties: false,
      properties: {
        id: { type: ['string', 'null'] }, sessionId: { type: ['string', 'null'] },
        environment: { type: 'string', enum: ['dungeon_room', 'cave', 'tavern', 'forest_clearing', 'road', 'ruins', 'ship_deck', 'open_field', 'corridor'] },
        size: { type: ['string', 'null'], enum: ['small', 'medium', 'large', null] },
        sceneDescription: { type: ['string', 'null'] }, seed: { type: ['number', 'null'] },
        enemyPlacement: { type: ['string', 'null'], enum: ['ambush', 'guarding', 'formation', null] },
      },
      required: ['id', 'sessionId', 'environment', 'size', 'sceneDescription', 'seed', 'enemyPlacement'],
    },
    map_actions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['move', 'place', 'remove', 'update_cell'] },
          entityId: { type: ['string', 'null'] }, x: { type: ['number', 'null'] }, y: { type: ['number', 'null'] },
          changes: { type: ['object', 'null'], additionalProperties: false, properties: {
            terrain: { type: 'string', enum: ['floor', 'wall', 'door_closed', 'door_open', 'difficult', 'water', 'pit', 'obscured'] },
            blocksMovement: { type: 'boolean' }, blocksSight: { type: 'boolean' }, cover: { type: 'number', enum: [0, 1, 2, 3] }, elevation: { type: 'number' }, decoration: { type: 'string' },
            id: { type: 'string' }, name: { type: 'string' }, size: { type: 'string', enum: ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] },
            type: { type: 'string', enum: ['pc', 'npc', 'monster', 'object'] }, speedFeet: { type: 'number' }, movementRemaining: { type: 'number' }, isLiving: { type: 'boolean' },
          } },
        },
        required: ['action', 'entityId', 'x', 'y', 'changes'],
      },
    },
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
  required: ['text', 'narration_segments', 'roll_requests', 'combat_transition', 'scene_spec', 'map_actions', 'combatants', 'combat_actions'],
};
