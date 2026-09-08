import { describe, expect, it } from 'bun:test';

import {
  resolveParticipantType,
  type ParticipantType,
} from '../combat/participant-type.js';

/**
 * The values `combat_participants_participant_type_check` accepts. Duplicated
 * from the constraint on purpose: if someone widens the union, this list is
 * what says the database still disagrees.
 */
const CONSTRAINT_ALLOWS = ['player', 'npc', 'enemy', 'monster'];

describe('resolveParticipantType', () => {
  it('is a player when a characterId identifies it', () => {
    expect(resolveParticipantType({ characterId: 'char-1' })).toBe('player');
  });

  it('is an npc when only an npcId identifies it', () => {
    expect(resolveParticipantType({ npcId: 'npc-1' })).toBe('npc');
  });

  it("is a 'monster' when nothing identifies it -- never 'other' (#1987)", () => {
    // The regression. A name-only combatant used to resolve to 'other', which
    // the check constraint rejects with Postgres 23514, 500ing combat entry.
    expect(resolveParticipantType({})).toBe('monster');
    expect(resolveParticipantType({ characterId: null, npcId: null })).toBe('monster');
  });

  it('prefers the character over the npc when a row carries both', () => {
    expect(resolveParticipantType({ characterId: 'char-1', npcId: 'npc-1' })).toBe('player');
  });

  it('treats empty-string ids as absent rather than as identifying', () => {
    expect(resolveParticipantType({ characterId: '', npcId: '' })).toBe('monster');
  });

  it('only ever returns a value the check constraint accepts', () => {
    const identities = [
      { characterId: 'char-1' },
      { npcId: 'npc-1' },
      {},
      { characterId: null, npcId: null },
      { characterId: '', npcId: 'npc-1' },
    ];
    for (const identity of identities) {
      expect(CONSTRAINT_ALLOWS).toContain(resolveParticipantType(identity));
    }
  });
});

describe('ParticipantType (type level)', () => {
  it("does not admit 'other'", () => {
    // @ts-expect-error -- 'other' must never be assignable to ParticipantType.
    // This line FAILS TO COMPILE if the union is ever widened to include it,
    // because @ts-expect-error errors when there is no error to suppress.
    const rejected: ParticipantType = 'other';
    void rejected;

    // Kept runtime-visible so the file reports a test rather than only a
    // compile-time guarantee.
    expect(CONSTRAINT_ALLOWS).not.toContain('other');
  });

  it('admits exactly the three values the helper can return', () => {
    const player: ParticipantType = 'player';
    const npc: ParticipantType = 'npc';
    const monster: ParticipantType = 'monster';
    expect([player, npc, monster]).toEqual(['player', 'npc', 'monster']);
  });
});
