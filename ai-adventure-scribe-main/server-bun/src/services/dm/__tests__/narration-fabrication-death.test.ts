import { describe, expect, test } from 'bun:test';

import { fabricatedOutcomeClaims } from '../../../../../shared/narration-harm.js';

// #468 (Hark NT-106): a lethal free-text action narrated as final death with no roll, while the
// sheet still showed full HP. The DM asserting the player character's death for a turn the
// engine resolved nothing for is a fabricated outcome claim — the client narration gate
// rejects it and regenerates. Anchored on the player ("you"); an NPC's death is not a
// fabrication, hypotheticals ("you would die") are warnings, and "death saving throw" is the
// mechanic, not a death claim.
describe('fabricatedOutcomeClaims — player death (#468)', () => {
  test('"you die" with no engine event is flagged', () => {
    expect(fabricatedOutcomeClaims('You step off the edge. You die instantly.').length).toBeGreaterThan(0);
  });

  test('"you are dead" is flagged', () => {
    expect(fabricatedOutcomeClaims('Darkness takes hold. You are dead.').length).toBeGreaterThan(0);
  });

  test('"you\'re dead" is flagged', () => {
    expect(fabricatedOutcomeClaims("The impact is total. You're dead.").length).toBeGreaterThan(0);
  });

  test('"kills you" is flagged', () => {
    expect(fabricatedOutcomeClaims('The fall kills you.').length).toBeGreaterThan(0);
  });

  test('"slays you" is flagged', () => {
    expect(fabricatedOutcomeClaims('The blade slays you where you stand.').length).toBeGreaterThan(0);
  });

  test('"your death" is flagged', () => {
    expect(fabricatedOutcomeClaims('Your death is instantaneous.').length).toBeGreaterThan(0);
  });

  test('"you would die" (hypothetical) is clean', () => {
    expect(fabricatedOutcomeClaims('You would die if you jumped from here.')).toEqual([]);
  });

  test('"if you die" (conditional) is clean', () => {
    expect(fabricatedOutcomeClaims('If you die, your friends will mourn.')).toEqual([]);
  });

  test('"you could die" (hypothetical) is clean', () => {
    expect(fabricatedOutcomeClaims('You could die down there. Turn back.')).toEqual([]);
  });

  test("an NPC's death is not the player's death", () => {
    expect(fabricatedOutcomeClaims('The goblin dies at your feet.')).toEqual([]);
  });

  test('negated death ("you do not die") is clean', () => {
    expect(fabricatedOutcomeClaims('You do not die today.')).toEqual([]);
  });

  test('"your death saving throw" is the mechanic, not a death claim', () => {
    expect(fabricatedOutcomeClaims('Make your death saving throw.')).toEqual([]);
  });

  test('"would have killed you" (inflected hypothetical) is clean', () => {
    expect(fabricatedOutcomeClaims('The trap would have killed you.')).toEqual([]);
  });

  test('"you die if you touch the altar" (trailing conditional) is clean', () => {
    expect(fabricatedOutcomeClaims('You die if you touch the altar.')).toEqual([]);
  });

  test('"I will kill you" (threat) is clean', () => {
    expect(fabricatedOutcomeClaims('The orc snarls, "I will kill you!"')).toEqual([]);
  });

  test('"trying to kill you" (attempt) is clean', () => {
    expect(fabricatedOutcomeClaims('The assassin lunges, trying to kill you.')).toEqual([]);
  });

  test('existing harm detection is unaffected', () => {
    expect(
      fabricatedOutcomeClaims('You narrowly avoid a strike from the entity.').length,
    ).toBeGreaterThan(0);
    expect(fabricatedOutcomeClaims('You walk down the corridor.')).toEqual([]);
  });

  // #468 NT-106 (strategist FIX): the DM narrated final death for a lethal free-text
  // action with no roll. Both sentences must be flagged.
  test('NT-106: "Your journey through the chasm ends here" is flagged', () => {
    expect(
      fabricatedOutcomeClaims('Your journey through the chasm ends here.').length,
    ).toBeGreaterThan(0);
  });

  test('NT-106: "You fall and die" is flagged', () => {
    expect(fabricatedOutcomeClaims('You fall and die.').length).toBeGreaterThan(0);
  });

  // False positives (strategist FIX): threats, abilities, and attempts are not death claims.
  test('"I\'ll kill you!" (contraction threat) is clean', () => {
    expect(fabricatedOutcomeClaims('The orc snarls, "I\'ll kill you!"')).toEqual([]);
  });

  test('"I’ll kill you!" (curly-apostrophe contraction threat) is clean', () => {
    expect(fabricatedOutcomeClaims('The orc snarls, "I’ll kill you!"')).toEqual([]);
  });

  test('"Move and you die." (imperative threat) is clean', () => {
    expect(fabricatedOutcomeClaims('Move and you die.')).toEqual([]);
  });

  test('"wants to kill you" (attempt) is clean', () => {
    expect(fabricatedOutcomeClaims('The assassin wants to kill you.')).toEqual([]);
  });

  test('"can kill you" (ability) is clean', () => {
    expect(fabricatedOutcomeClaims('This poison can kill you.')).toEqual([]);
  });

  test('"may kill you" (possibility) is clean', () => {
    expect(fabricatedOutcomeClaims('The fall may kill you.')).toEqual([]);
  });
});
