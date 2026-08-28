import { describe, expect, it } from 'bun:test';

import { assertActorTurn } from '../combat-intent-turn.js';

const index = {
  resolve: (token: string) => token,
  slugFor: (id: string | null | undefined) => (id ? `slug-${id}` : undefined),
  roster: () => 'companion, enemy',
};

const state = {
  encounter: { id: 'encounter-1', sessionId: 'session-1' },
  participants: [
    { id: 'companion-participant', name: 'Mira' },
    { id: 'enemy-participant', name: 'Ogre' },
  ],
  currentParticipant: { id: 'companion-participant', name: 'Mira' },
} as any;

describe('companion intent turn guard', () => {
  it('rejects a known companion acting out of turn with 422', () => {
    expect(() => assertActorTurn(state, 'enemy-participant', index)).toThrow(
      'Actor is not the current-turn participant',
    );
    try {
      assertActorTurn(state, 'enemy-participant', index);
    } catch (error) {
      expect((error as { statusCode?: number }).statusCode).toBe(422);
    }
  });

  it('resolves a companion intent when its participant is current', () => {
    const result = assertActorTurn(state, 'companion-participant', index);
    expect(result.actor.id).toBe('companion-participant');
    expect(result.encounter.id).toBe('encounter-1');
  });
});
