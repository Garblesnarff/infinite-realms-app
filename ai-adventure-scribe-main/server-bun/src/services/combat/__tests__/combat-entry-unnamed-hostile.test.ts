/**
 * #2532 — a hostile the DM left unnamed is named from the campaign's creatures or the turn's
 * prose, or dropped. The combatants come from `deriveEntryCombatants`, the real producer, so the
 * placeholder is the literal it emits.
 */
import { describe, expect, it } from 'bun:test';

import {
  CHITINOUS_HUNTER_PROSE,
  UNNAMED_THREAT_PROSE,
} from '../../../../../shared/test-fixtures/unnamed-hostile-entry';
import { buildCampaignMonsterIndex, emptyCampaignMonsterIndex } from '../campaign-monster-index.js';
import { deriveEntryCombatants, type DerivedCombatant } from '../combat-entry-gate.js';
import { nameUnresolvedCombatants } from '../combat-entry-unnamed-hostile.js';

const PLAYER = 'The Storyteller';

const index = buildCampaignMonsterIndex('abyssal-descent', [
  { entityName: 'Chitinous Hunter', chunkType: 'monster', content: 'AC 14 HP 30' },
  { entityName: 'Light-Eater Swarm', chunkType: 'monster', content: 'AC 12 HP 20' },
]);

/** What `deriveEntryCombatants` returns for a `start` reply that lists nobody. */
const unnamed = (): DerivedCombatant[] =>
  deriveEntryCombatants({ combat_transition: 'start' } as never, PLAYER);

const name = (
  combatants: DerivedCombatant[],
  prose: string,
  campaign = index,
): Promise<DerivedCombatant[]> =>
  nameUnresolvedCombatants({
    combatants,
    prose,
    playerName: PLAYER,
    loadIndex: async () => campaign,
  });

