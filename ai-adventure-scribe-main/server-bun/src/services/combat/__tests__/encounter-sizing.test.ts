/**
 * #2514 — encounter size scales with campaign difficulty.
 *
 * Run D1 (#2511) put a level-1 Fighter (AC 18, 12 HP) against one +3 creature
 * at a time for 23 turns and lost 3 HP total: the death flow was unreachable.
 * The fix is more creatures on Hard/Deadly, not a hidden to-hit nudge
 * (option 2 in #2514, rejected). These tests pin the builder, the prompt
 * contract, the distinct-name seating, and the tactical placement.
 *
 * Fixture provenance (production producers only):
 * - The monster index is built by the real `buildCampaignMonsterIndex` from
 *   `StatBearingChunk` rows shaped like `campaign-monster-resolution.pg.test.ts`
 *   (`entityName` / `chunkType: 'monster'` / bold-label stat content).
 * - Seating goes through the real `seatCombatEntry` with the database seam
 *   stubbed, the `combat-entry-gate.test.ts` pattern; the stub `startCombat`
 *   records the exact participant inputs `buildEntryParticipants` produced.
 * - The declared attack comes from the real `detectDeclaredAttack`, as in
 *   `combat-entry-first-action-path.test.ts`.
 * - Tactical placement calls the real `generateMap` / `validateGeneratedMap`
 *   with the entity shape `tactical.test.ts` uses.
 */
import { describe, expect, it } from 'bun:test';

import { generateMap, validateGeneratedMap } from '../../../tactical/generator.js';
import { buildCampaignMonsterIndex } from '../campaign-monster-index.js';
import {
  buildEntryParticipants,
  seatCombatEntry,
  synthesizeSceneSpec,
  type CombatEntryGateDeps,
  type CombatEntryParticipantInput,
  type CombatEntryStartResult,
} from '../combat-entry-gate.js';
import { detectDeclaredAttack } from '../combat-intent-gate.js';
import { resolveCombatantStats } from '../combatant-stat-resolution.js';
import {
  buildEncounterSizeDirective,
  expandDerivedCombatants,
  expandParticipantInputs,
  normalizeEncounterDifficulty,
  type EncounterContext,
  type SizedCombatant,
  type SizedParticipantInput,
} from '../encounter-sizing.js';

import type { CampaignMonsterIndex, StatBearingChunk } from '../campaign-monster-index.js';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const USER_ID = 'user_01KAT5E3WFD7NGE3C0TDHX2T5G';

const PLAYER = {
  characterId: 'character-1',
  name: 'Ser Aldous Vane',
  initiativeModifier: 2,
  hpCurrent: 12,
  hpMax: 12,
};

/** Bible chunks: stat block plus the encounter note the bible carries per creature. */
const indexWith = (note: string): CampaignMonsterIndex =>
  buildCampaignMonsterIndex('campaign-2514', [
    {
      entityName: 'Faceless Stalker',
      chunkType: 'monster',
      content: `**Faceless Stalker**\n\n**HP:** 12 **AC:** 13 **Speed:** 30ft\n\n${note}`,
    },
    {
      entityName: 'Gravity Golem',
      chunkType: 'monster',
      content:
        '**Gravity Golem**\n\n**HP:** 40 **AC:** 15 **Speed:** 20ft\n\n**Encounters:** solo',
    },
    {
      entityName: 'Shadow Roach',
      chunkType: 'monster',
      content:
        '**Shadow Roach**\n\n**HP:** 7 **AC:** 13 **Speed:** 30ft\n\n**Encounters:** pack',
    },
    {
      entityName: 'Vitruvian Spider',
      chunkType: 'monster',
      content:
        '**Vitruvian Spider**\n\n**HP:** 22 **AC:** 14 **Speed:** 30ft\n\n**Encounters:** group — the Vitruvian Spider Hatchling brood stays with it',
    },
    {
      entityName: 'Vitruvian Spider Hatchling',
      chunkType: 'monster',
      content: '**Vitruvian Spider Hatchling**\n\n**HP:** 4 **AC:** 12 **Speed:** 20ft',
    },
  ]);

const context = (
  difficulty: EncounterContext['difficulty'],
  note = '',
): EncounterContext => ({
  difficulty,
  difficultyRaw: difficulty,
  index: indexWith(note),
});

