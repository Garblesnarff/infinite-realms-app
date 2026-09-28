import { describe, expect, it } from 'vitest';

import { isPlayerInputOrigin, playerInputOriginOf } from '../combat-action-origin';

describe('the origin of a turn (#2305)', () => {
  it('reads each kind of player message as player input', () => {
    expect(playerInputOriginOf({ sender: 'player', context: null })).toBe('typed');
    expect(
      playerInputOriginOf({
        sender: 'player',
        context: { intent: 'spell_cast', spellId: 'chill-touch', spellLevel: 0 },
      }),
    ).toBe('sheet_cast');
    expect(playerInputOriginOf({ sender: 'player', context: { intent: 'dice_roll' } })).toBe(
      'dice_roll',
    );
    expect(playerInputOriginOf({ sender: 'player', context: { origin: 'action_bar' } })).toBe(
      'action_bar',
    );
  });

  it('reads anything that is not a player message as no input', () => {
    expect(playerInputOriginOf({ sender: 'dm', context: null })).toBeNull();
    expect(playerInputOriginOf({ sender: 'system' })).toBeNull();
    expect(playerInputOriginOf(undefined)).toBeNull();
  });

  it('lets only player input act for the player', () => {
    expect(isPlayerInputOrigin('typed')).toBe(true);
    expect(isPlayerInputOrigin('sheet_cast')).toBe(true);
    expect(isPlayerInputOrigin('dm')).toBe(false);
    expect(isPlayerInputOrigin('repair')).toBe(false);
  });
});