describe('nameUnresolvedCombatants', () => {
  it('starts from the placeholder the gate emits', () => {
    expect(unnamed()).toEqual([{ name: 'Hostile Creature', count: 1 }]);
  });

  it('names the creature from the campaign index when the prose names it', async () => {
    expect(await name(unnamed(), CHITINOUS_HUNTER_PROSE)).toEqual([
      { name: 'Chitinous Hunter', count: 1 },
    ]);
  });

  it('names the creature from the DM monster_id, whatever the prose says', async () => {
    const combatants = unnamed().map((combatant) => ({
      ...combatant,
      monsterId: 'light-eater-swarm',
    }));
    expect(await name(combatants, UNNAMED_THREAT_PROSE)).toEqual([
      { name: 'Light-Eater Swarm', monsterId: 'light-eater-swarm', count: 1 },
    ]);
  });

  it('names the creature from the prose alone when the campaign has no index', async () => {
    expect(await name(unnamed(), CHITINOUS_HUNTER_PROSE, emptyCampaignMonsterIndex(''))).toEqual([
      { name: 'Chitinous Hunter', count: 1 },
    ]);
  });

  it('keeps the count of the combatant it names', async () => {
    const combatants = unnamed().map((combatant) => ({ ...combatant, count: 3 }));
    expect(await name(combatants, CHITINOUS_HUNTER_PROSE)).toEqual([
      { name: 'Chitinous Hunter', count: 3 },
    ]);
  });

  it('returns nobody when neither the index nor the prose names a creature', async () => {
    expect(await name(unnamed(), UNNAMED_THREAT_PROSE)).toEqual([]);
    expect(await name(unnamed(), UNNAMED_THREAT_PROSE, emptyCampaignMonsterIndex(''))).toEqual([]);
  });

  it('never reads a name out of the option menu or across lines', async () => {
    const menu = [
      'Your shout echoes. Something stirs in the dark.',
      '',
      'A. Consult the Iron Spike',
      'B. Light the Torch Quickly',
      'C. Retreat to the Gate',
    ].join('\n');
    expect(await name(unnamed(), menu, emptyCampaignMonsterIndex(''))).toEqual([]);
    expect(await name(unnamed(), `**A.** Attack the guard\n${menu}`)).toEqual([]);
  });

  it('still finds the creature the narration names when an option menu follows it', async () => {
    const prose = `${CHITINOUS_HUNTER_PROSE}\n\nA. Fight\nB. Flee`;
    expect(await name(unnamed(), prose)).toEqual([{ name: 'Chitinous Hunter', count: 1 }]);
  });

  it('does not take scenery or a capitalised phrase for the enemy', async () => {
    const prose = 'Professor Darkwater stammers as the Iron Door creaks.';
    expect(await name(unnamed(), prose, emptyCampaignMonsterIndex(''))).toEqual([]);
  });

  it('does not make a campaign NPC the enemy because the prose names it', async () => {
    const withNpcs = buildCampaignMonsterIndex('abyssal-descent', [
      { entityName: 'Chitinous Hunter', chunkType: 'monster', content: 'AC 14 HP 30' },
      { entityName: 'Elder Mira', chunkType: 'npc_tier2', content: 'Voice: soft. Goal: peace.' },
      { entityName: 'Captain Sarah Reeves', chunkType: 'npc_tier1', content: 'AC 16 HP 40' },
    ]);
    const prose = 'Elder Mira watches you shout while Captain Sarah Reeves folds her arms.';
    expect(await name(unnamed(), prose, withNpcs)).toEqual([]);
    expect(await name(unnamed(), `${prose} A chitinous hunter hisses.`, withNpcs)).toEqual([
      { name: 'Chitinous Hunter', count: 1 },
    ]);
  });

  describe('a bare role noun is not a creature (strategist FIX, round 2)', () => {
    const withReeves = buildCampaignMonsterIndex('abyssal-descent', [
      { entityName: 'Chitinous Hunter', chunkType: 'monster', content: 'AC 14 HP 30' },
      { entityName: 'Captain Sarah Reeves', chunkType: 'npc_tier1', content: 'AC 16 HP 40' },
    ]);

    it.each([
      'The captain folds her arms. Something shifts in the dark.',
      'You grip the guard rail as something shifts in the dark.',
      'A giant crack runs through the wall.',
      "The hunter's mark glows on the wall.",
      'The old captain watches you shout.',
    ])('defers on "%s" beside the NPC Captain Sarah Reeves', async (prose) => {
      expect(await name(unnamed(), prose, withReeves)).toEqual([]);
    });

    it.each([
      'The captain folds her arms.',
      'You grip the guard rail.',
      'A giant crack runs through the wall.',
    ])('defers on "%s" when the campaign has no NPC either', async (prose) => {
      expect(await name(unnamed(), prose, emptyCampaignMonsterIndex(''))).toEqual([]);
    });

    it('skips the role noun and names the creature a later phrase describes', async () => {
      const prose = 'The captain stands back as a chitinous hunter drops from the ceiling.';
      expect(await name(unnamed(), prose, withReeves)).toEqual([
        { name: 'Chitinous Hunter', count: 1 },
      ]);
    });

    it('still names a role noun that carries a modifier, and a bare creature-kind noun', async () => {
      const none = emptyCampaignMonsterIndex('');
      expect(await name(unnamed(), 'An ogre captain bars the way.', none)).toEqual([
        { name: 'Ogre Captain', count: 1 },
      ]);
      expect(await name(unnamed(), 'The dragon rears up.', none)).toEqual([
        { name: 'Dragon', count: 1 },
      ]);
    });

    it('names a role noun that the campaign itself lists as a creature', async () => {
      const withGuard = buildCampaignMonsterIndex('abyssal-descent', [
        { entityName: 'Guard', chunkType: 'monster', content: 'AC 16 HP 11' },
        ...[{ entityName: 'Captain Sarah Reeves', chunkType: 'npc_tier1', content: 'AC 16' }],
      ]);
      expect(await name(unnamed(), 'The guard draws steel.', withGuard)).toEqual([
        { name: 'Guard', count: 1 },
      ]);
    });
  });

  it('names a placeholder from its SRD monster_id when the campaign has no such creature', async () => {
    const combatants = [{ name: 'Enemy 1', monsterId: 'srd:goblin', count: 2 }];
    expect(await name(combatants, UNNAMED_THREAT_PROSE, emptyCampaignMonsterIndex(''))).toEqual([
      { name: 'Goblin', monsterId: 'srd:goblin', count: 2 },
    ]);
  });

  it('does not take a generic noun as a name', async () => {
    expect(await name(unnamed(), 'You hear a creature shuffle closer.')).toEqual([]);
  });

  it('never names the hostile after the player', async () => {
    const prose = 'The Storyteller shouts into the dark and nothing answers.';
    expect(await name(unnamed(), prose)).toEqual([]);
    expect(
      await nameUnresolvedCombatants({
        combatants: unnamed(),
        prose: 'The Chitinous Hunter circles.',
        playerName: 'Chitinous Hunter',
        loadIndex: async () => index,
      }),
    ).toEqual([]);
  });

  it('drops a placeholder nothing names and keeps the creatures already named', async () => {
    const combatants = [
      { name: 'Unknown creature', count: 1 },
      { name: 'Shadow Guard', count: 1 },
    ];
    expect(await name(combatants, UNNAMED_THREAT_PROSE)).toEqual([
      { name: 'Shadow Guard', count: 1 },
    ]);
  });

  it('gives two placeholders two different creatures, never the same one twice', async () => {
    const prose = `${CHITINOUS_HUNTER_PROSE} A Light-Eater Swarm boils out of the wall.`;
    expect(
      await name(
        [
          { name: 'Enemy', count: 1 },
          { name: 'Enemy', count: 1 },
        ],
        prose,
      ),
    ).toEqual([
      { name: 'Chitinous Hunter', count: 1 },
      { name: 'Light-Eater Swarm', count: 1 },
    ]);
  });

  it('does not read the index when every combatant is already named', async () => {
    const combatants = [{ name: 'Dishwasher Prime', count: 1 }];
    const result = await nameUnresolvedCombatants({
      combatants,
      prose: UNNAMED_THREAT_PROSE,
      playerName: PLAYER,
      loadIndex: async () => {
        throw new Error('the index must not be read');
      },
    });
    expect(result).toEqual(combatants);
  });
});
