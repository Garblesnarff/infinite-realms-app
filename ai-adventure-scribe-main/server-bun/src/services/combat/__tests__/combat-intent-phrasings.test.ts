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
