import { describe, expect, it } from 'vitest';

import { noMechanicalActionNotice, stillYourTurnNotice } from '../combat-notice';
import { NEUTRAL_NO_EFFECT_LINE } from '../narration-gate';
import {
  SILENT_PLAYER_TURN_NOTE,
  SILENT_PLAYER_TURN_NOTE_WITH_ENGINE_LINES,
  SILENT_PLAYER_TURN_SETUP,
  fabricatedOutcomeClaims,
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

  it.each([undefined, '', '   '])('gives a plain refusal reason when its text is %s', (reason) => {
    const notice = stillYourTurnNotice(reason);
    expect(notice).toContain('the game could not resolve that action');
    expect(notice).toContain('End turn');
    expect(notice).not.toContain('undefined');
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

/**
 * #2373: the check is enforced now, so a false positive is a regeneration and a repeat is a
 * replaced reply. The lines below are what the DM writes on ordinary turns; the flagged ones are
 * the ways it has been seen to invent harm.
 */
describe('fabricatedOutcomeClaims', () => {
  const M9 =
    'Your attempt to bridge the divide with words falls flat as the pulsating shard remains ' +
    'entirely unresponsive, its erratic energy ignoring your plea completely. As you speak, you ' +
    'narrowly avoid a strike from the entity, though a glancing blow still leaves you feeling ' +
    'rattled and wounded.';

  it('names what run M9 round 3 invented', () => {
    const claims = fabricatedOutcomeClaims(M9);
    expect(claims).toEqual(
      expect.arrayContaining([
        'strike from the entity',
        'avoid a strike',
        'leaves you feeling rattled and wounded',
      ]),
    );
  });

  it.each([
    'You narrowly avoid a strike from the entity.',
    'A glancing blow still leaves you rattled.',
    'The bandit wounds you.',
    'The goblin lunges and attacks you.',
    'The blade slashes your arm.',
    'You lose 3 HP.',
    'You take 4 points of damage.',
    'You are poisoned.',
    'The blow leaves you paralyzed.',
    'It knocked you prone.',
    'Blood runs down your side; you are bleeding.',
    'Your spell connects with the creature.',
    // Strategist round 1, SHOULD 4: a negation does not reach across a clause.
    'The shard does not respond, but its strike hits you.',
    'Nothing stops the goblin as it hits you.',
    // Strategist round 1, NIT 9: harm without a verb of impact.
    'The claws rake across your ribs.',
    'The claw catches you across the cheek.',
    'Blood runs down your arm.',
    'You stagger back, hurt.',
    'You are hurt.',
    'You feel a searing pain.',
  ])('flags %s', (text) => {
    expect(suspectsFabricatedOutcome(text)).toBe(true);
  });

  it.each([
    'The smell of woodsmoke hits you as you step inside.',
    'Lightning strikes the old tower.',
    'You strike a match and the lantern flares.',
    'You strike your flint against the steel.',
    'A wounded soldier staggers toward you.',
    'The road wound through the hills toward you.',
    'The wind blows through your cloak.',
    'The creature does not strike you; it only watches.',
    'It never lands a blow that leaves you wounded.',
    'Nothing lands: no spell, no hit, no damage, and you are not hurt.',
    'You take a moment to breathe.',
    'Your sword hits the dummy with a satisfying thud.',
    'The shard remains entirely unresponsive, its erratic energy ignoring your plea completely.',
    NEUTRAL_NO_EFFECT_LINE,
    // Strategist round 1, SHOULD 3: someone else's injury, or no copula on the player.
    'You see a wounded soldier.',
    'Your wounded shoulder aches.',
    'You notice the bleeding stag.',
    // NIT 9 false positives.
    'Rain hits your face.',
    'The smith strikes your blade against the anvil.',
    // Negation still reaches within its own clause.
    'Nothing hits you; the creature only watches.',
    'The shard does not respond, and its strike does not hit you.',
  ])('passes %s', (text) => {
    expect(suspectsFabricatedOutcome(text)).toBe(false);
  });

  it('lets a turn where the player may have acted narrate their own spell, and nothing else', () => {
    const spell = 'Your spell lights the corridor.';
    expect(suspectsFabricatedOutcome(spell)).toBe(true);
    expect(suspectsFabricatedOutcome(spell, { playerMayHaveActed: true })).toBe(false);
    expect(suspectsFabricatedOutcome(M9, { playerMayHaveActed: true })).toBe(true);
  });
});
