import { describe, expect, it } from 'vitest';

import { noMechanicalActionNotice, stillYourTurnNotice } from '../combat-notice';
import {
  SILENT_PLAYER_TURN_NOTE,
  SILENT_PLAYER_TURN_NOTE_WITH_ENGINE_LINES,
  SILENT_PLAYER_TURN_SETUP,
  silentPlayerTurnPayload,
  suspectsFabricatedOutcome,
} from '../silent-player-turn';

/**
 * #2342, run M8 round 3: "I try to talk the elemental down" left the engine with nothing to say,
 * and the DM narrated a spell hit and a wound. The note is the statement the DM was never given.
 */
describe('silent player turn prompt', () => {
  it('states plainly that nothing happened and that it is still the player’s turn', () => {
    expect(SILENT_PLAYER_TURN_NOTE).toContain('no mechanical effect');
    expect(SILENT_PLAYER_TURN_NOTE).toContain('No spell was cast');
    expect(SILENT_PLAYER_TURN_NOTE).toContain('no attack was made');
    expect(SILENT_PLAYER_TURN_NOTE).toContain('no damage was dealt or taken');
    expect(SILENT_PLAYER_TURN_NOTE).toContain('without any hit, damage, wound or spell');
    expect(SILENT_PLAYER_TURN_NOTE).toContain("still the player's turn");
  });

  it('hands the DM the player’s own words, since the narration pass sees nothing else of them', () => {
    expect(silentPlayerTurnPayload('  I try to talk the elemental down.  ', false)).toEqual({
      playerAttempt: 'I try to talk the elemental down.',
      silentPlayerTurnNote: SILENT_PLAYER_TURN_NOTE,
    });
  });

  it('scopes the note to the player’s action when engine lines are in the same pass', () => {
    const { silentPlayerTurnNote } = silentPlayerTurnPayload('I talk.', true);
    expect(silentPlayerTurnNote).toBe(SILENT_PLAYER_TURN_NOTE_WITH_ENGINE_LINES);
    expect(silentPlayerTurnNote).not.toMatch(/no damage was dealt or taken/i);
    expect(silentPlayerTurnNote).toContain('cast no spell and made no attack');
    expect(silentPlayerTurnNote).toContain("still the player's turn");
  });

  it('withholds the first-pass prose from the setup line', () => {
    expect(SILENT_PLAYER_TURN_SETUP).not.toMatch(/hit|damage|wound|spell connects/i);
    expect(SILENT_PLAYER_TURN_SETUP).toContain("still the player's turn");
  });

  it('keeps the turn open in a line distinct from the refusal notice', () => {
    expect(noMechanicalActionNotice()).toContain('still your turn');
    expect(noMechanicalActionNotice()).not.toBe(stillYourTurnNotice());
  });

  it('never claims nothing was rolled when engine lines share the reply', () => {
    expect(noMechanicalActionNotice(true)).toContain('still your turn');
    expect(noMechanicalActionNotice(true)).not.toContain('nothing was rolled');
  });
});

describe('suspectsFabricatedOutcome', () => {
  it.each([
    'Your spell connects with the shimmering spore-creature.',
    'It strikes you hard. You are wounded and reeling.',
    'The lash hits you across the ribs.',
    'You take 4 points of damage.',
  ])('flags %s', (text) => {
    expect(suspectsFabricatedOutcome(text)).toBe(true);
  });

  it.each([
    'No damage was dealt; the spores drift.',
    'Nothing lands: no spell, no hit, no damage.',
    'The elemental listens, without any hit, damage or wound.',
    'The elemental pauses, spores drifting, and listens.',
    'Hitherto quiet, the creature shivers.',
    '',
    null,
    undefined,
  ])('passes %s', (text) => {
    expect(suspectsFabricatedOutcome(text)).toBe(false);
  });
});
