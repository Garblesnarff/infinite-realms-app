import { describe, expect, test } from 'bun:test';

import {
  evaluateSceneEnd,
  findKillClaims,
  partyHasLeftTheFight,
  stripKillSentences,
} from '../combat-end-guard.js';

import type { SceneEndParticipant } from '../combat-end-guard.js';

/**
 * #2524, run D1: two fights ended `dm_ended_scene` with the monster conscious at
 * 3/13 and 5/11 HP while the DM narrated a killing blow. Participants here are built
 * in the shape `CombatEncounterService.getCombatState` returns (the real producer):
 * id, name, participantType, isActive and a status row with currentHp/isConscious.
 */
const participant = (
  overrides: Partial<SceneEndParticipant> & { id: string },
): SceneEndParticipant => ({
  name: 'Vitruvian Spider',
  participantType: 'monster',
  isActive: true,
  maxHp: 11,
  status: { currentHp: 5, isConscious: true },
  ...overrides,
});

const spiderAtFiveOfEleven = participant({ id: 'spider-1' });
const hero = participant({
  id: 'hero-1',
  name: 'The Veteran',
  participantType: 'player',
  maxHp: 12,
  status: { currentHp: 9, isConscious: true },
});

describe('the live-hostile guard', () => {
  test('an end with a conscious hostile at 5/11 and no exit is refused', () => {
    const decision = evaluateSceneEnd([hero, spiderAtFiveOfEleven], []);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.unaccounted.map((entry) => entry.id)).toEqual(['spider-1']);
    }
  });

  test('a declared fled exit accounts for the standing hostile', () => {
    const decision = evaluateSceneEnd(
      [hero, spiderAtFiveOfEleven],
      [{ participant_id: 'spider-1', exit: 'fled' }],
    );
    expect(decision.allowed).toBe(true);
  });

  test('an ally standing does not block the end once every hostile is down', () => {
    const ally = participant({
      id: 'ally-1',
      name: 'Companion',
      participantType: 'npc',
      disposition: 'ally',
      status: { currentHp: 8, isConscious: true },
    });
    const deadSpider = participant({
      id: 'spider-1',
      status: { currentHp: 0, isConscious: false },
    });
    expect(evaluateSceneEnd([hero, ally, deadSpider], []).allowed).toBe(true);
  });

  test('a fled exit for goblin-2 accounts for that duplicate, not its twin', () => {
    const goblin1 = participant({ id: 'uuid-goblin-1', name: 'Goblin' });
    const goblin2 = participant({ id: 'uuid-goblin-2', name: 'Goblin' });
    const slugOf = (p: SceneEndParticipant) => (p.id.endsWith('-1') ? 'goblin-1' : 'goblin-2');
    const refused = evaluateSceneEnd(
      [hero, goblin1, goblin2],
      [{ participant_id: 'goblin-2', exit: 'fled' }],
      slugOf,
    );
    expect(refused.allowed).toBe(false);
    const allowed = evaluateSceneEnd(
      [hero, goblin1, goblin2],
      [
        { participant_id: 'goblin-1', exit: 'fled' },
        { participant_id: 'goblin-2', exit: 'fled' },
      ],
      slugOf,
    );
    expect(allowed.allowed).toBe(true);
  });

  // #2580: the guard exists to stop the DM narrating a kill of a creature the engine counts as
  // alive. It had no answer for the player who wants out of the fight entirely, so the only end
  // it accepted was one that killed everything standing.
  describe('a party that has left the fight (#2580)', () => {
    const exitedHero = participant({
      id: 'hero-1',
      name: 'The Scholar',
      participantType: 'player',
      isActive: false,
      maxHp: 7,
      status: { currentHp: 5, isConscious: true },
    });

    // `evaluateSceneEnd` still refuses here, and that is deliberate: it is handed a filtered
    // roster by the generation-time caller, where the player's own line is the one removed, so
    // it must never infer "nobody is left" from what it was given. The rule lives in
    // `partyHasLeftTheFight` and both call sites apply it to the roster they actually hold —
    // pinned end to end in player-exit-intent.real-db.test.ts.
    test('the judge alone still refuses, and the rule is the caller’s to apply', () => {
      expect(evaluateSceneEnd([exitedHero, spiderAtFiveOfEleven], []).allowed).toBe(false);
      expect(partyHasLeftTheFight([exitedHero, spiderAtFiveOfEleven])).toBe(true);
    });

    test('an ally still in the fight keeps holding the end', () => {
      const ally = participant({
        id: 'ally-1',
        name: 'Mira Thane',
        participantType: 'npc',
        disposition: 'ally',
      });
      expect(evaluateSceneEnd([exitedHero, ally, spiderAtFiveOfEleven], []).allowed).toBe(false);
      expect(partyHasLeftTheFight([exitedHero, ally, spiderAtFiveOfEleven])).toBe(false);
    });

    test('a player still in the turn order is not an exit, whoever the slug says', () => {
      expect(partyHasLeftTheFight([hero, spiderAtFiveOfEleven])).toBe(false);
      expect(
        evaluateSceneEnd([hero, spiderAtFiveOfEleven], [{ participant_id: 'hero-1', exit: 'fled' }])
          .allowed,
      ).toBe(false);
    });

    test('a downed player is still in the fight — 0 HP is dying, not left', () => {
      const down = participant({
        id: 'hero-1',
        name: 'The Scholar',
        participantType: 'player',
        status: { currentHp: 0, isConscious: false },
      });
      expect(partyHasLeftTheFight([down, spiderAtFiveOfEleven])).toBe(false);
      expect(evaluateSceneEnd([down, spiderAtFiveOfEleven], []).allowed).toBe(false);
    });

    test('a roster with no player line reads as the party having left', () => {
      // This is deliberate, and it is the shape of the prompt after an exit: the turn-order block
      // lists only active participants, so once the player leaves their line is simply absent
      // and the generation-time guard has nothing else to read the exit from. Absence IS the
      // signal here; the real-DB suite pins that the real block produces exactly this roster.
      expect(partyHasLeftTheFight([spiderAtFiveOfEleven])).toBe(true);
    });
  });

  test('an exit for one hostile does not account for another', () => {
    const second = participant({ id: 'spider-2', name: 'Wall-Mouth' });
    const decision = evaluateSceneEnd(
      [hero, spiderAtFiveOfEleven, second],
      [{ participant_id: 'spider-1', exit: 'surrendered' }],
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.unaccounted.map((entry) => entry.id)).toEqual(['spider-2']);
    }
  });

  test('an exit naming the player or a downed creature is dropped, not honored', () => {
    const decision = evaluateSceneEnd(
      [hero, spiderAtFiveOfEleven],
      [
        { participant_id: 'hero-1', exit: 'fled' },
        { participant_id: 'spider-1', exit: 'fled' },
      ],
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.exits.map((entry) => entry.participant_id)).toEqual(['spider-1']);
    }
  });

  test('a declaration may address the hostile by the slug the DM was shown', () => {
    const decision = evaluateSceneEnd(
      [hero, spiderAtFiveOfEleven],
      [{ participant_id: 'vitruvian-spider', exit: 'withdrew' }],
      (participant) => participant.id.replace('-1', '').replace('spider', 'vitruvian-spider'),
    );
    expect(decision.allowed).toBe(true);
  });

  test('a hostile at 0 HP or inactive does not block the end', () => {
    const down = participant({ id: 'spider-1', status: { currentHp: 0, isConscious: false } });
    expect(evaluateSceneEnd([hero, down], []).allowed).toBe(true);
    const gone = participant({ id: 'spider-1', isActive: false });
    expect(evaluateSceneEnd([hero, gone], []).allowed).toBe(true);
  });
});

