import { describe, expect, test } from 'bun:test';

import { describeUnreachableApproach } from '../combat-approach-service.js';

/**
 * The sentence handed to the DM when an attacker walked but could not reach.
 *
 * It is the whole remedy for run 7's dishonesty: the DM is told the movement that happened
 * and the strike that did not, in words, so it narrates an approach instead of inventing a
 * bite. A DM told only "the attack failed" will always supply its own reason.
 */
describe('describeUnreachableApproach', () => {
  test('states the movement, the remaining gap, and the attack that did not happen', () => {
    const sentence = describeUnreachableApproach(
      'Shadow Roach',
      'The Seeker',
      {
        kind: 'unreachable',
        distanceFeet: 15,
        movedFeet: 30,
        from: { x: 13, y: 1 },
        to: { x: 7, y: 1 },
        reachFeet: 5,
      },
      'an attack with its Bite',
    );

    expect(sentence).toBe(
      'Shadow Roach moved 30ft, is now 15ft from The Seeker, and could not reach it (needs 5ft). ' +
        'Its action this turn was movement, not an attack with its Bite. Narrate the approach, not a strike.',
    );
  });

  test('an attacker that could not move at all says so plainly', () => {
    expect(
      describeUnreachableApproach(
        'Shadow Roach',
        'The Seeker',
        {
          kind: 'unreachable',
          distanceFeet: 40,
          movedFeet: 0,
          from: { x: 9, y: 1 },
          to: { x: 9, y: 1 },
          reachFeet: 5,
        },
        'an attack',
      ),
    ).toContain('could not move, is now 40ft from The Seeker');
  });
});
