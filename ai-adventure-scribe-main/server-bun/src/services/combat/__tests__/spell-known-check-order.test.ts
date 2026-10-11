import { describe, expect, it, mock } from 'bun:test';

/**
 * #313 / GP-061: the sheet check must run before the combat-spell assessment, and before
 * the propose step that precedes area placement ("Confirm spell area").
 *
 * A L1 Wizard who does not know Fireball is refused as "not on your sheet"
 * (`spell_not_known`), not as "no attack roll or damage". A known spell outside
 * PLAYER_COMBAT_SPELL_ID_SET still gets the "no attack roll or damage" refusal.
 *
 * Through the real `proposeSpellAttack` (which calls the real `prepareSpellCast` first):
 * only the DB-facing leaves are stubbed. The two refusal cases are sufficient to prove
 * GP-061; a success-path test would exercise the full engine (slot claims, etc.). `resolveCatalogSpell` and
 * `assessPlayerCombatSpell` are the real producers, so the refusal reasons are the real
 * ones.
 */

mock.module('../../../../../db/client', () => ({
  db: new Proxy({}, { get: () => { throw new Error('db.client used in test'); } }),
}));

const CASTER_ID = 'caster-scholar-1';
const TARGET_ID = 'target-spider-1';
// The L1 Wizard's sheet: Fire Bolt (combat) and Light (utility). No Fireball.
const KNOWN_SPELL_IDS = ['fire-bolt', 'light'];

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
mock.module('../../../lib/logger.js', () => ({
  logger: silentLogger,
  combatLogger: silentLogger,
  spellLogger: silentLogger,
  progressionLogger: silentLogger,
  errorLogSerializers: {},
  default: silentLogger,
}));

mock.module('../../combat-initiative-service.js', () => ({
  CombatInitiativeService: {
    getCurrentTurn: async () => ({ id: CASTER_ID }),
  },
}));

mock.module('../data-access.js', () => ({
  getParticipantWithStats: async () => null,
  getParticipantsWithStatsBatch: async (ids: string[]) =>
    new Map(
      ids.map((id) => [
        id,
        {
          participant: {
            id,
            characterId: id === CASTER_ID ? 'char-scholar-1' : null,
            name: id === CASTER_ID ? 'The Scholar' : 'The Spider',
            encounter: { sessionId: 'session-313-1' },
          },
        },
      ]),
    ),
  getWeaponAttack: async () => null,
  getCharacterWeapons: async () => [],
  getCreatureStats: async () => null,
  getCreatureStatsBatch: async () => new Map(),
  createWeaponAttack: async () => null,
  getParticipantAbilityProfile: async () => ({
    spellIds: KNOWN_SPELL_IDS,
    level: 1,
    className: 'Wizard',
    scores: { str: 8, dex: 14, con: 13, int: 16, wis: 12, cha: 10 },
  }),
  getActiveConditionNames: async () => [],
  getEquippedWeaponProfile: async () => null,
  monsterAttackSource: () => 'generic',
  // Not used by this suite, but `hp-data-access.js` imports it, and the death-save
  // machinery pulls the HP service into the import graph. A mocked module with a
  // missing export is a hard SyntaxError for every importer.
  verifyEncounterAccess: async () => {},
}));

mock.module('../tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => null,
  // Stubbed rather than omitted: an absent export is a hard "not found" for every
  // importer in the graph.
  loadLatestTacticalMapRow: async () => null,
  saveTacticalMap: async () => {},
  saveTacticalMapRow: async () => {},
  deactivateTacticalMap: async () => {},
}));

const { combatAttackService } = await import('../combat-attack-service.js');

const propose = (spellName: string, spellId?: string): Promise<unknown> =>
  combatAttackService.proposeSpellAttack(
    'encounter-313-1',
    {
      casterId: CASTER_ID,
      targetIds: [TARGET_ID],
      spellId: spellId ?? undefined,
      spellName,
      slotLevel: 3,
    },
    'user-313-1',
  );

describe('#313 GP-061 sheet check order through the real proposeSpellAttack', () => {
  it('refuses an unknown Fireball as spell_not_known before any proposal (no area is placed)', async () => {
    const error = await propose('Fireball', 'fireball').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const err = error as Error & { details?: { reason?: string } };
    expect(err.details?.reason).toBe('spell_not_known');
  });

  it('still refuses a known-but-unresolved spell (Light) as no attack roll or damage', async () => {
    const error = await propose('Light', 'light').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const err = error as Error & { details?: { reason?: string } };
    expect(err.details?.reason).toBe('unsupported_spell');
  });
});
