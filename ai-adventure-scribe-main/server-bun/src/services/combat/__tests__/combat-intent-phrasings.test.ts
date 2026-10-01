import { describe, expect, it, mock } from 'bun:test';

mock.module('../../../lib/logger.js', () => ({
  logger: {
    info: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
    error: mock(() => {}),
  },
}));

const {
  actorsMentionedIn,
  detectDeclaredAttack,
  detectUntargetedAttackSpell,
  looksLikeCombatIntent,
} = await import('../combat-intent-gate.js');

describe('spell and missile phrasings, and the verb governing the actor (#2341)', () => {
  const roster = [{ name: 'Valerius' }, { name: 'Goblin' }, { name: 'Dr. Darkwater' }];

  it.each([
    'I hurl Acid Splash at Valerius',
    'I shoot the goblin',
    'I cast Fire Bolt at him',
    'I blast him with a spell',
    'I zap the goblin',
    'I loose an arrow at the goblin',
    'I launch a fireball at Valerius',
    'I fire my crossbow at the goblin',
    'I throw a dagger at the goblin',
  ])('prefilters %s', (phrase) => {
    expect(looksLikeCombatIntent(phrase)).toBe(true);
  });

  it.each(['I ask Valerius about the ceiling', 'I study the fold', 'I search the lift'])(
    'does not prefilter %s',
    (phrase) => {
      expect(looksLikeCombatIntent(phrase)).toBe(false);
    },
  );

  it('sees a cantrip hurled at a named creature', () => {
    expect(detectDeclaredAttack('I hurl Acid Splash at Valerius', roster)).toMatchObject({
      actorName: 'Valerius',
      attackSource: 'spell',
      spellId: 'acid-splash',
      spellName: 'Acid Splash',
    });
  });

  it('sees a shot at a creature', () => {
    expect(detectDeclaredAttack('I shoot the goblin', roster)).toMatchObject({
      verb: 'shoot',
      actorName: 'Goblin',
    });
  });

  it('treats a hurled object as a thrown weapon, not a spell', () => {
    expect(detectDeclaredAttack('I hurl a rock at the goblin', roster)).toMatchObject({
      verb: 'throw',
      actorName: 'Goblin',
      attackSource: 'weapon',
    });
  });

  it('does not count a companion or an idiom as the target: the verb has to govern the name', () => {
    expect(detectDeclaredAttack('I strike a bargain with Valerius', roster)).toBeNull();
    expect(detectDeclaredAttack('I strike a deal with Valerius.', roster)).toBeNull();
    expect(detectDeclaredAttack('I hit the road toward Valerius', roster)).toBeNull();
    expect(detectDeclaredAttack('I shoot the breeze with Valerius', roster)).toBeNull();
    // ...while the same verb on the same creature is an attack.
    expect(detectDeclaredAttack('I strike Valerius', roster)).toMatchObject({
      actorName: 'Valerius',
    });
  });

  it('finds a known attack spell aimed at "him", at "it", or at nothing', () => {
    expect(detectDeclaredAttack('I cast Fire Bolt at him', roster)).toBeNull();
    expect(detectUntargetedAttackSpell('I cast Fire Bolt at him')).toEqual({
      id: 'fire-bolt',
      name: 'Fire Bolt',
      pronoun: 'him',
    });
    expect(detectUntargetedAttackSpell('I hurl Acid Splash at it.')).toMatchObject({
      id: 'acid-splash',
    });
    expect(detectUntargetedAttackSpell('I cast Fire Bolt')).toMatchObject({ id: 'fire-bolt' });
  });

  it('does not treat other spells or other targets as an untargeted attack', () => {
    expect(detectUntargetedAttackSpell('I cast Light')).toBeNull();
    expect(detectUntargetedAttackSpell('I cast Fire Bolt at the lantern')).toBeNull();
    expect(detectUntargetedAttackSpell('I do not cast Fire Bolt at him')).toBeNull();
    expect(detectUntargetedAttackSpell('I ask him about Fire Bolt')).toBeNull();
  });

  it('names the roster creatures a narration mentions, by name or one distinctive word', () => {
    const named = actorsMentionedIn(
      'Valerius the Upside Down hangs from the ceiling. Darkwater stammers.',
      [
        { name: 'Valerius the Upside Down' },
        { name: 'Professor Emil Darkwater' },
        { name: 'The Ghoul' },
      ],
    );
    expect(named.map((actor) => actor.name).join(' | ')).toBe(
      'Valerius the Upside Down | Professor Emil Darkwater',
    );
  });
});