describe('normalizeEncounterDifficulty — both campaign dialects', () => {
  it('buckets the starter enum and user free text the same way', () => {
    expect(normalizeEncounterDifficulty('easy')).toBe('easy');
    expect(normalizeEncounterDifficulty('low-medium')).toBe('medium');
    expect(normalizeEncounterDifficulty('medium')).toBe('medium');
    expect(normalizeEncounterDifficulty('medium-hard')).toBe('hard');
    expect(normalizeEncounterDifficulty('Hard')).toBe('hard');
    expect(normalizeEncounterDifficulty('deadly')).toBe('deadly');
    expect(normalizeEncounterDifficulty('Very Hard')).toBe('deadly');
    expect(normalizeEncounterDifficulty(null)).toBeNull();
    expect(normalizeEncounterDifficulty('')).toBeNull();
    expect(normalizeEncounterDifficulty('unrated')).toBeNull();
  });
});

describe('expandDerivedCombatants — the encounter builder rule', () => {
  it('Hard + one named creature → 2 of that kind (run D1 fix)', () => {
    const sized = expandDerivedCombatants<SizedCombatant>(
      [{ name: 'Faceless Stalker', count: 1 }],
      context('hard'),
    );
    expect(sized).toEqual([{ name: 'Faceless Stalker', monsterId: 'Faceless Stalker', count: 2 }]);
  });

  it('Easy keeps 1; Deadly places 3', () => {
    expect(expandDerivedCombatants<SizedCombatant>([{ name: 'Faceless Stalker', count: 1 }], context('easy'))).toEqual(
      [{ name: 'Faceless Stalker', count: 1 }],
    );
    expect(
      expandDerivedCombatants<SizedCombatant>([{ name: 'Faceless Stalker', count: 1 }], context('deadly')),
    ).toEqual([{ name: 'Faceless Stalker', monsterId: 'Faceless Stalker', count: 3 }]);
  });

  it('a bible "solo" note overrides even Deadly to 1', () => {
    expect(expandDerivedCombatants<SizedCombatant>([{ name: 'Gravity Golem', count: 1 }], context('deadly'))).toEqual(
      [{ name: 'Gravity Golem', count: 1 }],
    );
  });

  it('ability text about "a single target" is not a solo note', () => {
    const index = buildCampaignMonsterIndex('campaign-2514', [
      {
        entityName: 'Faceless Stalker',
        chunkType: 'monster',
        content:
          '**Faceless Stalker**\n\n**HP:** 12 **AC:** 13 **Speed:** 30ft\n\n**Shadow Step:** it strikes a single target from the dark.',
      },
    ]);
    expect(
      expandDerivedCombatants<SizedCombatant>([{ name: 'Faceless Stalker', count: 1 }], {
        difficulty: 'hard',
        index,
      }),
    ).toEqual([{ name: 'Faceless Stalker', monsterId: 'Faceless Stalker', count: 2 }]);
  });

  it('a pack note lifts Hard from 2 to 3', () => {
    expect(expandDerivedCombatants<SizedCombatant>([{ name: 'Shadow Roach', count: 1 }], context('hard'))).toEqual(
      [{ name: 'Shadow Roach', monsterId: 'Shadow Roach', count: 3 }],
    );
  });

  it("the bible's stated group fills extra seats before clones do", () => {
    // A "group" note lifts Hard to 3 total: the named hatchling takes the
    // first extra seat, and the last seat tops up with the primary's kind.
    const sized = expandDerivedCombatants<SizedCombatant>(
      [{ name: 'Vitruvian Spider', count: 1 }],
      context('hard'),
    );
    expect(sized).toEqual([
      { name: 'Vitruvian Spider', monsterId: 'Vitruvian Spider', count: 2 },
      { name: 'Vitruvian Spider Hatchling', count: 1 },
    ]);
  });

  it('never reduces a total the DM already authored', () => {
    expect(
      expandDerivedCombatants<SizedCombatant>(
        [
          { name: 'Faceless Stalker', count: 2 },
          { name: 'Shadow Roach', count: 1 },
        ],
        context('easy'),
      ),
    ).toEqual([
      { name: 'Faceless Stalker', count: 2 },
      { name: 'Shadow Roach', count: 1 },
    ]);
  });

  it('a named NPC is never multiplied, even on Hard (Grand Chef Sazón)', () => {
    const index = buildCampaignMonsterIndex('campaign-2514', [
      {
        entityName: 'Grand Chef Sazón',
        chunkType: 'npc_tier1',
        content: '**Grand Chef Sazón**\n\n**HP:** 18 **AC:** 14 **Speed:** 30ft',
      },
    ]);
    expect(
      expandDerivedCombatants<SizedCombatant>([{ name: 'Grand Chef Sazón', count: 1 }], {
        difficulty: 'hard',
        index,
      }),
    ).toEqual([{ name: 'Grand Chef Sazón', count: 1 }]);
  });

  it('an NPC the bible names without a stat block is never multiplied', () => {
    const index = buildCampaignMonsterIndex('campaign-2514', [
      {
        entityName: 'Sister Vola',
        chunkType: 'npc_tier2',
        content: "**Sister Vola**\n\nThe abbey's healer, who keeps the infirmary keys.",
      },
    ]);
    expect(
      expandDerivedCombatants<SizedCombatant>([{ name: 'Sister Vola', count: 1 }], {
        difficulty: 'deadly',
        index,
      }),
    ).toEqual([{ name: 'Sister Vola', count: 1 }]);
  });

  it('a boss-marked creature stays at 1 on Deadly', () => {
    const index = buildCampaignMonsterIndex('campaign-2514', [
      {
        entityName: 'Cinder Golem',
        chunkType: 'monster',
        content:
          '**Cinder Golem**\n\n**HP:** 60 **AC:** 16 **Speed:** 25ft\n\n**Encounters:** boss — a unique named horror; it never fights beside copies of itself.',
      },
    ]);
    expect(
      expandDerivedCombatants<SizedCombatant>([{ name: 'Cinder Golem', count: 1 }], {
        difficulty: 'deadly',
        index,
      }),
    ).toEqual([{ name: 'Cinder Golem', count: 1 }]);
  });

  it('ability text about "a group" is not an encounter note (Hard stays 2, not 3)', () => {
    const index = buildCampaignMonsterIndex('campaign-2514', [
      {
        entityName: 'Faceless Stalker',
        chunkType: 'monster',
        content:
          '**Faceless Stalker**\n\n**HP:** 12 **AC:** 13 **Speed:** 30ft\n\n**Pack Call:** the stalker calls a group of lesser kin to its aid.',
      },
    ]);
    expect(
      expandDerivedCombatants<SizedCombatant>([{ name: 'Faceless Stalker', count: 1 }], {
        difficulty: 'hard',
        index,
      }),
    ).toEqual([{ name: 'Faceless Stalker', monsterId: 'Faceless Stalker', count: 2 }]);
  });

  it("the bible's structured note (group: pack; with: …) seats its stated group", () => {
    const index = buildCampaignMonsterIndex('campaign-2514', [
      {
        entityName: 'Vitruvian Spider',
        chunkType: 'monster',
        content:
          '**Vitruvian Spider**\n\n**HP:** 22 **AC:** 14 **Speed:** 30ft\n\n**Encounters:** group: pack (3); with: Vitruvian Spider Hatchling; morale: holds the doorway',
      },
      {
        entityName: 'Vitruvian Spider Hatchling',
        chunkType: 'monster',
        content: '**Vitruvian Spider Hatchling**\n\n**HP:** 4 **AC:** 12 **Speed:** 20ft',
      },
    ]);
    expect(
      expandDerivedCombatants<SizedCombatant>([{ name: 'Vitruvian Spider', count: 1 }], {
        difficulty: 'hard',
        index,
      }),
    ).toEqual([
      { name: 'Vitruvian Spider', monsterId: 'Vitruvian Spider', count: 2 },
      { name: 'Vitruvian Spider Hatchling', count: 1 },
    ]);
  });

  it("a unique's stated group seats beside it, but the person is never cloned", () => {
    const index = buildCampaignMonsterIndex('campaign-2514', [
      {
        entityName: 'Queen Morvain',
        chunkType: 'npc_tier1',
        content:
          '**Queen Morvain**\n\n**HP:** 30 **AC:** 15 **Speed:** 30ft\n\n**Encounters:** group — the Shadow Roach brood attends her',
      },
      {
        entityName: 'Shadow Roach',
        chunkType: 'monster',
        content: '**Shadow Roach**\n\n**HP:** 7 **AC:** 13 **Speed:** 30ft',
      },
    ]);
    expect(
      expandDerivedCombatants<SizedCombatant>([{ name: 'Queen Morvain', count: 1 }], {
        difficulty: 'hard',
        index,
      }),
    ).toEqual([
      { name: 'Queen Morvain', monsterId: 'Queen Morvain', count: 1 },
      { name: 'Shadow Roach', count: 1 },
    ]);
  });

  it('unknown difficulty changes nothing (pre-#2514 behaviour)', () => {
    expect(
      expandDerivedCombatants<SizedCombatant>([{ name: 'Faceless Stalker', count: 1 }], context(null)),
    ).toEqual([{ name: 'Faceless Stalker', count: 1 }]);
  });
});

