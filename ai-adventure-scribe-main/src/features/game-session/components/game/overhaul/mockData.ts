import type { GameOverhaulViewModel } from './types';

/**
 * Sample view-model mirroring the navy+gold design mockup ("The Old Watchtower").
 * Used by the /ui-preview harness to iterate the layout without a live session.
 */
export const MOCK_VIEW_MODEL: GameOverhaulViewModel = {
  scene: {
    title: 'THE OLD WATCHTOWER',
    blurb: 'A mist-cloaked ruin stirs with ancient presence.',
  },
  campaign: {
    name: 'Shadows of Eryndor',
    chapter: 'Chapter 2: Whispers in the Fog',
    objective: 'Find the source of the shadow disturbing the village of Mistwood.',
    objectiveTasks: [{ id: 't1', label: 'Investigate the old watchtower', done: false }],
    regionLabel: 'Mistwood',
  },
  partyMax: 3,
  party: [
    { id: 'p1', name: 'Liora Brightwind', subtitle: 'Level 5 Cleric', currentHp: 32, maxHp: 32 },
    { id: 'p2', name: 'Thamior Silversong', subtitle: 'Level 5 Wizard', currentHp: 24, maxHp: 24 },
    { id: 'p3', name: 'Kael Ironfist', subtitle: 'Level 5 Fighter', currentHp: 38, maxHp: 38 },
  ],
  combat: {
    active: true,
    round: 2,
    combatants: [
      { id: 'c1', initiative: 18, name: 'Thamior Silversong' },
      { id: 'c2', initiative: 15, name: 'Kael Ironfist' },
      { id: 'c3', initiative: 12, name: 'Shadow Wraith', isEnemy: true, isActive: true },
      { id: 'c4', initiative: 9, name: 'Liora Brightwind' },
    ],
  },
  character: {
    name: 'Aldric Vale',
    subtitle: 'Human · Fighter (Champion)',
    level: 5,
    xpCurrent: 2100,
    xpMax: 6500,
    hpCurrent: 38,
    hpMax: 38,
    ac: 17,
    initiative: '+3',
    speed: 30,
    abilityScores: [
      { label: 'STR', score: 16, modifier: '+3' },
      { label: 'DEX', score: 14, modifier: '+2' },
      { label: 'CON', score: 16, modifier: '+3' },
      { label: 'INT', score: 10, modifier: '+0' },
      { label: 'WIS', score: 12, modifier: '+1' },
      { label: 'CHA', score: 13, modifier: '+1' },
    ],
    savingThrows: [
      { label: 'STR', modifier: '+5' },
      { label: 'DEX', modifier: '+4' },
      { label: 'CON', modifier: '+5' },
      { label: 'INT', modifier: '+2' },
      { label: 'WIS', modifier: '+3' },
      { label: 'CHA', modifier: '+3' },
    ],
    skills: [
      { label: 'Athletics', modifier: '+5' },
      { label: 'Perception', modifier: '+3' },
      { label: 'Survival', modifier: '+3' },
      { label: 'Insight', modifier: '+1' },
      { label: 'Intimidation', modifier: '+3' },
      { label: 'Persuasion', modifier: '+5' },
    ],
    attacks: [
      { id: 'a1', name: 'Longsword', bonus: '+6', damage: '1d8+3' },
      { id: 'a2', name: 'Shield Bash', bonus: '+5', damage: '1d4+3' },
      { id: 'a3', name: 'Heavy Crossbow', bonus: '+4', damage: '1d10+2' },
    ],
    conditions: [
      { id: 'cd1', name: 'Bless', duration: '1m' },
      { id: 'cd2', name: 'Heroism', duration: '1m' },
      { id: 'cd3', name: 'Rally', duration: '2m' },
    ],
    equipment: [
      { id: 'e1', name: 'Longsword', detail: '+6 to hit, 1d8+3 slashing' },
      { id: 'e2', name: 'Chain Mail', detail: 'AC 16' },
      { id: 'e3', name: 'Shield', detail: 'AC +2' },
    ],
    inventory: [
      { id: 'i1', name: 'Potion of Healing', quantity: 3 },
      { id: 'i2', name: 'Torch', quantity: 8 },
      { id: 'i3', name: 'Rope (50 ft)', quantity: 1 },
    ],
    spells: { cantrips: [], known: [], prepared: [] },
    spellcasting: null,
    gold: 1245,
    carriedWeight: 48.7,
    maxWeight: 120,
  },
};
