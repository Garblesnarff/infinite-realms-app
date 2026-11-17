import { describe, expect, it } from 'vitest';

import { narrativeTurnHasNoEngineEvent } from '../narration-gate';

/**
 * #1597 item 4: a typed Lay on Hands outside a fight that the server resolved carries its engine
 * line on the reply (`engine_lines`). That reply is an engine event, so the narration gate must
 * not replace it. A reply with no engine line keeps the old answer.
 */
const turn = (result: Record<string, unknown>) =>
  narrativeTurnHasNoEngineEvent({
    isInCombat: false,
    isDiceRollMessage: false,
    playerInputOrigin: 'typed',
    result,
  } as any);

describe('narrativeTurnHasNoEngineEvent and server engine lines (#1597)', () => {
  it('a reply carrying a server engine line is an engine event (not gated)', () => {
    expect(turn({ text: 'You feel restored.', engine_lines: ['Hero restores 5 HP.'] })).toBe(false);
  });

  it('an empty engine_lines list does not count', () => {
    expect(turn({ text: 'You feel restored.', engine_lines: [] })).toBe(true);
  });

  it('a plain reply with no engine line is still a no-engine turn (unchanged)', () => {
    expect(turn({ text: 'You feel restored.' })).toBe(true);
  });
});