describe('the DM prompt receives the count before it narrates (scope 2)', () => {
  it('the sizing directive names every creature, numbered', () => {
    const sized = expandDerivedCombatants<SizedCombatant>(
      [{ name: 'Faceless Stalker', count: 1 }],
      context('hard'),
    );
    const directive = buildEncounterSizeDirective(sized);
    expect(directive).toContain('Encounter size (engine-decided): 2 hostile creatures');
    expect(directive).toContain('Faceless Stalker 1');
    expect(directive).toContain('Faceless Stalker 2');
    expect(directive).toContain('Narrate exactly 2 creatures');
  });

  it('a single creature is named bare, with no invented numbering', () => {
    expect(buildEncounterSizeDirective([{ name: 'Gravity Golem', count: 1 }])).toContain(
      '1 hostile creature — Gravity Golem.',
    );
  });
});

describe('round 3 — the bible typing decides, not the name shape (strategist FIX at 6ee2c524)', () => {
  it('a monster chunk whose name ends in no kind noun still multiplies ("Light-Eater Swarm")', () => {
    const index = buildCampaignMonsterIndex('campaign-2514', [
      {
        entityName: 'Light-Eater Swarm',
        chunkType: 'monster',
        content: '**Light-Eater Swarm**\n\n**HP:** 9 **AC:** 12 **Speed:** 30ft',
      },
      {
        entityName: 'Giant Rats',
        chunkType: 'monster',
        content: '**Giant Rats**\n\n**HP:** 7 **AC:** 12 **Speed:** 30ft',
      },
    ]);
    expect(
      expandDerivedCombatants<SizedCombatant>([{ name: 'Light-Eater Swarm', count: 1 }], {
        difficulty: 'hard',
        index,
      }),
    ).toEqual([{ name: 'Light-Eater Swarm', monsterId: 'Light-Eater Swarm', count: 2 }]);
    expect(
      expandDerivedCombatants<SizedCombatant>([{ name: 'Light-Eater Swarm', count: 1 }], {
        difficulty: 'deadly',
        index,
      }),
    ).toEqual([{ name: 'Light-Eater Swarm', monsterId: 'Light-Eater Swarm', count: 3 }]);
    expect(
      expandDerivedCombatants<SizedCombatant>([{ name: 'Giant Rats', count: 1 }], {
        difficulty: 'hard',
        index,
      }),
    ).toEqual([{ name: 'Giant Rats', monsterId: 'Giant Rats', count: 2 }]);
  });

  it('an explicit swarm note lifts the swarm to 3 on Hard', () => {
    const index = buildCampaignMonsterIndex('campaign-2514', [
      {
        entityName: 'Light-Eater Swarm',
        chunkType: 'monster',
        content:
          '**Light-Eater Swarm**\n\n**HP:** 9 **AC:** 12 **Speed:** 30ft\n\n**Encounters:** swarm',
      },
    ]);
    expect(
      expandDerivedCombatants<SizedCombatant>([{ name: 'Light-Eater Swarm', count: 1 }], {
        difficulty: 'hard',
        index,
      }),
    ).toEqual([{ name: 'Light-Eater Swarm', monsterId: 'Light-Eater Swarm', count: 3 }]);
  });

  it('a monster chunk carrying a parenthetical name still multiplies ("Flavor-Elemental (Corrupted)")', () => {
    const index = buildCampaignMonsterIndex('campaign-2514', [
      {
        entityName: 'Flavor-Elemental (Corrupted)',
        chunkType: 'monster',
        content: '**Flavor-Elemental (Corrupted)**\n\n**HP:** 33 **AC:** 14 **Speed:** 30ft',
      },
    ]);
    expect(
      expandDerivedCombatants<SizedCombatant>([{ name: 'Flavor-Elemental (Corrupted)', count: 1 }], {
        difficulty: 'hard',
        index,
      }),
    ).toEqual([
      { name: 'Flavor-Elemental (Corrupted)', monsterId: 'Flavor-Elemental (Corrupted)', count: 2 },
    ]);
  });

  it('a DM-invented person with a title stays 1 even with no bible entry ("Captain Sarah Reeves")', () => {
    const index = buildCampaignMonsterIndex('campaign-2514', []);
    expect(
      expandDerivedCombatants<SizedCombatant>([{ name: 'Captain Sarah Reeves', count: 1 }], {
        difficulty: 'hard',
        index,
      }),
    ).toEqual([{ name: 'Captain Sarah Reeves', count: 1 }]);
  });

  it('a DM-invented person with an epithet stays 1 ("Kaelen the Warlock")', () => {
    const index = buildCampaignMonsterIndex('campaign-2514', []);
    const sized = expandParticipantInputs(
      [
        { name: 'Ser Aldous Vane', characterId: 'character-1' },
        { name: 'Kaelen the Warlock' },
      ],
      { difficulty: 'deadly', index },
    );
    expect(sized.map((seat) => seat.name)).toEqual(['Ser Aldous Vane', 'Kaelen the Warlock']);
  });

  it('an npc_ chunk stays 1 even when its name ends in a kind noun ("Brother Wolf")', () => {
    const index = buildCampaignMonsterIndex('campaign-2514', [
      {
        entityName: 'Brother Wolf',
        chunkType: 'npc_tier1',
        content: '**Brother Wolf**\n\n**HP:** 27 **AC:** 14 **Speed:** 30ft',
      },
    ]);
    expect(
      expandDerivedCombatants<SizedCombatant>([{ name: 'Brother Wolf', count: 1 }], {
        difficulty: 'deadly',
        index,
      }),
    ).toEqual([{ name: 'Brother Wolf', count: 1 }]);
  });
});

