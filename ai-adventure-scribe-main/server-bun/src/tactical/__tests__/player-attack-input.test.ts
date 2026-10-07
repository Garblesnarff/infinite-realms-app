import { describe, expect, test } from 'bun:test';

import { readPlayerAttack } from '../player-attack-input.js';

/**
 * The reader on its own: typed inputs against what the floor may act on (#2641). The objects are
 * the two questions the floor asks of the board, answered the way its digest would for a fight
 * with a zombie, a roach, a monk and a goblin, and a weapon vocabulary.
 */
const objects = {
  namesHostile: (text: string) => /zombie|roach|monk|goblin|guard|shield guard/i.test(text),
  namesWeapon: (text: string) => /sword|axe|bow|crossbow|javelin|dagger|greataxe/i.test(text),
};
const read = (input: string) => readPlayerAttack(input, objects);

describe('typed attacks fire', () => {
  test.each([
    'I swing my sword at the goblin',
    'I attack!',
    'attack the goblin',
    'I hit it with my axe',
    'I stab him',
    'I shoot it with my bow',
    'I punch the guard',
    'I lunge at the zombie',
    'I try to hit the monk',
    'I want to attack the monk',
    "I'll attack the roach",
    'yes, attack',
    'I slash at it twice',
    'I headbutt the zombie',
    'I make two attacks on the zombie',
    'Attacking the zombie',
    "I'm hitting it",
    'Im gonna hit it',
    'I drive my axe into it',
    'I bring my axe down on the zombie',
    'I smash the zombie',
    'Smash the zombie with my axe',
    'I bite the zombie',
    'I slam into the zombie',
    'I lash out at the goblin',
    "I go for the zombie's throat with my dagger",
    'I use my greataxe on it',
    "let's kill it",
    'I charge the zombie',
    'I throw my javelin at the monk',
    'I shoot the zombie',
  ])('%s', (input) => {
    expect(read(input).declared).toBe(true);
  });

  test.each([
    'I attack the zombie without mercy',
    'I swing my sword without hesitation at the zombie',
    'I attack the goblin with no fear',
    'I attack the zombie not holding back',
    'I attack the no-good goblin',
    'I attack the not-so-friendly monk',
    'I attack the Count of No Return',
    "I swing my sword at the zombie that's not moving",
    "I attack the zombie that isn't moving",
    "I attack the monk who isn't armed",
    'I attack the nobleman',
    'I attack the monk, no mercy',
    'I strike the knot',
    "I attack the zombie, but I don't kill it",
    "I don't hold back and attack the monk",
    'I attack the Sword and Shield Guard',
    'I attack the zombie with my sword and shield',
    'I cast Fire Bolt on the roach no wait the zombie',
  ])('a refusal-looking word that is not a refusal does not drop it: %s', (input) => {
    expect(read(input).declared).toBe(true);
  });

  test('a creature name with "and" in it is read whole', () => {
    expect(read('I attack the Sword and Shield Guard').source).toContain('Sword and Shield Guard');
  });
});

describe('what the player refused is not read', () => {
  test('a refused creature is not the source of the target', () => {
    const { source } = read('I attack the zombie, not the monk');
    expect(source).toContain('zombie');
    expect(source).not.toContain('monk');
  });

  test('a refused spell and weapon are not in the source', () => {
    const spell = read("I don't cast Sacred Flame, I swing my sword");
    expect(spell.source).toContain('sword');
    expect(spell.source).not.toContain('Sacred Flame');
    const weapon = read("I don't use my longbow, I swing my sword");
    expect(weapon.source).toContain('sword');
    expect(weapon.source).not.toContain('longbow');
  });
});

describe('not an attack', () => {
  test.each([
    "I don't want to fight",
    "I'm not going to hit anyone",
    'I refrain from attacking',
    'I stop attacking',
    'I stop swinging',
    'I hold off on attacking',
    'I hesitate to attack',
    "I'm afraid to attack",
    'I decide against attacking',
    'I keep from hitting him',
    'I attack nobody',
    'I choose not to attack',
    "I can't attack",
    'I never attack',
    'I refuse to attack',
    'I make no attack this turn',
  ])('refused or stopped: %s', (input) => {
    expect(read(input).declared).toBe(false);
  });

  test.each([
    'Should I attack?',
    'Can I attack the zombie?',
    'What if I attack the zombie?',
    'Do I need to attack?',
    'I attack the zombie? no, I wait',
    'I might attack the zombie if it moves',
    'If the zombie moves, I attack',
    'I could attack but I won',
    'I ready an attack for when it moves',
  ])('a question, plan or maybe: %s', (input) => {
    expect(read(input).declared).toBe(false);
  });

  test.each([
    'I watch the zombie attack',
    'I let the monk hit it',
    'I help the monk fight',
    'I throw a coin at the monk',
    'I shoot a glance at the zombie',
    'I strike a match',
    'I strike a pose',
    'I strike a deal with the monk',
    'I hit the road',
    'I hit the dirt',
    'I hit the brakes',
    'I swing the door open',
    'I swing on the rope to the ledge',
    'I kick open the door',
    'I kick down the door',
    'I dodge their attack',
    'I brace for their attack',
    'I raise my shield to block the hit',
    'I get hit by the zombie',
    'I rush to the door and shut it',
    'I charge toward the stairs',
    'I throw the rope across the gap',
    'I fire up the torch',
    'I shove the barrel aside',
    'The zombie attacks me',
    'I look at the zombie',
    'I talk to the monk and wait',
    'I hide behind the crate',
    'I take cover',
    'I disengage',
  ])('not a fight: %s', (input) => {
    expect(read(input).declared).toBe(false);
  });
});
