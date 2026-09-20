import { beforeEach, describe, expect, it, mock } from 'bun:test';

const info = mock((_payload: Record<string, unknown>) => {});

mock.module('../../../lib/logger.js', () => ({
  logger: { info, warn: mock(() => {}), debug: mock(() => {}), error: mock(() => {}) },
}));

const { detectDeclaredAttack } = await import('../combat-intent-gate.js');

const actors = [
  { name: 'Professor Emil Darkwater' },
  { name: 'Captain Sarah Reeves' },
  { name: 'The Ghoul', monsterId: 'srd:ghoul' },
];

const soleActor = [{ name: 'Professor Emil Darkwater' }];

const positiveCorpus = [
  ['i take a swing and attempt to punch the professor', 'punch', 'Professor Emil Darkwater'],
  ['i punch the professor', 'punch', 'Professor Emil Darkwater'],
  ['I try to hit Reeves', 'hit', 'Captain Sarah Reeves'],
  ['swing my staff at the professor', 'swing', 'Professor Emil Darkwater'],
  ['attack the professor', 'attack', 'Professor Emil Darkwater'],
  ['i draw my dagger and stab the captain', 'stab', 'Captain Sarah Reeves'],
  ['cast fire bolt at the professor', 'cast Fire Bolt', 'Professor Emil Darkwater'],
  ['i take a swing at reeves', 'swing', 'Captain Sarah Reeves'],
  ['i punch the professor and then stab Reeves', 'stab', 'Captain Sarah Reeves'],
] as const;

const negativeCorpus = [
  "i don't want to punch him",
  'should I attack the professor?',
  'the professor punches the air',
  'i say "I could punch you" to the professor',
  'i punch the wall',
  'i walk over to the professor and ask about the journal',
] as const;

describe('detectDeclaredAttack', () => {
  beforeEach(() => {
    info.mockClear();
  });

  it('matches a short target token to the full narrative-ledger actor name', () => {
    expect(detectDeclaredAttack('i punch Darkwater', actors)).toEqual({
      verb: 'punch',
      actorName: 'Professor Emil Darkwater',
      attackSource: 'unarmed',
      weaponStated: false,
    });
  });

  it.each(['hit', 'strike'])('classifies a bare %s as an unarmed attack', (verb) => {
    expect(detectDeclaredAttack(`${verb} Darkwater`, actors)).toMatchObject({
      verb,
      actorName: 'Professor Emil Darkwater',
      attackSource: 'unarmed',
    });
  });

  it('captures a trailing staff claim from a raw hit phrase', () => {
    expect(detectDeclaredAttack('hit him with my staff', soleActor)).toMatchObject({
      verb: 'hit',
      actorName: 'Professor Emil Darkwater',
      attackSource: 'weapon',
      weaponName: 'staff',
    });
  });

  it('captures a trailing sword claim from a raw strike phrase', () => {
    expect(detectDeclaredAttack('strike him with my sword', soleActor)).toMatchObject({
      verb: 'strike',
      actorName: 'Professor Emil Darkwater',
      attackSource: 'weapon',
      weaponName: 'sword',
    });
  });

  it('keeps a raw strike without a weapon word unarmed', () => {
    const attack = detectDeclaredAttack('I strike him', soleActor);

    expect(attack).toMatchObject({
      verb: 'strike',
      actorName: 'Professor Emil Darkwater',
      attackSource: 'unarmed',
    });
    expect(attack).not.toHaveProperty('weaponName');
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith({
      msg: 'COMBAT_INTENT_PRONOUN_RESOLVED',
      verb: 'strike',
      pronoun: 'him',
      actorName: 'Professor Emil Darkwater',
    });
  });

  it('accepts the conversational attack prefixes', () => {
    expect(detectDeclaredAttack('we attempt to swing at Darkwater', actors)).toMatchObject({
      verb: 'swing',
      actorName: 'Professor Emil Darkwater',
    });
  });

  it('does not classify a question as an attack', () => {
    expect(detectDeclaredAttack('I ask Darkwater why he lied', actors)).toBeNull();
  });

  it('requires a damaging spell for cast intent', () => {
    expect(detectDeclaredAttack('Cast Light at the ghoul', actors)).toBeNull();
    expect(detectDeclaredAttack('Cast Fireball at the ghoul', actors)).toBeNull();
    expect(detectDeclaredAttack('cast Magic Missile at the ghoul', actors)).toEqual({
      verb: 'cast Magic Missile',
      actorName: 'The Ghoul',
      monsterId: 'srd:ghoul',
      attackSource: 'spell',
      weaponName: 'spell:Magic Missile',
      spellId: 'magic-missile',
      spellName: 'Magic Missile',
    });
    expect(detectDeclaredAttack('cast Magic Missile at the ghoul', actors)).not.toMatchObject({
      weaponStated: true,
    });
  });

  it.each(positiveCorpus)('detects %s as %s against %s', (input, verb, actorName) => {
    expect(detectDeclaredAttack(input, actors)).toMatchObject({ verb, actorName });
  });

  it.each(negativeCorpus.map((input) => [input]))(
    'does not detect %s as a declared attack',
    (input) => {
      expect(detectDeclaredAttack(input, actors)).toBeNull();
    },
  );

  it('does not treat in-combat de-escalation speech as a declared attack', () => {
    const umeboshi = [{ name: 'Professor Umeboshi' }];
    expect(
      detectDeclaredAttack(
        'Professor, put the dagger down. We can end this without anyone getting hurt.',
        umeboshi,
      ),
    ).toBeNull();
  });

  it('detects a stated dagger as a weapon attack', () => {
    expect(detectDeclaredAttack('I stab her with the dagger', soleActor)).toMatchObject({
      verb: 'stab',
      actorName: 'Professor Emil Darkwater',
      attackSource: 'weapon',
      weaponName: 'dagger',
      weaponStated: true,
    });
  });

  it('still detects an attack after a de-escalation clause in the same turn', () => {
    expect(
      detectDeclaredAttack("I don't want to hurt you, but I swing my sword at him", soleActor),
    ).toMatchObject({
      verb: 'swing',
      actorName: 'Professor Emil Darkwater',
      attackSource: 'weapon',
      weaponName: 'sword',
      weaponStated: true,
    });
  });

  it('does not treat a bare weapon observation as a declared attack', () => {
    expect(detectDeclaredAttack('That dagger looks old.', actors)).toBeNull();
    expect(detectDeclaredAttack('He pointed at the dagger on the table.', actors)).toBeNull();
    expect(detectDeclaredAttack('She draws water from the well.', actors)).toBeNull();
    expect(detectDeclaredAttack('My blade meets his.', soleActor)).toBeNull();
  });

  it('detects go for him with the dagger as a stated dagger attack', () => {
    expect(detectDeclaredAttack('I go for him with the dagger', soleActor)).toMatchObject({
      verb: 'go for',
      actorName: 'Professor Emil Darkwater',
      attackSource: 'weapon',
      weaponName: 'dagger',
      weaponStated: true,
    });
  });

  it('treats I attack with no weapon as an Unarmed Strike', () => {
    const attack = detectDeclaredAttack('I attack the professor', actors);
    expect(attack).toMatchObject({
      verb: 'attack',
      actorName: 'Professor Emil Darkwater',
      attackSource: 'unarmed',
      weaponStated: false,
    });
    expect(attack).not.toHaveProperty('weaponName');
  });
});