describe('round 4 — the index entry outranks the blockless-NPC bio (strategist FIX at 5988385742)', () => {
  // The pair buildCampaignMonsterIndex's own comment names: the bible
  // carries both a blockless NPC bio ("The Flavor-Elemental (Corrupted)",
  // npc_tier1, no stats) and a monster of the same normalized name
  // ("Flavor-Elemental (Corrupted)", monster, HP 33 / AC 14). The chunker
  // emits NPC chunks before bestiary chunks, so the bio loads first and
  // lands in blocklessNpcs while the monster entry still files byKey.
  const siblingRows = (): StatBearingChunk[] => [
    {
      entityName: 'The Flavor-Elemental (Corrupted)',
      chunkType: 'npc_tier1',
      content:
        '**The Flavor-Elemental (Corrupted)**\n\nA corrupted spirit of the kitchen, once a guardian of the hearth.',
    },
    {
      entityName: 'Flavor-Elemental (Corrupted)',
      chunkType: 'monster',
      content: '**Flavor-Elemental (Corrupted)**\n\n**HP:** 33 **AC:** 14 **Speed:** 30ft',
    },
  ];

  it('a monster with a blockless-NPC bio sibling still multiplies (chunker order)', () => {
    const index = buildCampaignMonsterIndex('campaign-2514', siblingRows());
    // Sanity: both rows filed where the fix expects them.
    expect(index.blocklessNpcs.size).toBe(1);
    expect(
      expandDerivedCombatants<SizedCombatant>(
        [{ name: 'Flavor-Elemental (Corrupted)', count: 1 }],
        { difficulty: 'hard', index },
      ),
    ).toEqual([
      {
        name: 'Flavor-Elemental (Corrupted)',
        monsterId: 'Flavor-Elemental (Corrupted)',
        count: 2,
      },
    ]);
    expect(
      expandDerivedCombatants<SizedCombatant>(
        [{ name: 'Flavor-Elemental (Corrupted)', count: 1 }],
        { difficulty: 'deadly', index },
      ),
    ).toEqual([
      {
        name: 'Flavor-Elemental (Corrupted)',
        monsterId: 'Flavor-Elemental (Corrupted)',
        count: 3,
      },
    ]);
  });

  it('the same pair in reverse row order still multiplies', () => {
    const index = buildCampaignMonsterIndex('campaign-2514', [...siblingRows()].reverse());
    expect(
      expandDerivedCombatants<SizedCombatant>(
        [{ name: 'Flavor-Elemental (Corrupted)', count: 1 }],
        { difficulty: 'hard', index },
      ),
    ).toEqual([
      {
        name: 'Flavor-Elemental (Corrupted)',
        monsterId: 'Flavor-Elemental (Corrupted)',
        count: 2,
      },
    ]);
  });
});

