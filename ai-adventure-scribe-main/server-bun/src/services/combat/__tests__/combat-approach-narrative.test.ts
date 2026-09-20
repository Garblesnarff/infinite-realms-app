import { describe, expect, mock, test } from 'bun:test';

mock.module('../../../../../db/client', () => ({ db: {} }));

const { describeUnreachableApproach } = await import('../combat-approach-service.js');

/**
 * The sentence handed to the DM when an attacker walked but could not reach.
 *
 * It is the whole remedy for run 7's dishonesty: the DM is told the movement that happened
 * and the strike that did not, in words, so it narrates an approach instead of inventing a
 * bite. A DM told only "the attack failed" will always supply its own reason.
 */
describe('describeUnreachableApproach', () => {
  test('states the start distance, route cost, movement budget, and attack that did not happen', () => {
    const sentence = describeUnreachableApproach(
      'Shadow Roach',
      'The Seeker',
      {
        kind: 'unreachable',
        startingDistanceFeet: 35,
        distanceFeet: 15,
        movedFeet: 30,
        movementAvailableFeet: 30,
        movementRemainingFeet: 0,
        pathCostFeet: 35,
        from: { x: 13, y: 1 },
        to: { x: 7, y: 1 },
        reachFeet: 5,
        blockingCell: { x: 5, y: 5 },
        blockingObstacle: 'wall',
        reason: 'movement_exhausted',
      },
      'an attack with its Bite',
    );

    expect(sentence).toBe(
      'Shadow Roach could not reach The Seeker: started 35 ft away; 35 ft path (wall at 5,5) with 30 ft of movement; moved 30 ft, now 15 ft away; no attack was rolled.',
    );
  });

  test('an attacker that could not move at all says so plainly', () => {
    expect(
      describeUnreachableApproach(
        'Shadow Roach',
        'The Seeker',
        {
          kind: 'unreachable',
          startingDistanceFeet: 40,
          distanceFeet: 40,
          movedFeet: 0,
          movementAvailableFeet: 0,
          movementRemainingFeet: 0,
          pathCostFeet: 35,
          from: { x: 9, y: 1 },
          to: { x: 9, y: 1 },
          reachFeet: 5,
          reason: 'movement_exhausted',
        },
        'an attack',
      ),
    ).toContain('started 40 ft away; 35 ft path with 0 ft of movement; moved 0 ft, now 40 ft away');
  });
});
