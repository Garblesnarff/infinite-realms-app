/**
 * Combat trigger keywords organized by category
 */
export const COMBAT_KEYWORDS = {
  // Direct combat initiation
  initiative: [
    'roll initiative',
    'initiative order',
    'combat begins',
    'battle starts',
    'turn order',
    'who goes first',
    'initiative count',
  ],

  // Attack actions
  attacks: [
    'attacks',
    'strikes',
    'swings',
    'fires',
    'shoots',
    'lunges',
    'makes an attack',
    'weapon attack',
    'melee attack',
    'ranged attack',
    'attempts to hit',
    'tries to strike',
  ],

  // Spell casting
  spellcasting: [
    'casts',
    'conjures',
    'invokes',
    'channels',
    'spell attack',
    'magic missile',
    'fireball',
    'lightning bolt',
    'healing word',
    'sacred flame',
    'eldritch blast',
  ],

  // Damage and effects
  damage: [
    'takes damage',
    'deals damage',
    'damage',
    'hit points',
    'HP',
    'wounded',
    'injured',
    'bleeding',
    'unconscious',
    'knocked out',
  ],

  // Combat creatures/enemies
  enemies: [
    'mech',
    'robot',
    'automaton',
    'guard',
    'soldier',
    'bandit',
    'goblin',
    'orc',
    'troll',
    'dragon',
    'skeleton',
    'zombie',
    'cultist',
    'assassin',
    'warrior',
  ],

  // Combat ending - ONLY definitive phrases that clearly end combat
  // Words like "flee", "retreat", "escape" are removed because they can appear
  // in hypothetical context ("You could flee", "Consider retreating")
  endings: [
    'combat ends',
    'combat has ended',
    'the battle is over',
    'battle over',
    'the fight is over',
    'enemies defeated',
    'all enemies defeated',
    'all enemies dead',
    'threat eliminated',
    'threat has been eliminated',
    'you are victorious',
    'you have won',
  ],
};

/**
 * Enemy stat templates for common creature types
 */
export const ENEMY_TEMPLATES = {
  mech: { hp: 45, ac: 16, cr: '2' },
  humanoid: { hp: 25, ac: 14, cr: '1' },
  beast: { hp: 30, ac: 12, cr: '1' },
  undead: { hp: 22, ac: 13, cr: '1/2' },
  dragon: { hp: 200, ac: 18, cr: '10' },
  construct: { hp: 60, ac: 17, cr: '3' },
  unknown: { hp: 30, ac: 14, cr: '1' },
};