describe('kill language about a living participant', () => {
  test('"collapses, lifeless" about the spider at 5/11 is a kill claim', () => {
    const claims = findKillClaims(
      'The Vitruvian Spider collapses, lifeless, upon the pulsing floor of the gallery.',
      [hero, spiderAtFiveOfEleven],
    );
    expect(claims).toHaveLength(1);
    expect(claims[0].participantId).toBe('spider-1');
  });

  test('the same sentence is clean once the engine has the spider at 0 HP', () => {
    const dead = participant({ id: 'spider-1', status: { currentHp: 0, isConscious: false } });
    expect(
      findKillClaims('The Vitruvian Spider collapses, lifeless, upon the floor.', [hero, dead]),
    ).toEqual([]);
  });

  test('prose that says the participant fled is not a kill claim', () => {
    expect(
      findKillClaims('The Vitruvian Spider flees into the dark.', [hero, spiderAtFiveOfEleven]),
    ).toEqual([]);
  });

  test('the Wall-Mouth D1 sentence verbatim is a kill claim at 3/13', () => {
    const wallMouth = participant({
      id: 'wall-mouth',
      name: 'Wall-Mouth',
      maxHp: 13,
      status: { currentHp: 3, isConscious: true },
    });
    const claims = findKillClaims(
      'You bring your longsword down in a brutal, decisive arc, cleaving through the remaining stony flesh of the Wall-Mouth.',
      [hero, wallMouth],
    );
    expect(claims).toHaveLength(1);
    expect(claims[0].participantId).toBe('wall-mouth');
  });

  test('no claim for a felled monster named beside the living player', () => {
    const dead = participant({ id: 'spider-1', status: { currentHp: 0, isConscious: false } });
    expect(
      findKillClaims("The finishing blow drops the Vitruvian Spider at The Veteran's feet.", [
        hero,
        dead,
      ]),
    ).toEqual([]);
  });

  test('stripping removes only the kill sentence', () => {
    const text =
      'You hold your ground. The Vitruvian Spider collapses, lifeless, upon the floor. The gallery hums.';
    const claims = findKillClaims(text, [hero, spiderAtFiveOfEleven]);
    expect(stripKillSentences(text, claims)).toBe('You hold your ground. The gallery hums.');
  });
});

