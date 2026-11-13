import { describe, expect, it } from 'vitest';

import { formatCombatEndLine } from '../../../../shared/combat-outcome-transcript';
import {
  CONDITION_KEYS,
  END_REASON_KEYS,
  PLAYER_COMBAT_WORDING,
  renderPlayerCombatWording,
} from '../../../../shared/player-combat-wording';

const SNAKE_CASE = /\b[a-z]+(?:_[a-z0-9]+)+\b/;

describe('player combat wording (#764)', () => {
  it('renders every table key with no snake_case, and keeps bloodied', () => {
    for (const [key, phrase] of Object.entries(PLAYER_COMBAT_WORDING)) {
      const rendered = renderPlayerCombatWording(`The result was ${key}.`);
      expect(rendered, key).not.toMatch(SNAKE_CASE);
      expect(phrase).not.toMatch(SNAKE_CASE);
    }
    expect(renderPlayerCombatWording('the foe is bloodied')).toBe('the foe is bloodied');
    expect(PLAYER_COMBAT_WORDING.bloodied).toBe('bloodied');
    expect(renderPlayerCombatWording('prone')).toBe('prone');
  });

  it('covers every end reason and every condition name', () => {
    for (const key of END_REASON_KEYS) {
      expect(PLAYER_COMBAT_WORDING[key]).toBeTruthy();
    }
    for (const key of CONDITION_KEYS) {
      expect(PLAYER_COMBAT_WORDING[key]).toBe(key);
    }
  });

  it('does not print an end-reason key, and does not treat a condition as an end', () => {
    expect(formatCombatEndLine('last_hostile_defeated')).toBe(
      '⚙️ Engine: Combat ended — the last hostile was defeated.',
    );
    expect(formatCombatEndLine('last_hostile_defeated')).not.toMatch(SNAKE_CASE);
    expect(formatCombatEndLine('prone')).toBe('⚙️ Engine: Combat ended — the fight is over.');
    expect(formatCombatEndLine('some_future_reason')).toBe(
      '⚙️ Engine: Combat ended — the fight is over.',
    );
  });

  it('replaces a leftover key that the table does not know', () => {
    expect(renderPlayerCombatWording('blocked by totally_unknown_reason')).toBe(
      'blocked by a rules result',
    );
    expect(renderPlayerCombatWording('blocked by totally_unknown_reason')).not.toMatch(SNAKE_CASE);
  });
});
