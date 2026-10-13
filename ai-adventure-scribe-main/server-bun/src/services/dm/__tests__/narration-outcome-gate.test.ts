import { describe, expect, test } from 'bun:test';

import {
  contradictsEngineOutcome,
  type EngineOutcome,
} from '../../../../../shared/narration-harm.js';

// #266: a failed check narrated as a success (Hark GP-041: Stealth 7 vs DC 14 narrated as
// "practiced stillness"), and the reverse from the issue's comments (CB-064: an engine HIT for
// 3 damage narrated as "the strike goes wide and misses entirely").
//
// The outcome below has the `PersistedRollOutcome` shape exactly as
// `SessionStateService.getLatestRollOutcome` builds it from the combat log's `roll_result`
// entry — the same object the DM prompt carries as `lastRollOutcome`. The mocked reply uses
// the real DM response envelope fields (`dm-response-schema.ts`): text, options,
// narration_segments, combat_transition.
const FAILED_STEALTH: EngineOutcome = {
  success: false,
  total: 7,
  dc: 14,
  requestType: 'skill_check',
  description: 'Stealth check to climb the shaft unheard',
  timestamp: '2026-10-10T02:49:00.000Z',
} as EngineOutcome;

const engineHit: EngineOutcome = { success: true };
const attackHit: EngineOutcome = {
  success: true,
  requestType: 'attack',
  description: 'Attack the goblin with your sword',
};

/** A DM reply envelope in the real parsed shape, with the text under test. */
const reply = (text: string): Record<string, unknown> => ({
  text,
  options: ['Sneak past the guards', 'Climb back down'],
  narration_segments: [{ type: 'dm', text }],
  combat_transition: 'none',
  dice_rolls: [],
});

