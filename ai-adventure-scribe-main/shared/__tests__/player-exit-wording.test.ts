import { describe, expect, it } from 'vitest';

import { playerTextDeclares } from '../player-exit-wording';

/**
 * #749: a player who backs away is moving, not fleeing. The DM may only end the player's fight
 * on an explicit exit word in the player's own text.
 */
describe('playerTextDeclares', () => {
  const movement = [
    'I back away slowly, keeping my dagger hand up, edging back toward Kaelen.',
    'I step back.',
    'I edge toward Kaelen.',
    'I retreat a few steps toward the door.',
  ];

  it.each(movement)('reads free-text movement as no exit: %s', (text) => {
    expect(playerTextDeclares('flee', text)).toBe(false);
    expect(playerTextDeclares('yield', text)).toBe(false);
    expect(playerTextDeclares('disengage', text)).toBe(false);
  });

  it.each(['I flee!', 'I run away', 'I bolt for the door', 'I make a run for the stairs'])(
    'recognises flee wording: %s',
    (text) => {
      expect(playerTextDeclares('flee', text)).toBe(true);
    },
  );

  it.each(['I yield', 'I surrender', 'I give up'])('recognises yield wording: %s', (text) => {
    expect(playerTextDeclares('yield', text)).toBe(true);
  });

  it('recognises disengage and its forms', () => {
    expect(playerTextDeclares('disengage', 'I disengage and move back')).toBe(true);
    expect(playerTextDeclares('disengage', 'Disengaging, I slip past him')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(playerTextDeclares('flee', 'I FLEE!')).toBe(true);
    expect(playerTextDeclares('yield', 'I Yield.')).toBe(true);
  });
});
