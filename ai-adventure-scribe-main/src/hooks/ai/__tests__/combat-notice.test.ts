import { describe, expect, it } from 'vitest';

import {
  COMBAT_INTENT_SCHEMA_REJECTED,
  combatRefusalReason,
  redactedCombatIntent,
  repairedTurnNotice,
  turnNotice,
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
