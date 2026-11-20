import { describe, expect, it } from 'bun:test';

import {
  LAY_ON_HANDS_CHOSEN_AMOUNT_INTENT_BODY,
  LAY_ON_HANDS_CURE_INTENT_BODY,
  LAY_ON_HANDS_HEAL_INTENT_BODY,
} from '../../../../../../shared/test-fixtures/lay-on-hands-intent';
import { combatIntentRequestValidator } from '../intent-schema.js';

// #1554: the exact client bodies pass the real combat intent route schema.
describe('lay_on_hands intent schema (#1554)', () => {
  it('accepts the heal body the client sends', () => {
    expect(combatIntentRequestValidator.Check(LAY_ON_HANDS_HEAL_INTENT_BODY)).toBe(true);
  });

  // #1670: a heal the player stepped down from the default is the same shape with another amount.
  it('accepts the chosen-amount heal body the client sends', () => {
    expect(combatIntentRequestValidator.Check(LAY_ON_HANDS_CHOSEN_AMOUNT_INTENT_BODY)).toBe(true);
  });

  it('accepts the cure body the client sends', () => {
    expect(combatIntentRequestValidator.Check(LAY_ON_HANDS_CURE_INTENT_BODY)).toBe(true);
  });

  it('refuses an amount under 1 and an unknown cure', () => {
    const zero = {
      ...LAY_ON_HANDS_HEAL_INTENT_BODY,
      intent: { ...LAY_ON_HANDS_HEAL_INTENT_BODY.intent, amount: 0 },
    };
    const disease = {
      ...LAY_ON_HANDS_CURE_INTENT_BODY,
      intent: { ...LAY_ON_HANDS_CURE_INTENT_BODY.intent, cure: 'blindness' },
    };
    expect(combatIntentRequestValidator.Check(zero)).toBe(false);
    expect(combatIntentRequestValidator.Check(disease)).toBe(false);
  });
});
