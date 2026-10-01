/**
 * #2398: an NPC with no authored block fights on HP-derived numbers, not on +0, and a
 * campaign creature carries the bible's heading rather than the DM's label.
 *
 * Fixtures follow their real producers. The scene attack is what `resolveSceneCombatant`
 * returns for Captain Sarah Reeves' scene text (source `role`, `attackBonus: 0`, the exact
 * value that produced +0 in run 16). The Academy creature is resolved by
 * `resolveCombatantStats` from a chunk parsed by the real `parseAuthoredStatBlock`.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

type LogPayload = Record<string, unknown>;

const warn = mock((_payload: LogPayload) => {});
const info = mock((_payload: LogPayload) => {});
const debug = mock((_payload: LogPayload) => {});

mock.module('../../../lib/logger.js', () => ({
  logger: { warn, info, debug, error: mock((_payload: LogPayload) => {}) },
}));

const { resolveSceneCombatant } = await import('../../../tactical/seating.js');
const { parseAuthoredStatBlock, gradeCoverage } = await import('../authored-stat-block-parser.js');
const { assignBestiaryDisplayNames, bestiaryDisplayName, resolveCombatantStats } =
  await import('../combatant-stat-resolution.js');
const { buildCampaignMonsterIndex } = await import('../campaign-monster-index.js');
const { scaleMonsterForParty } = await import('../party-scaling.js');
const { displayNameFromRoster, rosterEntryForParticipant } =
  await import('../../../../../shared/engine-display-name.js');
const { deriveNpcFallbackProfile, logNpcStatFallback, NPC_DEFAULT_MAX_HP } =
  await import('../npc-stat-fallback.js');
const { deriveAttackFromHitPoints } = await import('../monster-attack-profile.js');
const { normalizeMonsterKey } = await import('../monster-key.js');

import type { CampaignMonsterIndex } from '../campaign-monster-index.js';
import type { MonsterAttackProfile } from '../monster-attack-profile.js';

const indexOf = (entries: Record<string, string>): CampaignMonsterIndex => {
  const byKey = new Map();
  for (const [entityName, content] of Object.entries(entries)) {
    const parsed = parseAuthoredStatBlock(content);
    byKey.set(normalizeMonsterKey(entityName), {
      entityName,
      chunkType: 'monster',
      parsed,
      coverage: gradeCoverage(parsed),
    });
  }
  return { campaignId: 'academy-of-arcane-gastronomy', byKey, chunkCount: byKey.size };
};

const ACADEMY = indexOf({
  'Flavor-Elemental (Corrupted)':
    '**Flavor-Elemental (Corrupted)**\n\n*HP:* 80, *AC:* 14.\n*Attack:* +3 to hit, 2d8+2 psychic',
});

const reevesScene = () =>
  resolveSceneCombatant({
    candidateName: 'Captain Sarah Reeves',
    sceneDescription: 'Captain Sarah Reeves levels her blade at you.',
  }).attackProfile ?? null;

beforeEach(() => {
  warn.mockClear();
  info.mockClear();
  debug.mockClear();
});

describe('NPC with no authored block', () => {
  test('the scene weapon it would otherwise fight with is the +0 profile', () => {
    const grounded = reevesScene();
    expect(grounded?.attacks[0]).toMatchObject({
      name: 'Longsword',
      attackBonus: 0,
      damageBonus: 0,
    });
  });

  test('fights on a non-zero to-hit and HP-derived damage, keeping the weapon', () => {
    const { profile, seat } = deriveNpcFallbackProfile({
      npcId: null,
      npcName: 'Captain Sarah Reeves',
      knownMaxHp: 45,
      grounded: reevesScene(),
    });
    const house = deriveAttackFromHitPoints(45);

    expect(profile.source).toBe('derived');
    expect(profile.attacks).toHaveLength(1);
    const [attack] = profile.attacks;
    expect(attack.name).toBe('Longsword');
    expect(attack.attackBonus).toBe(house.attackBonus);
    expect(attack.attackBonus).toBeGreaterThan(0);
    expect(attack.damageDice).toBe(house.damageDice);
    expect(attack.damageBonus).toBe(house.damageBonus);
    expect(attack.damageType).toBe('slashing');
    expect(profile.derivation?.fromMaxHp).toBe(45);
    expect(seat.reason).toBe('no_authored_block_hp_derived');
  });

  test('derivation reads the HP it is given, so a caller that passes raw HP gets the raw band', () => {
    // 100 raw HP is CR 2 (17/round); the same NPC scaled for a solo party is 25 HP, CR 1/8.
    // The derivation must not be fed the scaled figure (party-scaling.ts scales it afterwards).
    const raw = deriveNpcFallbackProfile({ npcName: 'Holt', knownMaxHp: 100, grounded: null });
    const scaledFirst = deriveNpcFallbackProfile({
      npcName: 'Holt',
      knownMaxHp: 25,
      grounded: null,
    });
    expect(raw.profile.derivation?.challengeRating).toBe('2');
    expect(scaledFirst.profile.derivation?.challengeRating).toBe('1/8');
    const solo = scaleMonsterForParty({
      rawMaxHp: 100,
      rawCurrentHp: 100,
      attackProfile: raw.profile,
      partySize: 1,
    });
    expect(solo.maxHp).toBe(25);
    expect(solo.attackProfile?.partyScaling).toMatchObject({ rawMaxHp: 100, scaledMaxHp: 25 });
    expect(solo.attackProfile?.derivation?.fromMaxHp).toBe(100);
  });

  test('logs NPC_STAT_FALLBACK once for the encounter, however many seats fell back', () => {
    const seats = ['Captain Sarah Reeves', 'Guard', 'Another Guard'].map(
      (npcName, index) =>
        deriveNpcFallbackProfile({
          npcId: index === 0 ? 'npc-reeves' : null,
          npcName,
          knownMaxHp: index === 0 ? 45 : null,
          grounded: null,
        }).seat,
    );
    logNpcStatFallback('enc-1', seats);
    const fallbackLogs = warn.mock.calls.filter(([p]) => p.msg === 'NPC_STAT_FALLBACK');
    expect(fallbackLogs).toHaveLength(1);
    expect(fallbackLogs[0]![0]).toMatchObject({
      encounterId: 'enc-1',
      npcId: 'npc-reeves',
      reason: 'no_authored_block_hp_derived',
    });
    expect((fallbackLogs[0]![0].seats as LogPayload[]).map((seat) => seat.npcName)).toEqual([
      'Captain Sarah Reeves',
      'Guard',
      'Another Guard',
    ]);
  });

  test('no seat, no log', () => {
    logNpcStatFallback('enc-1', []);
    expect(warn.mock.calls.filter(([p]) => p.msg === 'NPC_STAT_FALLBACK')).toHaveLength(0);
  });

  test('with no HP anywhere it uses the documented default and says so', () => {
    const { profile, seat } = deriveNpcFallbackProfile({
      npcName: 'Quill',
      knownMaxHp: null,
      grounded: null,
    });
    const house = deriveAttackFromHitPoints(NPC_DEFAULT_MAX_HP);
    expect(NPC_DEFAULT_MAX_HP).toBe(20);
    expect(profile.attacks[0]).toMatchObject({
      name: 'strike',
      attackBonus: house.attackBonus,
      damageDice: house.damageDice,
    });
    expect(profile.attacks[0]!.attackBonus).toBeGreaterThan(0);
    expect(seat).toMatchObject({ reason: 'no_authored_block_default_hp', npcId: null });
  });

  test('a ranged scene weapon keeps its range', () => {
    const grounded = resolveSceneCombatant({
      candidateName: 'Warden Ash',
      sceneDescription: 'Warden Ash draws a longbow.',
    }).attackProfile!;
    const [attack] = deriveNpcFallbackProfile({
      npcName: 'Warden Ash',
      knownMaxHp: 30,
      grounded,
    }).profile.attacks;
    expect(attack.ranged).toBe(true);
    expect(attack.normalRange).toBe(grounded.attacks[0]!.normalRange);
  });
});

describe('campaign index: NPC chunks', () => {
  const chunk = (entityName: string, chunkType: string, content: string) => ({
    entityName,
    chunkType,
    content,
  });
  const REEVES = [
    '**2. Captain Sarah Reeves** (Human Fighter) - Stoic, scarred, pragmatic.',
    '*   **Voice:** Low, raspy.',
    '*   *HP:* 45, *AC:* 15 (chain shirt).',
    '*   *Attack:* +3 to hit, 1d8 slashing (longsword)',
  ].join('\n');
  const BIO =
    '**Quill** (Human Scribe) - Nervous.\n*   **Voice:** Whispers.\n*   **Goal:** Finish.';

  test('an NPC entry with a block resolves on its authored numbers', () => {
    const index = buildCampaignMonsterIndex('abyssal-descent', [
      chunk('Captain Sarah Reeves', 'npc_tier1', REEVES),
    ]);
    const resolved = resolveCombatantStats(index, null, 'Captain Sarah Reeves');
    expect(resolved).toMatchObject({ source: 'campaign', maxHp: 45, armorClass: 15 });
    expect(resolved?.attackProfile.source).toBe('authored');
    expect(resolved?.attackProfile.attacks[0]).toMatchObject({
      attackBonus: 3,
      damageDice: '1d8',
      damageType: 'slashing',
    });
  });

  test('an NPC bio with no block is not indexed, so it cannot hide the SRD rung', () => {
    const index = buildCampaignMonsterIndex('academy', [
      chunk('Quill', 'npc_tier1', BIO),
      chunk('Goblin', 'npc_tier2', BIO),
    ]);
    expect(index.byKey.size).toBe(0);
    expect(resolveCombatantStats(index, 'srd:goblin', 'Goblin')?.source).toBe('srd');
  });

  test('a chunk that reads as nothing never displaces an entry that has a block', () => {
    const npc = chunk('Captain Sarah Reeves', 'npc_tier1', REEVES);
    const emptyMonster = chunk(
      'Captain Sarah Reeves',
      'monster',
      '**Captain Sarah Reeves**\nA bio.',
    );
    const index = buildCampaignMonsterIndex('abyssal-descent', [npc, emptyMonster]);
    expect(resolveCombatantStats(index, null, 'Captain Sarah Reeves')).toMatchObject({
      maxHp: 45,
      armorClass: 15,
    });
  });

  test('a bestiary entry outranks an NPC entry of the same normalized name, in either order', () => {
    const monster = chunk('Flavor-Elemental (Corrupted)', 'monster', '**HP:** 80 **AC:** 14');
    const npc = chunk(
      'The Flavor-Elemental (Corrupted)',
      'npc_tier1',
      '**The Flavor-Elemental (Corrupted)**\n*HP:* 5, *AC:* 5.',
    );
    for (const rows of [
      [npc, monster],
      [monster, npc],
    ]) {
      const index = buildCampaignMonsterIndex('academy', rows);
      expect(resolveCombatantStats(index, null, 'Flavor-Elemental (Corrupted)')).toMatchObject({
        maxHp: 80,
        armorClass: 14,
      });
    }
  });
});

describe('creature with an authored block', () => {
  test('resolves on its authored attack and never reaches the NPC fallback', () => {
    const resolved = resolveCombatantStats(ACADEMY, null, 'Flavor-Elemental (Corrupted)');
    expect(resolved?.attackProfile.source).toBe('authored');
    expect(resolved?.attackProfile.attacks[0]).toMatchObject({
      attackBonus: 3,
      damageDice: '2d8',
      damageBonus: 2,
      damageType: 'psychic',
    });
    expect(warn.mock.calls.filter(([p]) => p.msg === 'NPC_STAT_FALLBACK')).toHaveLength(0);
  });
});

describe('bestiary display name', () => {
  const declaredAs = (name: string) =>
    resolveCombatantStats(ACADEMY, 'flavor_elemental_corrupted', name);

  test('a DM-declared label on a bestiary creature becomes the bible heading', () => {
    const monster = declaredAs('Corrupted Shard');
    expect(monster?.source).toBe('campaign');
    expect(bestiaryDisplayName('Corrupted Shard', monster)).toBe('Flavor-Elemental (Corrupted)');
  });

  test('a duplicate number survives the rename', () => {
    expect(bestiaryDisplayName('Corrupted Shard 2', declaredAs('Corrupted Shard 2'))).toBe(
      'Flavor-Elemental (Corrupted) 2',
    );
  });

  test('a declared name that already matches the heading is left as declared', () => {
    // monsterId is passed, so the lookup reaches the campaign rung and only the
    // normalized-name comparison can keep the declared spelling.
    const monster = declaredAs('flavor elemental corrupted 2');
    expect(monster?.source).toBe('campaign');
    expect(bestiaryDisplayName('flavor elemental corrupted 2', monster)).toBe(
      'flavor elemental corrupted 2',
    );
  });

  test('a creature that resolved on the SRD rung keeps its declared name', () => {
    const monster = resolveCombatantStats(ACADEMY, 'srd:goblin', 'Doorkeeper');
    expect(monster?.source).toBe('srd');
    expect(bestiaryDisplayName('Doorkeeper', monster)).toBe('Doorkeeper');
  });

  test('a combatant that is not a campaign creature keeps its name', () => {
    expect(bestiaryDisplayName('Doorkeeper', null)).toBe('Doorkeeper');
  });

  test('seats of one heading are numbered, including an un-renamed seat; a lone seat is not', () => {
    const seat = (name: string, bestiaryName: string | null) => ({
      name,
      bestiaryName,
      monsterAttack: { source: 'authored', attacks: [] } as MonsterAttackProfile,
    });
    const seats = [
      seat('Corrupted Shard', 'Flavor-Elemental (Corrupted)'),
      // The DM already used the heading exactly: it still collides with the renamed seat.
      seat('Flavor-Elemental (Corrupted)', 'Flavor-Elemental (Corrupted)'),
      seat('Shard of Sugar', 'Sugar-Golem'),
      seat('Sugar-Golem 2', 'Sugar-Golem 2'),
      seat('Zone 3', 'Zone 3'),
      seat('Doorkeeper', null),
    ];
    assignBestiaryDisplayNames(seats);
    expect(seats.map((entry) => entry.monsterAttack.displayName)).toEqual([
      'Flavor-Elemental (Corrupted) 1',
      'Flavor-Elemental (Corrupted) 2',
      'Sugar-Golem',
      undefined, // heading equals its own name: nothing to add
      undefined,
      undefined,
    ]);
  });

  test('the roster shows the display name and still answers to the DM label', () => {
    const roster = [
      rosterEntryForParticipant({
        id: 'p1',
        name: 'Corrupted Shard A',
        monsterAttack: { displayName: 'Flavor-Elemental (Corrupted) 1' },
      }),
      rosterEntryForParticipant({ id: 'p2', name: 'Hero', monsterAttack: null }),
    ];
    expect(displayNameFromRoster('p1', roster)).toBe('Flavor-Elemental (Corrupted) 1');
    expect(displayNameFromRoster('Corrupted Shard A', roster)).toBe(
      'Flavor-Elemental (Corrupted) 1',
    );
    expect(displayNameFromRoster('p2', roster)).toBe('Hero');
  });
});
