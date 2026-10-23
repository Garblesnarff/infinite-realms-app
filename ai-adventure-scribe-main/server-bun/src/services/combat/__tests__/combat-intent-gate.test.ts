import { beforeEach, describe, expect, it, mock } from 'bun:test';

const info = mock((_payload: Record<string, unknown>) => {});

mock.module('../../../lib/logger.js', () => ({
  logger: { info, warn: mock(() => {}), debug: mock(() => {}), error: mock(() => {}) },
}));

const {
  detectDeclaredAttack,
  detectDeclaredDefense,
  detectDeclaredLayOnHands,
  detectDeclaredSecondWind,
} = await import('../combat-intent-gate.js');

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

  it.each(['hit', 'strike'])(
    'classifies a bare %s as a weapon attack (generic verb, not a body part) (#569)',
    (verb) => {
      expect(detectDeclaredAttack(`${verb} Darkwater`, actors)).toMatchObject({
        verb,
        actorName: 'Professor Emil Darkwater',
        attackSource: 'weapon',
      });
    },
  );

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

  it('keeps an approach target when the attack follows as a pronoun', () => {
    expect(
      detectDeclaredAttack('I move toward the Chiropteran Hulk and attack it with my sword', [
        { name: 'Chiropteran Hulk' },
        { name: 'The Veteran' },
      ]),
    ).toMatchObject({
      verb: 'attack',
      actorName: 'Chiropteran Hulk',
      attackSource: 'weapon',
      weaponName: 'sword',
    });
  });

  it('treats a raw strike without a weapon word as a weapon attack (#569)', () => {
    const attack = detectDeclaredAttack('I strike him', soleActor);

    expect(attack).toMatchObject({
      verb: 'strike',
      actorName: 'Professor Emil Darkwater',
      attackSource: 'weapon',
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

  it('treats a bare I attack with no weapon as the default equipped weapon (#569)', () => {
    const attack = detectDeclaredAttack('I attack the professor', actors);
    expect(attack).toMatchObject({
      verb: 'attack',
      actorName: 'Professor Emil Darkwater',
      attackSource: 'weapon',
      weaponStated: false,
    });
    expect(attack).not.toHaveProperty('weaponName');
  });

  it('weighs a hostile title or a placed pronoun against the one creature present (#862)', () => {
    const marrow = [{ name: 'Dr. Marrow' }];
    expect(detectDeclaredAttack('I grab the Professor', marrow)).toMatchObject({
      verb: 'grab',
      actorName: 'Dr. Marrow',
      attackSource: 'unarmed',
    });
    expect(detectDeclaredAttack('I shove him off the ledge', marrow)).toMatchObject({
      verb: 'shove',
      actorName: 'Dr. Marrow',
    });
    expect(detectDeclaredAttack('I smash the cauldron', marrow)).toBeNull();
    expect(
      detectDeclaredAttack('I punch Valerius the Upside Down', [
        { name: 'Valerius' },
        { name: 'Valerius the Upside Down' },
      ]),
    ).toMatchObject({ actorName: 'Valerius the Upside Down', verb: 'punch' });
    expect(
      detectDeclaredAttack('I attack General Out', [
        { name: 'General Voss' },
        { name: 'General Out' },
      ]),
    ).toMatchObject({ actorName: 'General Out', verb: 'attack' });
    expect(
      detectDeclaredAttack('I grab the Professor', [{ name: 'Dr. Marrow' }, { name: 'Valerius' }]),
    ).toBeNull();
    expect(
      detectDeclaredAttack(
        'I shove him off the ledge',
        [{ name: 'Dr. Marrow' }, { name: 'Valerius' }],
        {
          antecedent: { name: 'Dr. Marrow' },
        },
      ),
    ).toMatchObject({ actorName: 'Dr. Marrow', verb: 'shove' });
    expect(
      detectDeclaredAttack('I grab the Professor', [{ name: 'Dr. Marrow' }, { name: 'Valerius' }], {
        antecedent: null,
      }),
    ).toBeNull();
  });

  it('keeps an explicit unarmed weapon word unarmed (#569)', () => {
    const attack = detectDeclaredAttack('I attack the professor with my fists', actors);
    expect(attack).toMatchObject({
      verb: 'attack',
      actorName: 'Professor Emil Darkwater',
      attackSource: 'unarmed',
      weaponStated: false,
    });
    expect(attack).not.toHaveProperty('weaponName');
  });
});

describe('detectDeclaredAttack across sentences (#2341)', () => {
  const roster = [{ name: 'Valerius' }, { name: 'Dr. Darkwater' }];

  it("finds run 14's Chill Touch in the second sentence", () => {
    expect(
      detectDeclaredAttack(
        'I do not trust him. I cast Chill Touch at Valerius on the ceiling.',
        roster,
      ),
    ).toMatchObject({
      actorName: 'Valerius',
      attackSource: 'spell',
      spellId: 'chill-touch',
      spellName: 'Chill Touch',
    });
  });

  it('finds an attack after an exclamation or a question', () => {
    expect(detectDeclaredAttack('Enough! I punch Valerius.', roster)).toMatchObject({
      verb: 'punch',
      actorName: 'Valerius',
    });
    expect(detectDeclaredAttack('Are you sure? I stab Valerius.', roster)).toMatchObject({
      verb: 'stab',
      actorName: 'Valerius',
    });
  });

  it('keeps a title and its name together', () => {
    expect(detectDeclaredAttack('I punch Dr. Darkwater.', roster)).toMatchObject({
      verb: 'punch',
      actorName: 'Dr. Darkwater',
    });
  });

  it('still refuses a sentence that only talks about attacking', () => {
    expect(
      detectDeclaredAttack('I do not trust him. I would never punch Valerius.', roster),
    ).toBeNull();
    expect(detectDeclaredAttack('I do not trust him. I ask Valerius why.', roster)).toBeNull();
  });
});

describe('detectDeclaredDefense (#262)', () => {
  it('detects bare and first-person dodge declarations', () => {
    expect(detectDeclaredDefense('Dodge')).toBe('dodge');
    expect(detectDeclaredDefense('I dodge')).toBe('dodge');
    expect(detectDeclaredDefense('i dodge.')).toBe('dodge');
    expect(detectDeclaredDefense('dodged')).toBe('dodge');
  });

  it('detects disengage, dash, yield and flee', () => {
    expect(detectDeclaredDefense('I disengage')).toBe('disengage');
    expect(detectDeclaredDefense('Dash')).toBe('dash');
    expect(detectDeclaredDefense('I dash forward')).toBe('dash');
    expect(detectDeclaredDefense('I dash ahead.')).toBe('dash');
    expect(detectDeclaredDefense('I dash and attack')).toBeNull();
    expect(detectDeclaredDefense('I yield')).toBe('yield');
    expect(detectDeclaredDefense('I surrender')).toBe('yield');
    expect(detectDeclaredDefense('surrender')).toBe('yield');
    expect(detectDeclaredDefense('I flee')).toBe('flee');
    expect(detectDeclaredDefense('run away')).toBe('flee');
  });

  it('rejects sentences that merely mention dodging', () => {
    expect(detectDeclaredDefense('I dodge behind the pillar and attack')).toBeNull();
    expect(detectDeclaredDefense('Should I dodge or attack?')).toBeNull();
    expect(detectDeclaredDefense('The goblin dodges my attack')).toBeNull();
    expect(detectDeclaredDefense('')).toBeNull();
  });
});

describe('detectDeclaredLayOnHands (#712)', () => {
  it('detects the QA phrasing as a self-targeted declaration', () => {
    expect(
      detectDeclaredLayOnHands(
        'I call on my Lay on Hands as a bonus action, laying my hand on myself... Then I take the Attack action with an Unarmed Strike against Pale Stalker 1',
      ),
    ).toEqual({ target: 'self', targetIsSelf: true, amount: null, cure: null });
  });

  it('detects a named target and a stated HP amount', () => {
    expect(detectDeclaredLayOnHands('I use Lay on Hands on Mira for 5 hit points')).toEqual({
      target: 'Mira',
      targetIsSelf: false,
      amount: 5,
      cure: null,
    });
  });

  it('detects cure phrasing', () => {
    expect(detectDeclaredLayOnHands('I use my Lay on Hands to cure the poison')).toEqual({
      target: 'self',
      targetIsSelf: true,
      amount: null,
      cure: 'poison',
    });
    expect(detectDeclaredLayOnHands('I lay on hands to cure his disease')).toMatchObject({
      cure: 'disease',
    });
  });

  it('does not mistake "call on my" for a target, and ignores non-declarations', () => {
    expect(detectDeclaredLayOnHands('I call on my Lay on Hands')).toMatchObject({
      target: 'self',
      targetIsSelf: true,
    });
    expect(detectDeclaredLayOnHands('I attack the goblin')).toBeNull();
    expect(detectDeclaredLayOnHands('')).toBeNull();
  });
});

describe('typed Hex (#754 FIX item 3)', () => {
  const scavengers = [{ name: 'Psychic Scavenger 1' }, { name: 'Psychic Scavenger 2' }];

  it('the #754 repro text declares a Hex cast on the named creature', () => {
    const declared = detectDeclaredAttack(
      'Using my pact magic, I cast Hex as a bonus action on Psychic Scavenger 1',
      scavengers,
    );
    expect(declared?.attackSource).toBe('spell');
    expect(declared?.spellId).toBe('hex');
    expect(declared?.actorName).toBe('Psychic Scavenger 1');
  });

  it('a plain "cast Hex on X" declares the same cast', () => {
    const declared = detectDeclaredAttack('I cast Hex on Psychic Scavenger 2', scavengers);
    expect(declared?.spellId).toBe('hex');
    expect(declared?.actorName).toBe('Psychic Scavenger 2');
  });
});

describe('detectDeclaredSecondWind (#975)', () => {
  it('detects the typed declaration and the bare tray label', () => {
    expect(detectDeclaredSecondWind('I use Second Wind')).toBe(true);
    expect(detectDeclaredSecondWind('I use Second Wind.')).toBe(true);
    expect(detectDeclaredSecondWind('Second Wind')).toBe(true);
    expect(detectDeclaredSecondWind('Use Second Wind')).toBe(true);
    expect(detectDeclaredSecondWind('I use my Second Wind, then hold the line')).toBe(true);
    expect(detectDeclaredSecondWind('We use Second Wind and press on')).toBe(true);
    expect(detectDeclaredSecondWind("I'll use Second Wind")).toBe(true);
    expect(detectDeclaredSecondWind('I want to use Second Wind')).toBe(true);
    expect(detectDeclaredSecondWind("I'm using Second Wind")).toBe(true);
    expect(detectDeclaredSecondWind('Let me use Second Wind')).toBe(true);
  });

  it('does not spend the feature on a question, whatever auxiliary it uses', () => {
    expect(detectDeclaredSecondWind('Do I use Second Wind?')).toBe(false);
    expect(detectDeclaredSecondWind('Did I use Second Wind already?')).toBe(false);
    expect(detectDeclaredSecondWind('Would I use Second Wind?')).toBe(false);
    // A question sentence does not poison a later declarative one.
    expect(detectDeclaredSecondWind('Did I use Second Wind? I use Second Wind now')).toBe(true);
  });

  it('does not spend the feature on the idiom, a negation, a question, or a deferral', () => {
    // The ordinary English idiom: the clause's declaration is the attack.
    expect(detectDeclaredSecondWind('I catch my second wind and swing again')).toBe(false);
    expect(detectDeclaredSecondWind('I caught my second wind')).toBe(false);
    expect(detectDeclaredSecondWind("I don't use Second Wind")).toBe(false);
    expect(detectDeclaredSecondWind('I do not use Second Wind yet')).toBe(false);
    expect(detectDeclaredSecondWind('Can I use Second Wind?')).toBe(false);
    expect(detectDeclaredSecondWind('Should I use Second Wind now?')).toBe(false);
    expect(detectDeclaredSecondWind('What if I use Second Wind?')).toBe(false);
    expect(detectDeclaredSecondWind('I save my Second Wind for later')).toBe(false);
    expect(detectDeclaredSecondWind('I never use Second Wind this early')).toBe(false);
  });

  it('ignores inputs that never name the feature', () => {
    expect(detectDeclaredSecondWind('I attack the goblin')).toBe(false);
    expect(detectDeclaredSecondWind('I take a deep breath and steady myself')).toBe(false);
    expect(detectDeclaredSecondWind('')).toBe(false);
    expect(detectDeclaredSecondWind('   ')).toBe(false);
  });
});
