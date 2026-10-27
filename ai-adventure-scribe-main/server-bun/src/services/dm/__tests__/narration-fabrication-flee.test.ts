import { describe, expect, test } from 'bun:test';

import {
  fabricatedOutcomeClaims,
  suspectsFabricatedOutcome,
} from '../../../../../shared/narration-harm.js';

// #1169 (Hark, Static Knight fight): after a flee the DM narrated a strike and damage the engine had not logged; the engine now writes the opportunity attack as an engine row and DM fact, and this pins that the narration gate still flags a post-flee reply that names an unrolled strike or damage.
describe('narration gate flags post-flee reply (#1169)', () => {
  test('first reply: blade catches you + 3 damage', () => {
    const reply =
      "The Static Knight's blade catches you across the shoulder as you turn, dealing 3 damage, and you sprint for the trees.";
    expect(suspectsFabricatedOutcome(reply, { playerMayHaveActed: true })).toBe(true);
    const claims = fabricatedOutcomeClaims(reply, { playerMayHaveActed: true });
    expect(claims.some((c) => c.includes('3 damage'))).toBe(true);
    expect(claims.some((c) => c.includes('blade catches you'))).toBe(true);
  });

  test('second reply: strikes you + 3 damage', () => {
    const reply = 'As you run, the Knight strikes you. You take 3 damage.';
    expect(suspectsFabricatedOutcome(reply, { playerMayHaveActed: true })).toBe(true);
    const claims = fabricatedOutcomeClaims(reply, { playerMayHaveActed: true });
    expect(claims.some((c) => c.includes('3 damage'))).toBe(true);
    expect(claims.some((c) => c.includes('strikes you'))).toBe(true);
  });
});
