/**
 * Intent translation for the mid-combat checks (#2420).
 *
 * Pins the four phrasings the issue names, the guards that keep a question or a quotation from
 * becoming an action, and — the no-silent-drop requirement — that a check the engine does NOT own
 * comes back with a reason code instead of vanishing.
 */
import { describe, expect, it } from 'bun:test';

import { detectCombatCheck } from '../../../../../shared/combat-check-intent.js';

import type { CombatCheckIntentKind } from '../../../../../shared/combat-check-intent.js';

const goblinOnly = [{ name: 'Goblin' }];
const twoHostiles = [{ name: 'Goblin' }, { name: 'Ogre' }];

describe('the four phrasings from issue #2420', () => {
  it('turns "shove the goblin" into a shove on the goblin', () => {
    const detection = detectCombatCheck('shove the goblin', goblinOnly);

    expect(detection.intent).toEqual({ kind: 'shove', verb: 'shove', targetName: 'Goblin' });
    expect(detection.reason).toBeUndefined();
  });

  it('turns "grapple it" into a grapple when the pronoun is unambiguous', () => {
    const detection = detectCombatCheck('grapple it', goblinOnly);

    expect(detection.intent?.kind).toBe('grapple');
    expect(detection.intent?.targetName).toBe('Goblin');
  });

  it('turns "hide behind the pillar" into a hide with no target', () => {
    const detection = detectCombatCheck('hide behind the pillar', twoHostiles);

    expect(detection.intent).toEqual({ kind: 'hide', verb: 'hide' });
  });

  it('turns "talk it down" into a persuasion parley', () => {
    const detection = detectCombatCheck('talk it down', goblinOnly);

    expect(detection.intent?.kind).toBe('parley');
    expect(detection.intent?.parleySkill).toBe('persuade');
  });
});

describe('verb synonyms', () => {
  const synonyms: Array<[string, CombatCheckIntentKind]> = [
    ['push the goblin', 'shove'],
    ['barge the goblin', 'shove'],
    ['grab the goblin', 'grapple'],
    ['seize the goblin', 'grapple'],
    ['sneak behind the pillar', 'hide'],
    ['take cover', 'hide'],
  ];

  it.each(synonyms)('reads %s as %s', (phrase, kind) => {
    expect(detectCombatCheck(phrase, goblinOnly).intent?.kind).toBe(kind);
  });

  it('reads "intimidate the goblin" as an intimidation parley', () => {
    const detection = detectCombatCheck('intimidate the goblin', goblinOnly);

    expect(detection.intent?.kind).toBe('parley');
    expect(detection.intent?.parleySkill).toBe('intimidate');
  });
});

describe('first-person and padded phrasing', () => {
  const padded: Array<[string, CombatCheckIntentKind]> = [
    ['I shove the goblin', 'shove'],
    ['I try to shove the goblin hard', 'shove'],
    ['And I grapple the goblin', 'grapple'],
    ["I'll shove the goblin", 'shove'],
    ['I quickly shove the goblin', 'shove'],
  ];

  it.each(padded)('resolves %s as %s', (phrase, kind) => {
    expect(detectCombatCheck(phrase, goblinOnly).intent?.kind).toBe(kind);
  });
});

describe('guards: nothing becomes an action by accident', () => {
  it('does not treat a question as an attempt', () => {
    expect(detectCombatCheck('Can I shove the goblin?', goblinOnly).reason).toBe('not_a_check');
    expect(detectCombatCheck('Should I grapple the goblin?', goblinOnly).reason).toBe(
      'not_a_check',
    );
    expect(detectCombatCheck('what if I shove the goblin', goblinOnly).reason).toBe('not_a_check');
  });

  it('does not treat a refusal as an attempt', () => {
    expect(detectCombatCheck('I do not want to shove the goblin', goblinOnly).reason).toBe(
      'not_a_check',
    );
  });

  it('does not treat a quoted sentence as the player declaring an action', () => {
    expect(detectCombatCheck('"shove the goblin"', goblinOnly).reason).toBe('not_a_check');
  });

  it('leaves an ordinary message and an attack alone', () => {
    expect(detectCombatCheck('hello there', goblinOnly).reason).toBe('not_a_check');
    expect(detectCombatCheck('attack the goblin', goblinOnly).reason).toBe('not_a_check');
    expect(detectCombatCheck('', goblinOnly).reason).toBe('not_a_check');
  });
});

describe('ambiguity is refused rather than guessed', () => {
  it('refuses a pronoun when the roster holds two hostiles', () => {
    // Resolving "grapple it" to the wrong goblin would grapple the wrong creature.
    expect(detectCombatCheck('grapple it', twoHostiles).reason).toBe('no_target_actor');
  });

  it('still resolves a named target when other hostiles are on the board', () => {
    expect(detectCombatCheck('shove the goblin', twoHostiles).intent?.targetName).toBe('Goblin');
  });

  it('refuses a named target that is not on the roster', () => {
    expect(detectCombatCheck('shove the dragon', goblinOnly).reason).toBe('no_target_actor');
  });
});

describe('no silent drop: the unknown-verb path carries a reason code', () => {
  it.each([
    'I negotiate with the goblin',
    'I bargain with the goblin',
    'I try to convince the goblin to stand down',
    'I charm the goblin',
    'I bluff my way past the goblin',
  ])('reports %s as unrecognised_check, not as nothing', (phrase) => {
    const detection = detectCombatCheck(phrase, goblinOnly);

    expect(detection.reason).toBe('unrecognised_check');
    expect(detection.clause).not.toBe('');
    expect(detection.intent).toBeUndefined();
  });

  it('keeps the clause so the log names what the player actually typed', () => {
    expect(detectCombatCheck('I bargain with the goblin', goblinOnly).clause).toBe(
      'I bargain with the goblin',
    );
  });
});

describe('escaping a grapple', () => {
  it.each([
    'break free',
    'I try to break free of the grapple',
    'wriggle free',
    'escape the grapple',
    'struggle free of its grip',
  ])('turns "%s" into an escape that names no target', (sentence) => {
    const detection = detectCombatCheck(sentence, twoHostiles);

    expect(detection.intent).toEqual({ kind: 'escape', verb: expect.any(String) });
    expect(detection.reason).toBeUndefined();
  });

  it('does not read leaving the room as an escape from a grapple', () => {
    const detection = detectCombatCheck('I escape through the door', twoHostiles);

    expect(detection.intent).toBeUndefined();
  });
});