describe('contradictsEngineOutcome (#266)', () => {
  test('a failed check narrated as a success is flagged', () => {
    const envelope = reply(
      'You move with practiced stillness up the shaft. You succeed without a sound, ' +
        'unseen and unheard.',
    );
    const claims = contradictsEngineOutcome(envelope.text as string, FAILED_STEALTH);
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.map((c) => c.match).join(' ')).toContain('you succeed');
  });

  test('a failed check narrated in past tense as a success is flagged', () => {
    const envelope = reply(
      'You succeeded in climbing the shaft unnoticed. You managed to stay silent.',
    );
    expect(
      contradictsEngineOutcome(envelope.text as string, FAILED_STEALTH).length,
    ).toBeGreaterThan(0);
  });

  test('a failed check narrated as a failure is clean', () => {
    const envelope = reply(
      'Your foot scrapes loose stone halfway up. The clatter echoes down the shaft — ' +
        'you fail to stay quiet, and something below stirs.',
    );
    expect(contradictsEngineOutcome(envelope.text as string, FAILED_STEALTH)).toEqual([]);
  });

  test("an NPC's success is not a contradiction", () => {
    const envelope = reply('The guard successfully spots you in the shadows and raises the alarm.');
    expect(contradictsEngineOutcome(envelope.text as string, FAILED_STEALTH)).toEqual([]);
  });

  test('the named character succeeding is flagged', () => {
    const envelope = reply('Mira succeeded in climbing the shaft unnoticed.');
    expect(
      contradictsEngineOutcome(envelope.text as string, {
        ...FAILED_STEALTH,
        characterName: 'Mira',
      }).length,
    ).toBeGreaterThan(0);
  });

  test('the named character succeeding is clean without the name', () => {
    const envelope = reply('Mira succeeded in climbing the shaft unnoticed.');
    expect(contradictsEngineOutcome(envelope.text as string, FAILED_STEALTH)).toEqual([]);
  });

  test('an engine hit narrated as a miss is flagged (CB-064)', () => {
    const envelope = reply(
      'Your blade flashes out, but the strike goes wide and misses entirely. The goblin ' +
        'grins, untouched at 1 hit point.',
    );
    const claims = contradictsEngineOutcome(envelope.text as string, attackHit);
    expect(claims.length).toBeGreaterThan(0);
  });

  test('an engine hit narrated in past tense as a miss is flagged', () => {
    // "Your strike" is player-possessed; "fell short of the goblin" names the target.
    const envelope = reply('Your strike went wide. Your blow fell short of the goblin.');
    expect(contradictsEngineOutcome(envelope.text as string, attackHit).length).toBeGreaterThan(0);
  });

  test('an engine hit narrated as a hit is clean', () => {
    const envelope = reply(
      'Your blade bites deep. The goblin reels, bloodied and barely standing at 1 hit point.',
    );
    expect(contradictsEngineOutcome(envelope.text as string, engineHit)).toEqual([]);
  });

  test('"you miss the sunrise" is not a failed attack', () => {
    const envelope = reply('Dawn breaks. You miss the sunrise, still climbing in the dark.');
    expect(contradictsEngineOutcome(envelope.text as string, engineHit)).toEqual([]);
  });

  test('negation in an earlier clause does not excuse the success claim', () => {
    const envelope = reply('The guard does not notice you and you succeed without a sound.');
    expect(
      contradictsEngineOutcome(envelope.text as string, FAILED_STEALTH).length,
    ).toBeGreaterThan(0);
  });

  test('a failed check may still have a consequence without contradicting the verdict', () => {
    const envelope = reply(
      'You fail to keep quiet. Loose stones clatter down the shaft, and you take 2 damage ' +
        'scraping against the rough wall.',
    );
    expect(contradictsEngineOutcome(envelope.text as string, FAILED_STEALTH)).toEqual([]);
  });

  test("the monster's miss is not the player's miss (strategist FIX)", () => {
    // Engine hit = the PLAYER's attack hit. The goblin's own arrow missing the player is a
    // different attack and does not contradict the verdict.
    const envelope = reply(
      'Your blade bites deep into the goblin. The goblin\'s arrow misses you, clattering off the wall.',
    );
    expect(contradictsEngineOutcome(envelope.text as string, engineHit)).toEqual([]);
  });

  test("an ogre's club missing is not the player's miss", () => {
    const envelope = reply(
      'Your swing lands true. The ogre\'s club misses you by a hair.',
    );
    expect(contradictsEngineOutcome(envelope.text as string, engineHit)).toEqual([]);
  });

  test('the named character missing with their own attack is flagged', () => {
    const envelope = reply("Mira's swing misses the goblin by inches.");
    expect(
      contradictsEngineOutcome(envelope.text as string, { ...attackHit, characterName: 'Mira' })
        .length,
    ).toBeGreaterThan(0);
  });

  test('"an arrow from the dark misses you" is not the player\'s miss (strategist FIX)', () => {
    // Unpossessed attack noun, no target named: not the player's attack, no repair.
    const envelope = reply('Your blade bites deep. An arrow from the dark misses you.');
    expect(contradictsEngineOutcome(envelope.text as string, attackHit)).toEqual([]);
  });

  test('"An attack from the dark misses you" is not the player\'s miss (strategist FIX round 4)', () => {
    // The requestType word "attack" appears in the sentence, but it is not the target's
    // word: unpossessed, no target named, no repair.
    const envelope = reply('Your blade bites deep. An attack from the dark misses you.');
    expect(contradictsEngineOutcome(envelope.text as string, attackHit)).toEqual([]);
  });

  test('an unpossessed miss naming the target is the player\'s miss (strategist FIX)', () => {
    // "misses the goblin": the clause names the rolled target (goblin in the description).
    const envelope = reply('Your blade bites deep. The swing misses the goblin by inches.');
    expect(contradictsEngineOutcome(envelope.text as string, attackHit).length).toBeGreaterThan(0);
  });

  test('a miss on a non-attack roll is not a contradiction (strategist FIX)', () => {
    // Failed Stealth check (not an attack): "arrow misses" does not contradict it.
    const envelope = reply('You fail to stay quiet. An arrow misses you in the dark.');
    expect(contradictsEngineOutcome(envelope.text as string, FAILED_STEALTH)).toEqual([]);
  });

  test('"his eyes go wide" is not a miss', () => {
    const envelope = reply('Your blade bites deep. His eyes go wide as he staggers.');
    expect(contradictsEngineOutcome(envelope.text as string, engineHit)).toEqual([]);
  });

  test('"you manage to catch your breath" is recovery, not a verdict (strategist FIX)', () => {
    // Failed Stealth check; the sentence never names the climb, so the soft "manage to"
    // does not contradict the verdict.
    const envelope = reply(
      'Your foot scrapes stone and the guards turn. You manage to catch your breath behind the pillar.',
    );
    expect(contradictsEngineOutcome(envelope.text as string, FAILED_STEALTH)).toEqual([]);
  });

  test('"you are successful" at an unnamed action is not a contradiction', () => {
    const envelope = reply(
      'You fail to keep quiet. Still, you are successful in catching your breath.',
    );
    expect(contradictsEngineOutcome(envelope.text as string, FAILED_STEALTH)).toEqual([]);
  });

  test('soft success language naming the rolled action is still flagged', () => {
    const envelope = reply('You manage to climb the shaft unheard, silent as a shadow.');
    expect(
      contradictsEngineOutcome(envelope.text as string, FAILED_STEALTH).length,
    ).toBeGreaterThan(0);
  });

  test('soft success language is unanchored when the outcome names no action', () => {
    // No description/requestType: nothing to anchor on, so the claim stands as before.
    const envelope = reply('You manage to catch your breath behind the pillar.');
    expect(
      contradictsEngineOutcome(envelope.text as string, { success: false }).length,
    ).toBeGreaterThan(0);
  });
});
