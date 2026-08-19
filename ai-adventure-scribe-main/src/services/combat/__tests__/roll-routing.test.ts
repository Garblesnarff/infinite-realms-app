import { describe, expect, it } from 'vitest';

import { encounterParticipantsFromContext, shouldAutoExecuteRoll } from '../roll-routing';

import type { RollRequest } from '@/types/roll-request';

/**
 * Issue #1857: monster attack dice must never reach a player-facing popup.
 *
 * The LLM's `autoExecute` flag is not a routing signal. A roll is the player's only when
 * the encounter roster proves the actor is player-owned. Everyone else — including an
 * unnamed attacker — is rolled behind the screen.
 *
 * Skill checks and saves stay player-facing when they do not name an actor; those popups
 * are how this solo game asks the human to roll. Attacks do not get that courtesy.
 */

const ROSTER = [
  { id: 'faithful-id', name: 'The Faithful', participantType: 'player' },
  { id: 'brigade-2', name: 'Brigade Warrior 2', participantType: 'enemy' },
];

const npcAttack = (overrides: Partial<RollRequest> = {}): RollRequest => ({
  type: 'attack',
  formula: '1d20+4',
  purpose: 'Brigade Warrior 2 attacks The Faithful',
  actorName: 'Brigade Warrior 2',
  autoExecute: false,
  ...overrides,
});

describe('shouldAutoExecuteRoll', () => {
  it('auto-executes an NPC attack even when the model left autoExecute falsy', () => {
    expect(shouldAutoExecuteRoll(npcAttack(), ROSTER)).toBe(true);
  });

  it('auto-executes an attack whose purpose names the monster but actorName is missing', () => {
    expect(
      shouldAutoExecuteRoll(npcAttack({ actorName: undefined, autoExecute: undefined }), ROSTER),
    ).toBe(true);
  });

  it('leaves a proven player attack on the player, even if autoExecute is true', () => {
    expect(
      shouldAutoExecuteRoll(
        {
          type: 'attack',
          formula: '1d20+4',
          purpose: 'Mace attack vs Brigade Warrior 2',
          actorName: 'The Faithful',
          autoExecute: true,
        },
        ROSTER,
      ),
    ).toBe(false);
  });

  it('recognises the player by slugified name when the request uses an id-like actor', () => {
    expect(
      shouldAutoExecuteRoll(
        {
          type: 'attack',
          formula: '1d20+4',
          purpose: 'The Faithful attacks Brigade Warrior 2',
          actorName: 'the-faithful',
        },
        ROSTER,
      ),
    ).toBe(false);
  });

  it('does not steal an out-of-combat skill check with no actor', () => {
    expect(
      shouldAutoExecuteRoll(
        {
          type: 'check',
          formula: '1d20+wis',
          purpose: 'Perception check to survey the dining room',
          dc: 13,
        },
        [],
      ),
    ).toBe(false);
  });

  it('does not steal a combat skill check that never names an actor', () => {
    expect(
      shouldAutoExecuteRoll(
        {
          type: 'check',
          formula: '1d20+wis',
          purpose: 'Perception check',
          dc: 13,
        },
        ROSTER,
      ),
    ).toBe(false);
  });

  it('auto-executes a named NPC save during combat', () => {
    expect(
      shouldAutoExecuteRoll(
        {
          type: 'save',
          formula: '1d20+2',
          purpose: 'Brigade Warrior 2 Dexterity save',
          actorName: 'Brigade Warrior 2',
        },
        ROSTER,
      ),
    ).toBe(true);
  });
});

describe('encounterParticipantsFromContext', () => {
  it('reads gameState.participants even when the field is `type` not `participantType`', () => {
    const participants = encounterParticipantsFromContext({
      gameState: {
        participants: [
          { id: 'faithful-id', name: 'The Faithful', type: 'player' },
          { id: 'brigade-2', name: 'Brigade Warrior 2', type: 'enemy' },
        ],
      },
    });

    expect(participants).toEqual([
      { id: 'faithful-id', name: 'The Faithful', participantType: 'player' },
      { id: 'brigade-2', name: 'Brigade Warrior 2', participantType: 'enemy' },
    ]);
  });

  it('returns an empty roster when the context has no encounter', () => {
    expect(encounterParticipantsFromContext({})).toEqual([]);
    expect(encounterParticipantsFromContext({ gameState: {} })).toEqual([]);
  });
});