describe("the sheet Cast button's tag (#2415)", () => {
  // `buildSpellCastMessage` writes this line; the shared fixture and a client test pin it.
  const sheetCast = 'I cast Chill Touch [spell_id=chill-touch, spell_level=cantrip].';

  it('reads a tagged cast with no creature as an untargeted attack spell with no pronoun', () => {
    const spell = detectUntargetedAttackSpell(sheetCast);
    expect(spell).toEqual({ id: 'chill-touch', name: 'Chill Touch' });
    expect(spell).not.toHaveProperty('pronoun');
    expect(detectUntargetedAttackSpell('I cast Chill Touch at him.')).toMatchObject({
      pronoun: 'him',
    });
  });

  it('declares no attack from the tagged line alone, and still resolves a typed target', () => {
    const roster = [{ name: 'Captain Sarah Reeves' }];
    expect(detectDeclaredAttack(sheetCast, roster)).toBeNull();
    expect(detectDeclaredAttack('I cast Chill Touch at Reeves', roster)).toMatchObject({
      actorName: 'Captain Sarah Reeves',
      spellId: 'chill-touch',
    });
  });

  it('does not read a tagged non-attack spell as an attack', () => {
    expect(
      detectUntargetedAttackSpell('I cast Light [spell_id=light, spell_level=cantrip].'),
    ).toBeNull();
  });
});

describe('a quoted nickname is not a name on its own (#2445)', () => {
  const roster = [{ name: '"Iron" Jawn' }, { name: 'Captain Sarah Reeves' }];
  const named = (narration: string): string[] =>
    actorsMentionedIn(narration, roster).map((actor) => actor.name);

  it('does not read "iron" in the prose as "Iron" Jawn', () => {
    expect(named('Reeves grips the iron rail and peers into the chasm.')).toEqual([
      'Captain Sarah Reeves',
    ]);
  });

  it('still names him by surname or by the whole name', () => {
    expect(named('Jawn nods.')).toEqual(['"Iron" Jawn']);
    expect(named('"Iron" Jawn nods.')).toEqual(['"Iron" Jawn']);
    expect(named('Iron Jawn nods.')).toEqual(['"Iron" Jawn']);
  });
});

describe('one common word does not name an actor (#2458)', () => {
  const roster = [
    { name: 'Mother Basalt' },
    { name: 'Captain Sarah Reeves' },
    { name: 'Professor Emil Darkwater' },
  ];
  const named = (narration: string, actors: typeof roster = roster): string[] =>
    actorsMentionedIn(narration, actors).map((actor) => actor.name);

  it('names no one from "basalt" or "mother" in ordinary prose', () => {
    expect(named('The basalt walls glisten.')).toEqual([]);
    expect(named('A button of mother of pearl rolls away.')).toEqual([]);
  });

  it('names her by her full name', () => {
    expect(named('Mother Basalt steps forward.')).toEqual(['Mother Basalt']);
  });

  it('still names a given-name-and-surname actor by title + surname, surname or given name', () => {
    expect(named('Captain Reeves nods.')).toEqual(['Captain Sarah Reeves']);
    expect(named('Reeves nods.')).toEqual(['Captain Sarah Reeves']);
    expect(named('Emil stammers.')).toEqual(['Professor Emil Darkwater']);
  });

  it('does not let the title alone name a titled actor', () => {
    expect(named('The captain of the guard waits.')).toEqual([]);
  });

  it('names a campaign NPC only in full', () => {
    const campaign = roster.map((actor) => ({ ...actor, source: 'campaign' as const }));
    expect(named('Reeves nods. Captain Reeves nods.', campaign)).toEqual([]);
    expect(named('Captain Sarah Reeves nods.', campaign)).toEqual(['Captain Sarah Reeves']);
  });
});