describe('round 3 — sized seats keep the primary\u2019s bible stat block (strategist FIX at 6ee2c524)', () => {
  it('numbered seats of a name-only bible creature resolve campaign stats, not the generic rung', () => {
    const { index } = context('hard');
    const sized = expandDerivedCombatants<SizedCombatant>([{ name: 'Faceless Stalker', count: 1 }], {
      difficulty: 'hard',
      index,
    });
    const participants = buildEntryParticipants(PLAYER, sized);
    const hostiles = participants.filter((seat) => !seat.characterId);
    expect(hostiles.map((seat) => seat.name)).toEqual(['Faceless Stalker 1', 'Faceless Stalker 2']);
    for (const seat of hostiles) {
      expect(seat.monsterId).toBe('Faceless Stalker');
      const stats = resolveCombatantStats(index, seat.monsterId, seat.name);
      expect(stats?.source).toBe('campaign');
      expect(stats?.maxHp).toBe(12);
      expect(stats?.armorClass).toBe(13);
    }
  });
});

describe('expandParticipantInputs — the startCombat backstop', () => {
  it('clones hostiles to the sized total with distinct names; the PC is never cloned', () => {
    const sized = expandParticipantInputs(
      [
        { name: 'Ser Aldous Vane', characterId: 'character-1' },
        { name: 'Faceless Stalker', monsterId: 'faceless-stalker' },
      ],
      context('hard'),
    );
    expect(sized.map((seat) => seat.name)).toEqual([
      'Ser Aldous Vane',
      'Faceless Stalker 1',
      'Faceless Stalker 2',
    ]);
  });

  it('never clones a seat that carries an npcId; the id stays unique', () => {
    const sized = expandParticipantInputs(
      [
        { name: 'Ser Aldous Vane', characterId: 'character-1' },
        { name: 'Captain Sarah Reeves', npcId: 'npc-reeves' },
      ],
      context('hard'),
    );
    const hostiles = sized.filter((seat) => !seat.characterId);
    expect(hostiles).toHaveLength(1);
    expect(hostiles[0]).toMatchObject({ name: 'Captain Sarah Reeves', npcId: 'npc-reeves' });
  });

  it('never clones even a creature-kind seat once it carries an npcId', () => {
    // A named individual of a generic kind, seated by id: multiplying it
    // would seat the same person twice and pool their HP under one id.
    const sized = expandParticipantInputs(
      [
        { name: 'Ser Aldous Vane', characterId: 'character-1' },
        { name: 'Faceless Stalker', monsterId: 'faceless-stalker', npcId: 'npc-stalker-1' },
      ],
      context('hard'),
    );
    const hostiles = sized.filter((seat) => !seat.characterId);
    expect(hostiles).toHaveLength(1);
    expect(hostiles[0]).toMatchObject({ name: 'Faceless Stalker', npcId: 'npc-stalker-1' });
  });

  it('spawned seats get their own identity: no shared npcId, distinct names', () => {
    const sized = expandParticipantInputs(
      [
        { name: 'Ser Aldous Vane', characterId: 'character-1' },
        { name: 'Faceless Stalker', monsterId: 'faceless-stalker' },
      ],
      context('deadly'),
    );
    const hostiles = sized.filter((seat) => !seat.characterId);
    expect(hostiles.map((seat) => seat.name)).toEqual([
      'Faceless Stalker 1',
      'Faceless Stalker 2',
      'Faceless Stalker 3',
    ]);
    // Every spawned seat is its own participant: no two seats share an
    // identity the HP pool could be keyed on.
    const npcIdOf = (seat: object): string | null =>
      (seat as { npcId?: string | null }).npcId ?? null;
    for (const seat of hostiles) expect(npcIdOf(seat)).toBeNull();
  });

  it('stamps the bible heading as monsterId so numbered seats resolve campaign stats (Sheet Strike path, strategist FIX at 5988385742)', () => {
    const { index } = context('hard');
    const sized = expandParticipantInputs<SizedParticipantInput>(
      [
        { name: 'Ser Aldous Vane', characterId: 'character-1' },
        { name: 'Faceless Stalker' },
      ],
      { difficulty: 'hard', index },
    );
    const hostiles = sized.filter((seat) => !seat.characterId);
    expect(hostiles.map((seat) => seat.name)).toEqual(['Faceless Stalker 1', 'Faceless Stalker 2']);
    // Removing the primary stamp (encounter-sizing.ts ~454-455) leaves the
    // first seat with no monsterId, so this fails on revert.
    for (const seat of hostiles) {
      expect(seat.monsterId).toBe('Faceless Stalker');
      const stats = resolveCombatantStats(index, seat.monsterId, seat.name);
      expect(stats?.source).toBe('campaign');
      expect(stats?.maxHp).toBe(12);
      expect(stats?.armorClass).toBe(13);
    }
  });
});

