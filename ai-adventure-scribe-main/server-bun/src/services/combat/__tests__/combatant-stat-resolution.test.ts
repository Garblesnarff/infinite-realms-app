/**
 * The ladder: campaign-authored stats -> SRD catalog -> generic NPC.
 *
 * Production numbers, from playtest runs 6-15: the Gluten Golem's authored 90 HP fought at
 * 11, the Shadow Roach's authored 20 fought at 11. These tests assert the authored numbers,
 * not merely that something non-generic came back.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

type LogPayload = Record<string, unknown>;

const warn = mock((_payload: LogPayload) => {});
const info = mock((_payload: LogPayload) => {});
const debug = mock((_payload: LogPayload) => {});

mock.module('../../../lib/logger.js', () => ({
  logger: { warn, info, debug, error: mock((_payload: LogPayload) => {}) },
}));

const { parseAuthoredStatBlock, gradeCoverage } = await import('../authored-stat-block-parser.js');
const { resolveCombatantStats } = await import('../combatant-stat-resolution.js');
const { normalizeMonsterKey } = await import('../monster-key.js');

import type { CampaignMonsterIndex } from '../campaign-monster-index.js';

/**
 * Builds an index the way `loadCampaignMonsterIndex` does, without touching a database.
 *
 * Keys go through `normalizeMonsterKey`, the same function production uses. This fixture used
 * to inline `toLowerCase().replace(/[^a-z0-9]+/g, '-')` — a copy of the rule as it stood at
 * the time — and when the rule tightened to strip separators outright, the copy did not
 * follow: the index held `gluten-golem` while every lookup asked for `glutengolem`, and four
 * tests failed against correct production code. That divergence is the exact failure
 * `monster-key.ts` exists as a single module to prevent, so the fixture imports it.
 */
const indexOf = (campaignId: string, entries: Record<string, string>): CampaignMonsterIndex => {
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
  return {
    campaignId,
    byKey,
    chunkCount: Object.keys(entries).length,
    blocklessNpcs: new Map(),
  };
};

const ETERNAL_FEAST = indexOf('the-eternal-feast', {
  'Gluten Golem': '**Gluten Golem**\n\n**HP:** 90 **AC:** 14 **Speed:** 30ft',
  'Shadow Roach': '**Shadow Roach**\n\n**HP:** 20 **AC:** 13 **Speed:** 30ft',
  // A campaign that authors its own Goblin, deliberately tougher than the SRD's.
  Goblin: '**Goblin**\n\n**HP:** 45 **AC:** 16 **Speed:** 30ft',
  'Half Stat Fiend': '**Half Stat Fiend**\n\n**HP:** 60 **Speed:** 40ft',
  'Unreadable Horror': '**Unreadable Horror**\n\n**HP:** lots **AC:** terrifying',
});

const EMPTY_INDEX: CampaignMonsterIndex = {
  campaignId: 'academy-of-arcane-gastronomy',
  byKey: new Map(),
  chunkCount: 0,
  blocklessNpcs: new Map(),
};

beforeEach(() => {
  warn.mockClear();
  info.mockClear();
  debug.mockClear();
});

describe('campaign-authored stats', () => {
  test('the Gluten Golem fights at its authored 90 HP and AC 14', () => {
    const stats = resolveCombatantStats(ETERNAL_FEAST, 'gluten_golem_01', 'Gluten Golem');
    expect(stats).toMatchObject({ source: 'campaign', maxHp: 90, armorClass: 14, speed: 30 });
    expect(warn).not.toHaveBeenCalled();
  });

  test('the Shadow Roach fights at its authored 20 HP', () => {
    expect(resolveCombatantStats(ETERNAL_FEAST, null, 'Shadow Roach')).toMatchObject({
      source: 'campaign',
      maxHp: 20,
      armorClass: 13,
    });
  });

  test('campaign stats outrank an SRD entry of the same name', () => {
    // The SRD Goblin is 7 HP / AC 15. The bible's author said 45 / 16, and the author wins.
    const stats = resolveCombatantStats(ETERNAL_FEAST, 'srd:goblin', 'Goblin');
    expect(stats).toMatchObject({ source: 'campaign', maxHp: 45, armorClass: 16 });
  });

  test('matching survives case, hyphen, underscore and spacing differences', () => {
    for (const id of [
      'Gluten Golem',
      'gluten_golem',
      'gluten-golem',
      'GLUTEN GOLEM',
      '  Gluten  Golem  ',
    ]) {
      expect(resolveCombatantStats(ETERNAL_FEAST, id, null)?.maxHp).toBe(90);
    }
  });

  test('the DM’s monster_id and the display name are both tried', () => {
    expect(resolveCombatantStats(ETERNAL_FEAST, 'shadow-roach', 'Skittering Dark')?.maxHp).toBe(20);
    expect(resolveCombatantStats(ETERNAL_FEAST, 'unknown_id_99', 'Shadow Roach')?.maxHp).toBe(20);
  });
});

