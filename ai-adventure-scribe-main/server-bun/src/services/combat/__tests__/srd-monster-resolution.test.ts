/**
 * Playtest run 15 regression: the DM sent `srd:stone_golem`, the catalog holds
 * `srd:stone-golem`, and a CR 10 boss fought — and died in one hit — as an 11 HP
 * generic NPC. These tests pin the real stat block numbers, not merely non-null.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

type LogPayload = Record<string, unknown>;

const warn = mock((_payload: LogPayload) => {});
const info = mock((_payload: LogPayload) => {});

mock.module('../../../lib/logger.js', () => ({
  logger: {
    warn,
    info,
    error: mock((_payload: LogPayload) => {}),
    debug: mock((_payload: LogPayload) => {}),
  },
}));

const { findSrdMonster, resolveSrdMonsterStats, GENERIC_NPC_STATS } =
  await import('../srd-monster-resolution.js');

const STONE_GOLEM = { id: 'srd:stone-golem', armorClass: 17, maxHp: 178 };

describe('findSrdMonster id normalization', () => {
  test('underscore, hyphen, bare, spaced and upper-case forms all reach the same entry', () => {
    for (const input of [
      'srd:stone_golem',
      'srd:stone-golem',
      'stone_golem',
      'stone-golem',
      'SRD:STONE_GOLEM',
      '  srd:Stone Golem  ',
    ]) {
      expect(findSrdMonster(input)?.id).toBe(STONE_GOLEM.id);
    }
  });

  test('the same normalization applies to the name lookup', () => {
    for (const label of ['Stone Golem', 'STONE GOLEM', 'stone_golem', ' stone-golem ']) {
      expect(findSrdMonster(null, label)?.id).toBe(STONE_GOLEM.id);
    }
  });
});

describe('resolveSrdMonsterStats', () => {
  beforeEach(() => {
    warn.mockClear();
    info.mockClear();
  });

  test('every stone golem spelling resolves to AC 17 and 178 HP', () => {
    for (const input of ['srd:stone_golem', 'srd:stone-golem', 'stone_golem', 'Stone Golem']) {
      const stats = resolveSrdMonsterStats(input, 'The Doorkeeper');
      expect(stats).toMatchObject({
        monsterId: STONE_GOLEM.id,
        monsterName: 'Stone Golem',
        armorClass: STONE_GOLEM.armorClass,
        maxHp: STONE_GOLEM.maxHp,
        size: 'large',
      });
    }
    expect(warn).not.toHaveBeenCalled();
  });

  test('a genuinely unknown homebrew id still falls back to generic stats and warns', () => {
    for (const id of ['gluten_golem_01', 'the-void-maw']) {
      expect(resolveSrdMonsterStats(id, 'Gluten Golem')).toBeNull();
    }
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test('the warn payload names the consequence: the generic AC and HP', () => {
    resolveSrdMonsterStats('gluten_golem_01', 'Gluten Golem', { sessionId: 'sess-1' });

    expect(warn).toHaveBeenCalledTimes(1);
    const payload = warn.mock.calls[0]![0];
    expect(payload).toMatchObject({
      monsterId: 'gluten_golem_01',
      combatantName: 'Gluten Golem',
      armorClass: GENERIC_NPC_STATS.armorClass,
      maxHp: GENERIC_NPC_STATS.maxHp,
      sessionId: 'sess-1',
    });
    expect(String(payload.consequence)).toContain('AC 12');
    expect(String(payload.consequence)).toContain('11 HP');
  });

  test('a narrative name with no id and no SRD analog warns about the generic fallback too', () => {
    // #1858: this warn used to be gated on `monsterId`, so a name-only combatant dropped to
    // AC 12 / 11 HP without a line in the log — which is how the Brigade Warriors fought an
    // entire encounter at generic stats unnoticed.
    expect(resolveSrdMonsterStats(null, 'doorkeeper')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({
      monsterId: null,
      combatantName: 'doorkeeper',
      armorClass: GENERIC_NPC_STATS.armorClass,
      maxHp: GENERIC_NPC_STATS.maxHp,
    });
  });

  test('a caller that owns the ladder can still suppress the warn', () => {
    expect(
      resolveSrdMonsterStats(null, 'doorkeeper', {}, { suppressFallbackWarn: true }),
    ).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('near-miss matching', () => {
  beforeEach(() => {
    warn.mockClear();
    info.mockClear();
  });

  test('a supplied id that contains a complete catalog name resolves to that creature', () => {
    expect(findSrdMonster('ancient_red_dragon_boss')?.id).toBe('srd:ancient-red-dragon');
    expect(findSrdMonster('srd:dire_wolf_alpha')?.id).toBe('srd:dire-wolf');
  });

  test('near-miss resolution is logged, since it is an inference rather than a lookup', () => {
    const stats = resolveSrdMonsterStats('srd:dire_wolf_alpha', 'Alpha');
    expect(stats?.monsterId).toBe('srd:dire-wolf');
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]![0]).toMatchObject({ resolvedId: 'srd:dire-wolf' });
  });

  test('it cannot invent a creature from a partial or common-noun overlap', () => {
    // Sharing one token with several catalog entries is not a match: the query must
    // contain an entry's COMPLETE name, and single-token entries never carry a match.
    for (const id of [
      'gluten_golem_01', // 'golem' alone: stone/clay/flesh/iron all fail the all-tokens test
      'the-void-maw',
      'doorkeeper',
      'zombie_horde', // 'Zombie' is single-token, barred by design
      'goblin_king_of_the_deep_warrens', // too many extra tokens
    ]) {
      expect(findSrdMonster(id)).toBeNull();
    }
  });

  test('a bare narrative name never triggers near-miss matching', () => {
    // Only a supplied monster_id is evidence the model meant a real SRD creature.
    expect(findSrdMonster(null, 'ancient red dragon boss')).toBeNull();
  });
});

/**
 * Run 15 produced three unresolved warns for one creature in one encounter, because the DM
 * alternated between `srd:stone_golem` and the narrative name "doorkeeper" across turns. The
 * feared bug was re-resolution: a creature statted correctly on turn 1 and re-resolved to
 * generic stats on turn 3 would be worse than the miss this file fixes.
 *
 * It cannot happen. `resolveSrdMonsterStats` has exactly one call site — the participant
 * INSERT inside `CombatEncounterService.startCombat` — and the only other path that adds a
 * combatant, `CombatInitiativeService.addParticipant`, neither resolves monsters nor writes
 * `armorClass`/`maxHp` at all (the columns keep their schema defaults). Nothing ever UPDATEs
 * a participant's AC or max HP from a resolution result. The repeated warns were repeated
 * *start* calls, each creating a fresh encounter; 47205c12 (2026-07-25) since made a start
 * against a session already in combat a read-only no-op.
 *
 * These guards keep that true rather than merely stating it.
 */