function stubDeps(encounterContext: EncounterContext): {
  deps: CombatEntryGateDeps;
  started: CombatEntryParticipantInput[][];
} {
  const started: CombatEntryParticipantInput[][] = [];
  const deps: CombatEntryGateDeps = {
    getActiveEncounter: async () => undefined,
    verifySessionOwnership: async () => ({ success: true }),
    startCombat: async (_sessionId, participants) => {
      started.push(participants);
      const seated = participants.map((participant, index) => ({
        id: `participant-${index}`,
        name: participant.name,
        initiative: 10 - index,
        initiativeModifier: participant.initiativeModifier,
        characterId: participant.characterId ?? null,
        turnOrder: index,
      }));
      return {
        encounter: { id: 'encounter-1' },
        participants: seated,
        participantSizes: {},
        turnOrder: seated.map((participant, index) => ({
          participant: { ...participant, participantType: index === 0 ? 'player' : 'monster' },
          isCurrent: index === 0,
          hasGone: false,
        })),
        currentParticipant: seated[0] ?? null,
      } satisfies CombatEntryStartResult;
    },
    createTacticalCombatMap: async () => ({}),
    sanitizeSceneSpec: (raw) => ({ ok: true, sceneSpec: raw as never, overrides: [] }),
    trackCombatEvent: () => undefined,
    persistSessionMessage: async () => undefined,
    publishCombatState: async () => undefined,
    loadEncounterContext: async () => encounterContext,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
  return { deps, started };
}

describe('seatCombatEntry — declared attack seats the sized encounter', () => {
  const declaredAttack = detectDeclaredAttack('I attack the Faceless Stalker with my longsword', [
    { name: 'Faceless Stalker', actorSlug: 'faceless-stalker' },
  ]);

  it('the real detector reads the declaration', () => {
    expect(declaredAttack?.actorName).toBe('Faceless Stalker');
  });

  it('Hard seats 2 stalkers with distinct names; the player is seated once', async () => {
    const { deps, started } = stubDeps(context('hard'));
    await seatCombatEntry(
      {
        sessionId: SESSION_ID,
        userId: USER_ID,
        player: PLAYER,
        combatants: [{ name: 'Faceless Stalker', count: 1 }],
        sceneSpec: synthesizeSceneSpec(SESSION_ID),
        trigger: 'player_intent',
        detail: 'player declared an attack on Faceless Stalker',
        declaredAttack: declaredAttack ?? undefined,
      },
      deps,
    );
    expect(started).toHaveLength(1);
    expect(started[0]!.map((seat) => seat.name)).toEqual([
      'Ser Aldous Vane',
      'Faceless Stalker 1',
      'Faceless Stalker 2',
    ]);
  });

  it('Easy seats exactly 1', async () => {
    const { deps, started } = stubDeps(context('easy'));
    await seatCombatEntry(
      {
        sessionId: SESSION_ID,
        userId: USER_ID,
        player: PLAYER,
        combatants: [{ name: 'Faceless Stalker', count: 1 }],
        sceneSpec: synthesizeSceneSpec(SESSION_ID),
        trigger: 'player_intent',
        detail: 'player declared an attack on Faceless Stalker',
        declaredAttack: declaredAttack ?? undefined,
      },
      deps,
    );
    expect(started[0]!.map((seat) => seat.name)).toEqual(['Ser Aldous Vane', 'Faceless Stalker']);
  });
});

describe('tactical placement — 2-3 tokens, not stacked (scope 4)', () => {
  const enemy = (id: string) => ({
    id,
    x: 0,
    y: 0,
    size: 'medium' as const,
    type: 'monster' as const,
    speedFeet: 30,
    movementRemaining: 30,
  });

  it('places three hostiles on distinct cells at sensible distances', () => {
    for (const enemyPlacement of ['guarding', 'formation', 'ambush'] as const) {
      const map = generateMap({
        environment: 'dungeon_room',
        size: 'medium',
        seed: 7,
        enemyPlacement,
        enemyEntities: [enemy('stalker-1'), enemy('stalker-2'), enemy('stalker-3')],
        pcEntities: [
          {
            id: 'pc-1',
            x: 1,
            y: 1,
            size: 'medium' as const,
            type: 'pc' as const,
            speedFeet: 30,
            movementRemaining: 30,
          },
        ],
      });
      const hostiles = map.entities.filter((entity) => entity.type === 'monster');
      expect(hostiles).toHaveLength(3);
      const cells = hostiles.map((entity) => `${entity.x},${entity.y}`);
      expect(new Set(cells).size).toBe(3);
      for (let i = 0; i < hostiles.length; i += 1) {
        for (let j = i + 1; j < hostiles.length; j += 1) {
          const distance = Math.max(
            Math.abs(hostiles[i]!.x - hostiles[j]!.x),
            Math.abs(hostiles[i]!.y - hostiles[j]!.y),
          );
          // Non-stacked and not shoulder-to-shoulder: at least 10ft apart.
          expect(distance).toBeGreaterThanOrEqual(2);
        }
      }
      expect(validateGeneratedMap(map).entitiesValid).toBe(true);
    }
  });

  it('keeps 2-3 hostiles inside the single-hostile reach band, non-stacked', () => {
    const place = (enemyPlacement: 'guarding' | 'formation' | 'ambush', count: number) =>
      generateMap({
        environment: 'dungeon_room',
        size: 'medium',
        seed: 7,
        enemyPlacement,
        enemyEntities: Array.from({ length: count }, (_, i) => enemy(`stalker-${i + 1}`)),
        pcEntities: [
          {
            id: 'pc-1',
            x: 1,
            y: 1,
            size: 'medium' as const,
            type: 'pc' as const,
            speedFeet: 30,
            movementRemaining: 30,
          },
        ],
      });
    const chebyshev = (
      a: { x: number; y: number },
      b: { x: number; y: number },
    ): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

    for (const enemyPlacement of ['guarding', 'formation', 'ambush'] as const) {
      const single = place(enemyPlacement, 1);
      const entry = single.entities.find((entity) => entity.type === 'pc')!;
      const singleHostile = single.entities.find((entity) => entity.type === 'monster')!;
      // The band the single-hostile placement uses at this seed. Formation /
      // ambush anchors step 2 cells per extra token toward the entry (at
      // most 4 closer with 3 tokens); the guarding spread reaches at most 2
      // farther. Anything outside that band — or unreachable, or stacked —
      // means sizing changed where creatures stand, not just how many.
      const band = chebyshev(entry, singleHostile);
      for (const count of [2, 3]) {
        const map = place(enemyPlacement, count);
        const hostiles = map.entities.filter((entity) => entity.type === 'monster');
        expect(hostiles).toHaveLength(count);
        const cells = new Set(hostiles.map((entity) => `${entity.x},${entity.y}`));
        expect(cells.size).toBe(count);
        for (const hostile of hostiles) {
          const distance = chebyshev(entry, hostile);
          expect(distance).toBeLessThanOrEqual(band + 2);
          expect(distance).toBeGreaterThanOrEqual(Math.max(2, band - 4));
        }
        const validation = validateGeneratedMap(map);
        expect(validation.entitiesValid).toBe(true);
        expect(validation.connected).toBe(true);
      }
    }
  });
});
