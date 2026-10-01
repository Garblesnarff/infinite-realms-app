import { describe, expect, it } from 'vitest';

import {
  COMBAT_INTENT_SCHEMA_REJECTED,
  combatRefusalReason,
  redactedCombatIntent,
  repairedTurnNotice,
  turnNotice,
  unresolvedTargetNotice,
} from '../combat-notice';

import { CombatIntentRefusedError } from '@/services/combat/combat-action-executor';

describe('combat refusal notices', () => {
  it.each([
    [COMBAT_INTENT_SCHEMA_REJECTED, "*(Couldn't read that action, retrying…)*"],
    [
      'COMBAT_INTENT_REFUSED',
      '*(Your action was declared out of turn and was not resolved — it is your turn now.)*',
    ],
  ])('maps %s to the player-facing notice', (reason, expected) => {
    expect(turnNotice({ id: 'player' }, true, reason)).toBe(expected);
  });

  it('names who acts next after a repair without calling it out of turn', () => {
    expect(repairedTurnNotice({ id: 'npc', name: 'Balthazar' })).toBe('*(Balthazar acts next.)*');
    expect(repairedTurnNotice(null)).toBe('*(It is not your turn yet.)*');
  });

  it('recognizes the schema rejection envelope even when the server places the reason at stage', () => {
    const refusal = new CombatIntentRefusedError('Invalid combat intent', 422, {
      stage: 'intent_schema',
    });

    expect(combatRefusalReason(refusal)).toBe(COMBAT_INTENT_SCHEMA_REJECTED);
  });

  it('redacts identifiers while retaining the rejected intent shape', () => {
    const redacted = redactedCombatIntent({
      actor_id: 'secret-actor',
      action_type: 'attack',
      target_ids: ['secret-target'],
      weapon_id: 'secret-weapon',
      spell_id: null,
      slot_level: null,
      movement_feet: 0,
    });

    expect(redacted).toMatchObject({
      actor_id: '[redacted]',
      target_ids: ['[redacted]'],
      weapon_id: '[redacted]',
      action_type: 'attack',
    });
    expect(JSON.stringify(redacted)).not.toContain('secret-');
  });
});

describe('unresolvedTargetNotice (#2444)', () => {
  const player = { holder: { id: 'player', name: 'The Apprentice' }, holderIsPlayer: true };
  const creature = { holder: { id: 'npc', name: 'Balthazar' }, holderIsPlayer: false };

  it("says nothing was resolved, and that the turn is still the player's, when that is true", () => {
    expect(unresolvedTargetNotice(['Balthazar'], player, false)).toBe(
      '*(No creature by that name is in this fight, so nothing was resolved — it is still your turn. Who do you mean: Balthazar?)*',
    );
  });

  it('does not claim nothing was resolved when an earlier action in the reply was', () => {
    const notice = unresolvedTargetNotice(['Balthazar'], player, true);

    expect(notice).toContain('so that action was not resolved');
    expect(notice).not.toContain('nothing was resolved');
    expect(notice).not.toContain('still your turn');
  });

  it('names the creature that holds the turn, in turnNotice\'s words, instead of "still your turn"', () => {
    const notice = unresolvedTargetNotice(['Balthazar', 'Quill'], creature, true);

    expect(notice).toBe(
      "*(No creature by that name is in this fight, so that action was not resolved. The creatures here: Balthazar, Quill.)*\n\n*(Your declared action has not been resolved — it is Balthazar's turn.)*",
    );
    expect(notice).toContain(turnNotice(creature.holder, false));
    expect(notice).not.toContain('still your turn');
  });

  it('lists no creatures when none stand', () => {
    expect(unresolvedTargetNotice([], player, false)).not.toContain('Who do you mean');
    expect(unresolvedTargetNotice([], creature, false)).not.toContain('The creatures here');
  });
});