describe('the D5 narration: a numbered swarm, an ordinal and a pronoun (#2563)', () => {
  // The verbatim DM kill from run D5 (#2561 §4): the quarterstaff swing at
  // Light-Eater Swarm 1 (alive at 4/4) narrated as a kill. Neither sentence names a
  // participant the way the roster writes it — "the first Light-Eater", then "The
  // creature" — so the claim only exists if the guard follows the narration.
  const D5_KILL =
    'Your quarterstaff strikes true, catching the fluttering, shadow-cloaked mass of ' +
    'the first Light-Eater as it attempts to reform after its last strike. The creature ' +
    'lets out a final, high-pitched harmonic shriek—a sound like a dying bell—that ' +
    'echoes off the obsidian walls before it dissipates into a cloud of dark, oily ash.';

  const scholar = participant({
    id: 'the-scholar',
    name: 'The Scholar',
    participantType: 'player',
    maxHp: 7,
    status: { currentHp: 5, isConscious: true },
  });
  const swarm1 = participant({
    id: 'light-eater-swarm-1',
    name: 'Light-Eater Swarm 1',
    maxHp: 4,
    status: { currentHp: 4, isConscious: true },
  });
  const swarm2Down = participant({
    id: 'light-eater-swarm-2',
    name: 'Light-Eater Swarm 2',
    maxHp: 4,
    status: { currentHp: 0, isConscious: false },
  });

  test('the verbatim D5 kill is a claim against Swarm 1 at 4/4', () => {
    const claims = findKillClaims(D5_KILL, [scholar, swarm1, swarm2Down]);
    expect(claims).toHaveLength(1);
    expect(claims[0].participantId).toBe('light-eater-swarm-1');
    expect(claims[0].sentence).toContain('dissipates');
  });

  test('stripping the D5 kill leaves the swing and removes the dissipation', () => {
    const claims = findKillClaims(D5_KILL, [scholar, swarm1, swarm2Down]);
    const stripped = stripKillSentences(D5_KILL, claims);
    expect(stripped).not.toContain('dissipates');
    expect(stripped).toContain('strikes true');
  });

  test('the same words are clean once the engine has Swarm 1 at 0 HP', () => {
    const swarm1Down = participant({
      id: 'light-eater-swarm-1',
      name: 'Light-Eater Swarm 1',
      maxHp: 4,
      status: { currentHp: 0, isConscious: false },
    });
    expect(findKillClaims(D5_KILL, [scholar, swarm1Down, swarm2Down])).toEqual([]);
  });

  test('an ordinal picks its own twin: "the second Light-Eater" names Swarm 2', () => {
    const swarm1Down = participant({
      id: 'light-eater-swarm-1',
      name: 'Light-Eater Swarm 1',
      maxHp: 4,
      status: { currentHp: 0, isConscious: false },
    });
    const swarm2 = participant({
      id: 'light-eater-swarm-2',
      name: 'Light-Eater Swarm 2',
      maxHp: 4,
      status: { currentHp: 4, isConscious: true },
    });
    const claims = findKillClaims('You turn on the second Light-Eater. It dissipates into ash.', [
      scholar,
      swarm1Down,
      swarm2,
    ]);
    expect(claims.map((claim) => claim.participantId)).toEqual(['light-eater-swarm-2']);
  });
});