describe('partial and unreadable authored blocks', () => {
  test('an authored HP survives a missing AC, and the filled field is logged', () => {
    const stats = resolveCombatantStats(ETERNAL_FEAST, null, 'Half Stat Fiend');
    expect(stats).toMatchObject({
      source: 'campaign',
      maxHp: 60,
      speed: 40,
      armorClass: 12, // generic, since no SRD entry exists to fill from
      filledFromFallback: expect.arrayContaining(['armorClass']),
    });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]![0]).toMatchObject({ filledFromFallback: ['armorClass'] });
  });

  test('an unreadable chunk logs the parse failure and falls through rather than guessing', () => {
    const stats = resolveCombatantStats(ETERNAL_FEAST, 'unreadable_horror', 'Unreadable Horror');

    expect(stats).toBeNull(); // no SRD entry either, so the generic rung
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]![0]).toMatchObject({
      entityName: 'Unreadable Horror',
      unparsedLabels: ['HP', 'AC'],
    });
    expect(String(warn.mock.calls[0]![0].msg)).toContain('no stats could be parsed');
  });
});

describe('falling through the ladder', () => {
  test('a campaign miss with a real SRD id lands on the SRD rung', () => {
    const stats = resolveCombatantStats(ETERNAL_FEAST, 'srd:stone_golem', 'Doorkeeper');
    expect(stats).toMatchObject({ source: 'srd', maxHp: 178, armorClass: 17 });
    expect(warn).not.toHaveBeenCalled();
  });

  test('a campaign miss is recorded when the campaign does have authored creatures', () => {
    resolveCombatantStats(ETERNAL_FEAST, 'srd:stone_golem', 'Doorkeeper');
    expect(debug).toHaveBeenCalledTimes(1);
    expect(String(debug.mock.calls[0]![0].msg)).toContain('No campaign-authored stat block');
  });

  test('DM improvisation with no authored and no SRD entry still falls back to generic', () => {
    // "Doorkeeper", "Threatening Entity", "Hostile Patron" are improvised. This must survive.
    expect(resolveCombatantStats(EMPTY_INDEX, 'the-void-maw', 'The Void Maw')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('the generic warn states the resulting AC and HP, not just the miss', () => {
    resolveCombatantStats(EMPTY_INDEX, 'the-void-maw', 'The Void Maw', { sessionId: 'sess-1' });

    const payload = warn.mock.calls[0]![0];
    expect(payload).toMatchObject({
      monsterId: 'the-void-maw',
      combatantName: 'The Void Maw',
      armorClass: 12,
      maxHp: 11,
      sessionId: 'sess-1',
      campaignId: 'academy-of-arcane-gastronomy',
    });
    expect(String(payload.consequence)).toContain('AC 12');
    expect(String(payload.consequence)).toContain('11 HP');
  });

  test('a campaign with no bible at all resolves SRD creatures normally', () => {
    expect(resolveCombatantStats(EMPTY_INDEX, 'srd:stone_golem')).toMatchObject({
      source: 'srd',
      maxHp: 178,
      armorClass: 17,
    });
  });

  test('a name with no id still warns when it lands on the generic rung', () => {
    // #1858: the warn used to be gated on `monsterId`, on the theory that a purely narrative
    // combatant is not a downgrade worth reporting. But a name-only combatant gets verbatim
    // GENERIC_NPC_STATS exactly like a missed id does — the Brigade Warriors fought an entire
    // encounter at AC 12 / 11 HP with no attack profile, and the log said nothing.
    expect(resolveCombatantStats(EMPTY_INDEX, null, 'Hostile Patron')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({
      combatantName: 'Hostile Patron',
      armorClass: 12,
      maxHp: 11,
    });
  });
});

describe('the run-15 SRD normalization fix still holds through the ladder', () => {
  test('srd:stone_golem, srd:stone-golem and "Stone Golem" all reach 178 HP / AC 17', () => {
    for (const id of ['srd:stone_golem', 'srd:stone-golem', 'stone_golem', 'Stone Golem']) {
      expect(resolveCombatantStats(EMPTY_INDEX, id)).toMatchObject({ maxHp: 178, armorClass: 17 });
    }
  });
});
