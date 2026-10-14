/**
 * GP-061 (#313): an area spell the caster's sheet does not list is refused at propose time,
 * before the area is placed — not after "Confirm spell area".
 *
 * The typed flow is already refused at once by the DM feature gate; this covers the AoE
 * propose path (DM suggestions, action bar, in-combat typed casts the gate skips), where
 * prepareSpellCast's sheet check only ran at resolve/commit time.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import type { MapEntity, TacticalMap } from '../../../tactical/types.js';

const SESSION_ID = '0a1b2c3d-0000-4000-8000-000000000001';
const APPRENTICE_ID = '1bc3932f-da2d-4525-84e5-77a31a4b3bef';
const CULTIST_ID = '779792b2-aef0-4288-be43-19aba2530eba';
const CHARACTER_ID = '2733e680-0000-4000-8000-000000000003';
const USER_ID = 'user_owner';

const noop = () => {};
const silentLogger = {
  debug: noop,
  info: noop,
  error: noop,
  warn: noop,
  child: () => silentLogger,
};

mock.module('../../../../../db/client', () => ({ db: {} }));
mock.module('../../../lib/env.js', () => ({
  env: { WORKOS_CLIENT_ID: 'test-client', NODE_ENV: 'test' },
}));
mock.module('../../../lib/logger.js', () => ({
  logger: silentLogger,
  combatLogger: silentLogger,
}));

// The Apprentice's sheet, as the seed writes it: Burning Hands is known, Fireball is not.
let apprenticeSpellIds: string[] = [];
mock.module('../../../services/combat/data-access.js', () => ({
  getParticipantWithStats: async () => ({ participant: null, stats: null }),
  getParticipantsWithStatsBatch: async () => new Map(),
  getParticipantAbilityProfile: async (participant: { characterId?: string }) =>
    participant.characterId === CHARACTER_ID
      ? {
          level: 1,
          className: 'Wizard',
          savingThrowProficiencies: [],
          scores: { str: 8, dex: 12, con: 12, int: 16, wis: 12, cha: 10 },
          saveBonuses: {},
          spellIds: apprenticeSpellIds,
        }
      : {
          level: 1,
          className: null,
          savingThrowProficiencies: [],
          scores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
          saveBonuses: {},
          spellIds: [],
        },
  getActiveConditionNames: async () => [],
  listEquippedWeaponProfiles: async () => [],
  getEquippedWeaponProfile: async () => null,
  getWeaponAttack: async () => null,
  getCharacterWeapons: async () => [],
  getCreatureStats: async () => null,
  getCreatureStatsBatch: async () => new Map(),
  createWeaponAttack: async () => null,
  monsterAttackSource: () => 'none',
  claimEncounterVersion: async () => {},
  verifyCharacterOwnership: async () => {},
  verifyEncounterAccess: async () => {},
  getParticipantInEncounter: async () => null,
}));
mock.module('../../../services/dm/dm-feature-gate.js', () => ({
  ownedSessionCharacter: async () => ({ id: CHARACTER_ID, name: 'The Apprentice' }),
}));
mock.module('../../../services/collaboration/room-manager.js', () => ({
  broadcastToRoom: noop,
}));

let board: TacticalMap;
mock.module('../../../services/combat/tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => board,
  loadLatestTacticalMapRow: async () => ({ rowId: 'row', state: board, active: true }),
  saveTacticalMap: async () => {},
  saveTacticalMapRow: async () => {},
  deactivateTacticalMap: async () => {},
}));

const { proposeAoECast, AoECastRefusedError } = await import('../aoe-cast-service.js');
const { assignEntitySlugs } = await import('../../../tactical/identity.js');

const entity = (id: string, name: string, x: number, type: 'pc' | 'monster'): MapEntity => ({
  id,
  name,
  x,
  y: 4,
  size: 'medium',
  type,
  speedFeet: 30,
  movementRemaining: 30,
});

function freshBoard(): TacticalMap {
  const entities = assignEntitySlugs([
    entity(APPRENTICE_ID, 'The Apprentice', 2, 'pc'),
    entity(CULTIST_ID, 'Cultist', 5, 'monster'),
  ]);
  return {
    id: 'map',
    sessionId: SESSION_ID,
    width: 12,
    height: 9,
    round: 1,
    sceneDescription: 'the shrine',
    cells: Array.from({ length: 9 }, () =>
      Array.from({ length: 12 }, () => ({
        terrain: 'floor' as const,
        blocksMovement: false,
        blocksSight: false,
        cover: 0 as const,
        elevation: 0,
      })),
    ),
    entities,
  };
}

beforeEach(() => {
  board = freshBoard();
  apprenticeSpellIds = ['burning-hands', 'acid-splash'];
});

describe('GP-061 (#313): propose refuses a sheet-unknown area spell at once', () => {
  it('refuses Fireball before placing the area, with the not-on-sheet reason', async () => {
    // Fireball has an area of effect but is not on the L1 Wizard's sheet.
    const error = await proposeAoECast(
      SESSION_ID,
      {
        actorId: 'the-apprentice',
        spellId: 'fireball',
        origin: { x: 5, y: 4 },
        direction: { x: 1, y: 0 },
        slotLevel: 3,
      },
      USER_ID,
    ).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(AoECastRefusedError);
    expect((error as { details?: { reason?: string } }).details?.reason).toBe('spell_not_known');
    expect((error as Error).message).toContain('not on');
    expect((error as Error).message).toContain('Fireball');
  });

  it('proposes a sheet-listed area spell without the sheet refusal', async () => {
    // Burning Hands is on the sheet: the propose must not refuse as spell_not_known.
    // (It may still refuse for unrelated geometry reasons; the sheet check passes.)
    const error = await proposeAoECast(
      SESSION_ID,
      {
        actorId: 'the-apprentice',
        spellId: 'burning-hands',
        origin: { x: 2, y: 4 },
        direction: { x: 1, y: 0 },
        slotLevel: 1,
      },
      USER_ID,
    ).then(
      () => null,
      (err: unknown) => err,
    );
    if (error) {
      expect((error as { details?: { reason?: string } }).details?.reason).not.toBe(
        'spell_not_known',
      );
    }
  });

  it('skips the sheet check for a monster caster', async () => {
    // NPCs have no sheet; a hostile Fireball telegraph must not be refused as not-known.
    const error = await proposeAoECast(
      SESSION_ID,
      {
        actorId: CULTIST_ID,
        spellId: 'fireball',
        origin: { x: 2, y: 4 },
        direction: { x: -1, y: 0 },
        slotLevel: 3,
      },
      USER_ID,
    ).then(
      () => null,
      (err: unknown) => err,
    );
    if (error) {
      expect((error as { details?: { reason?: string } }).details?.reason).not.toBe(
        'spell_not_known',
      );
    }
  });
});
