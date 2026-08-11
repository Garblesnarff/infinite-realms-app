import { describe, expect, it } from 'bun:test';

import { describeResolvedAttack } from '../attack-narration.js';

/**
 * Whose die decided the attack, said out loud.
 *
 * The player rolls their own attack die (owner decision, 2026-08-10). For that to be
 * trustworthy rather than decorative, a die the engine threw on the player's behalf — because
 * they cancelled the popup, or closed the laptop and came back — has to admit it. A player who
 * cannot tell an engine die from their own has to wonder whether any of the dice are real,
 * which is a worse place to be than server-rolled everything.
 */

describe('the attack record', () => {
  it('marks a hit the engine rolled for the player', () => {
    const line = describeResolvedAttack(
      'The Seeker',
      'Sentient Glaze',
      { hit: true, finalDamage: 8, targetNewHp: 22, autoRolled: true },
      'claws',
    );

    expect(line).toContain('(auto-rolled)');
    expect(line).toContain('8 damage');
  });

  it('marks a miss too, which is the outcome a player is most likely to question', () => {
    expect(
      describeResolvedAttack('The Seeker', 'Sentient Glaze', { hit: false, autoRolled: true }),
    ).toContain('MISSED (auto-rolled)');
  });

  it('stays silent when the player threw the die themselves', () => {
    expect(
      describeResolvedAttack(
        'The Seeker',
        'Sentient Glaze',
        { hit: true, finalDamage: 8, targetNewHp: 22, autoRolled: false },
        'claws',
      ),
    ).not.toContain('auto-rolled');
  });

  it('stays silent when nothing said whose die it was', () => {
    // Every monster attack takes this path: engine-rolled by design, and marking those would
    // turn the note into noise that means nothing.
    expect(describeResolvedAttack('Sentient Glaze', 'The Seeker', { hit: false })).not.toContain(
      'auto-rolled',
    );
  });
});