describe('resolution cannot re-run against a live participant', () => {
  const serverRoot = new URL('../../../../', import.meta.url).pathname;

  const sourceFiles = [...new Bun.Glob('src/**/*.ts').scanSync(serverRoot)].filter(
    (file) => !file.includes('__tests__'),
  );

  const callSitesOf = async (symbol: string, definedIn: string): Promise<string[]> => {
    const callSites: string[] = [];
    for (const file of sourceFiles) {
      if (file.endsWith(definedIn)) continue;
      const text = await Bun.file(`${serverRoot}${file}`).text();
      if (new RegExp(`${symbol}\\s*\\(`).test(text)) callSites.push(file);
    }
    return callSites.sort();
  };

  test('the SRD rung is reached only through the ladder', async () => {
    expect(await callSitesOf('resolveSrdMonsterStats', 'srd-monster-resolution.ts')).toEqual([
      'src/services/combat/combatant-stat-resolution.ts',
    ]);
  });

  test('the ladder has exactly one call site: startCombat', async () => {
    expect(await callSitesOf('resolveCombatantStats', 'combatant-stat-resolution.ts')).toEqual([
      'src/services/combat/combat-encounter-service.ts',
    ]);
  });

  test('addParticipant writes neither armorClass nor maxHp, so it cannot downgrade a combatant', async () => {
    const text = await Bun.file(`${serverRoot}src/services/combat-initiative-service.ts`).text();
    const addParticipant = text.slice(
      text.indexOf('static async addParticipant'),
      text.indexOf('static async rollInitiative'),
    );
    expect(addParticipant.length).toBeGreaterThan(0);
    expect(addParticipant).not.toMatch(/armorClass|maxHp|currentHp|resolveSrdMonsterStats/);
  });

  test('no participant UPDATE ever sets armorClass or maxHp', async () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const text = await Bun.file(`${serverRoot}${file}`).text();
      for (const match of text.matchAll(/\.update\(combatParticipants\)([\s\S]{0,400}?)\.where/g)) {
        if (/\b(armorClass|maxHp)\s*:/.test(match[1]!)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
