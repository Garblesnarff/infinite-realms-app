/**
 * Recorded-envelope tests for the #2236 narration post-check.
 *
 * Envelopes are reconstructed from the playtest issues:
 * - #2230 run 10: one NPC attack roll (13 + 3 = 16 vs AC 18 — MISS) narrated as
 *   "a flurry of strikes" / "blows"; a natural-2 player miss narrated as
 *   "Your longsword swings true"; the rope-over-chasm scene drifting to
 *   "stone floor" / "chamber" / "halls".
 * - #2231 run M4: the player declared Chill Touch (a spell); the narration invented
 *   "You dash across the room to put distance between yourself and the creature"
 *   when no Dash was declared or resolved, and wrote "It is not your turn yet"
 *   while the tracker showed the player's turn (initiative 19 vs 7).
 */
import { describe, expect, it, vi } from 'vitest';

import {
  buildDeterministicFallback,
  checkNarrationAgainstContract,
  enforceNarrationContract,
  narrationTextFromRawResponse,
  parseContractEnvelope,
  replaceNarrationText,
  type ContractEnvelope,
} from '../narration-contract-check';

/** The #2230 run-10 envelope: a single NPC attack that missed. */
const RUN_10_NPC_MISS: ContractEnvelope = {
  currentTurn: { slug: 'vitruvian-spider', isPlayer: false, round: 4 },
  actions: [{ kind: 'attack', count: 1, hit: false, mixed: false }],
  sceneDescription: 'Hanging from a rope over a chasm, the Throat of Basalt below.',
};

/** The #2230 run-10 envelope: the player's three attacks (hit, miss, hit). */
const RUN_10_PLAYER_ATTACKS: ContractEnvelope = {
  currentTurn: { slug: 'the-veteran', isPlayer: true, round: 4 },
  actions: [{ kind: 'attack', count: 3, hit: undefined, mixed: true }],
  sceneDescription: 'Hanging from a rope over a chasm, the Throat of Basalt below.',
};

/** The #2231 run-M4 envelope: the player declared Chill Touch; nothing resolved yet. */
const RUN_M4_SPELL_DECLARED: ContractEnvelope = {
  currentTurn: { slug: 'rook', isPlayer: true, round: 4 },
  actions: [],
  sceneDescription: 'A ruined laboratory, the elemental crackling near the far bench.',
};

const SCRATCH_HIT: ContractEnvelope = {
  currentTurn: { slug: 'vitruvian-spider', isPlayer: false, round: 4 },
  actions: [{ kind: 'attack', count: 1, hit: true, mixed: false, damageScale: 'scratch' }],
  sceneDescription: null,
};

describe('parseContractEnvelope', () => {
  it('returns null when there is no contract (non-combat turns skip the check)', () => {
    expect(parseContractEnvelope(null)).toBeNull();
    expect(parseContractEnvelope('no contract here')).toBeNull();
  });

  it('parses the envelope the server emits', () => {
    const tacticalContext = [
      '<tactical_context>',
      '<narration_contract>',
      '<contract_json>{"currentTurn":{"slug":"rook","isPlayer":true,"round":4},"actions":[],"sceneDescription":"A lab."}</contract_json>',
      '</narration_contract>',
      '</tactical_context>',
    ].join('\n');
    expect(parseContractEnvelope(tacticalContext)).toEqual({
      currentTurn: { slug: 'rook', isPlayer: true, round: 4 },
      actions: [],
      sceneDescription: 'A lab.',
    });
  });

  it('returns null for a malformed envelope rather than throwing', () => {
    expect(parseContractEnvelope('<contract_json>not json</contract_json>')).toBeNull();
  });

  it('keeps a known damageScale and drops an unknown value (#2534)', () => {
    const tacticalContext = [
      '<contract_json>{"currentTurn":{"slug":"rook","isPlayer":true,"round":4},"actions":[',
      '{"kind":"attack","count":1,"actors":["rook"],"hit":true,"mixed":false,"damageScale":"scratch"},',
      '{"kind":"attack","count":1,"actors":["rook"],"hit":true,"mixed":false,"damageScale":"mangled"}',
      '],"sceneDescription":null}</contract_json>',
    ].join('');
    const parsed = parseContractEnvelope(tacticalContext);
    expect(parsed?.actions[0].damageScale).toBe('scratch');
    expect(parsed?.actions[1].damageScale).toBeUndefined();
  });
});

describe('unresolved_action (run M4 invented Dash)', () => {
  it('flags "You dash across the room" when no dash resolved', () => {
    const violations = checkNarrationAgainstContract(
      'You dash across the room to put distance between yourself and the creature.',
      RUN_M4_SPELL_DECLARED,
    );
    expect(violations.some((v) => v.rule === 'unresolved_action')).toBe(true);
  });

  it('does not flag a dash the engine resolved', () => {
    const contract: ContractEnvelope = {
      ...RUN_M4_SPELL_DECLARED,
      actions: [{ kind: 'dash', count: 1, hit: undefined, mixed: false }],
    };
    expect(checkNarrationAgainstContract('You dash across the room.', contract)).toEqual([]);
  });

  it('does not flag ordinary movement prose ("steps", "lunges")', () => {
    expect(
      checkNarrationAgainstContract(
        'You step back, lunging forward with your blade.',
        RUN_M4_SPELL_DECLARED,
      ),
    ).toEqual([]);
  });
});

describe('false_turn_denial (run M4 "not your turn")', () => {
  it('flags "It is not your turn yet" on the player turn', () => {
    const violations = checkNarrationAgainstContract(
      'It is not your turn yet. The elemental crackles.',
      RUN_M4_SPELL_DECLARED,
    );
    expect(violations.some((v) => v.rule === 'false_turn_denial')).toBe(true);
  });

  it('does not flag turn language on an NPC turn', () => {
    const violations = checkNarrationAgainstContract('It is not your turn yet.', RUN_10_NPC_MISS);
    expect(violations.some((v) => v.rule === 'false_turn_denial')).toBe(false);
  });
});

describe('success_on_miss + inflated_action_count (run 10)', () => {
  it('flags "a flurry of strikes" for a single missed attack', () => {
    const violations = checkNarrationAgainstContract(
      'The spider lunges in a flurry of strikes, its blows raining down on you.',
      RUN_10_NPC_MISS,
    );
    expect(violations.some((v) => v.rule === 'success_on_miss')).toBe(true);
    expect(violations.some((v) => v.rule === 'inflated_action_count')).toBe(true);
  });

  it('flags "Your longsword swings true" for a natural-2 miss', () => {
    const contract: ContractEnvelope = {
      ...RUN_10_PLAYER_ATTACKS,
      actions: [{ kind: 'attack', count: 1, hit: false, mixed: false }],
    };
    const violations = checkNarrationAgainstContract(
      'Your longsword swings true, biting deep into the chitin.',
      contract,
    );
    expect(violations.some((v) => v.rule === 'success_on_miss')).toBe(true);
  });

  it('does not flag success language for mixed outcomes (attribution is ambiguous)', () => {
    const violations = checkNarrationAgainstContract(
      'Your first swing lands true; the second goes wide.',
      RUN_10_PLAYER_ATTACKS,
    );
    expect(violations.some((v) => v.rule === 'success_on_miss')).toBe(false);
  });

  it('does not flag an honest miss narration', () => {
    expect(
      checkNarrationAgainstContract(
        'The spider snaps at you but its fangs glance off your shield.',
        RUN_10_NPC_MISS,
      ),
    ).toEqual([]);
  });
});

describe('damage_scale (#2534)', () => {
  it('rejects devastating prose for a one-damage scratch-tier hit', () => {
    const violations = checkNarrationAgainstContract(
      'The blow lands, devastating your armor and leaving you grievously wounded.',
      SCRATCH_HIT,
    );
    expect(violations).toEqual([
      expect.objectContaining({ rule: 'damage_scale', matched: 'devastating' }),
    ]);
  });

  it('allows a restrained scratch-tier description', () => {
    expect(
      checkNarrationAgainstContract(
        'The hit glances off your armor, leaving only a scrape.',
        SCRATCH_HIT,
      ),
    ).toEqual([]);
  });

  it('does not flag scenery scale words ("massive door") beside a scratch hit', () => {
    const violations = checkNarrationAgainstContract(
      'The hit grazes your arm, barely a scratch. Beyond the fray looms a massive door.',
      SCRATCH_HIT,
    );
    expect(violations.some((v) => v.rule === 'damage_scale')).toBe(false);
  });

  it('still flags a scale word describing the hit in the same sentence', () => {
    const violations = checkNarrationAgainstContract(
      'The hit lands, a massive blow that rattles your bones.',
      SCRATCH_HIT,
    );
    expect(violations).toEqual([
      expect.objectContaining({ rule: 'damage_scale', matched: 'massive' }),
    ]);
  });

  it('flags "a devastating blow" from a parsed contract_json envelope (#2534)', () => {
    const tacticalContext = [
      '<contract_json>{"currentTurn":{"slug":"rook","isPlayer":true,"round":4},"actions":[',
      '{"kind":"attack","count":1,"actors":["rook"],"hit":true,"mixed":false,"damageScale":"scratch"}',
      '],"sceneDescription":null}</contract_json>',
    ].join('');
    const contract = parseContractEnvelope(tacticalContext);
    expect(contract).not.toBeNull();
    const violations = checkNarrationAgainstContract(
      'The strike lands, a devastating blow that cracks the stone.',
      contract!,
    );
    expect(violations).toEqual([
      expect.objectContaining({ rule: 'damage_scale', matched: 'devastating' }),
    ]);
  });
});

describe('scene_drift (run 10 rope over chasm)', () => {
  it('flags "stone floor" when the scene is a rope over a chasm', () => {
    const violations = checkNarrationAgainstContract(
      'You drop to the stone floor of the small chamber, its halls echoing.',
      RUN_10_NPC_MISS,
    );
    expect(violations.some((v) => v.rule === 'scene_drift')).toBe(true);
  });

  it('does not flag setting words the scene description already names', () => {
    const contract: ContractEnvelope = {
      ...RUN_10_NPC_MISS,
      sceneDescription: 'A stone chamber with a stone floor deep below the earth.',
    };
    expect(
      checkNarrationAgainstContract('You stand on the stone floor of the chamber.', contract),
    ).toEqual([]);
  });
});

describe('fallback and text helpers', () => {
  it('builds deterministic fallback prose from engine facts only', () => {
    expect(buildDeterministicFallback(RUN_10_NPC_MISS)).toBe(
      "The Vitruvian Spider's attack misses. It is still the Vitruvian Spider's turn.",
    );
  });

  it('renders the run-M4 contract (player turn, nothing resolved) as plain sentences', () => {
    expect(buildDeterministicFallback(RUN_M4_SPELL_DECLARED)).toBe(
      'No actions have been resolved this turn. It is your turn.',
    );
  });

  it('never leaks slugs, counts-as-data, or engine wording', () => {
    for (const contract of [RUN_10_NPC_MISS, RUN_M4_SPELL_DECLARED, RUN_10_PLAYER_ATTACKS]) {
      const fallback = buildDeterministicFallback(contract);
      expect(fallback).not.toContain('vitruvian-spider');
      expect(fallback).not.toContain('x1');
      expect(fallback).not.toContain('(MISS)');
      expect(fallback).not.toContain('(round');
      expect(fallback.toLowerCase()).not.toContain('the engine');
      expect(fallback).not.toContain('Scene:');
    }
  });

  it('addresses the player in the second person', () => {
    expect(
      buildDeterministicFallback({
        currentTurn: { slug: 'the-veteran', isPlayer: true, round: 4 },
        actions: [{ kind: 'attack', count: 1, hit: true, mixed: false }],
        sceneDescription: null,
      }),
    ).toBe('Your attack hits. It is your turn.');
  });

  it('names the actual actor from the envelope, not the turn holder', () => {
    expect(
      buildDeterministicFallback({
        currentTurn: { slug: 'vitruvian-spider', isPlayer: false, round: 4 },
        actions: [{ kind: 'attack', count: 1, actors: ['the-veteran'], hit: false, mixed: false }],
        sceneDescription: null,
      }),
    ).toBe("The Veteran's attack misses. It is still the Vitruvian Spider's turn.");
  });

  it('prefers the envelope label over the title-cased slug for the turn holder', () => {
    // Action actors carry slugs only, so the action sentence title-cases the slug;
    // the turn sentence prefers the authoritative label.
    expect(
      buildDeterministicFallback({
        currentTurn: { slug: 'spider-1', label: 'Vitruvian Spider', isPlayer: false, round: 2 },
        actions: [{ kind: 'dash', count: 1, actors: ['spider-1'], hit: undefined, mixed: false }],
        sceneDescription: null,
      }),
    ).toBe("The Spider 1 dashes. It is still the Vitruvian Spider's turn.");
  });

  it('extracts narration text from a DM JSON response', () => {
    expect(
      narrationTextFromRawResponse(JSON.stringify({ text: 'Hello.', combat_actions: [] })),
    ).toBe('Hello.');
  });

  it('replaces the text field while keeping combat_actions intact', () => {
    const raw = JSON.stringify({ text: 'Bad.', combat_actions: [{ action_type: 'attack' }] });
    const replaced = JSON.parse(replaceNarrationText(raw, 'Good.'));
    expect(replaced.text).toBe('Good.');
    expect(replaced.combat_actions).toEqual([{ action_type: 'attack' }]);
  });

  it('returns a non-JSON response unchanged rather than dropping its structure', () => {
    const raw = 'The spider hisses. {"combat_actions": [';
    expect(replaceNarrationText(raw, 'Good.')).toBe(raw);
  });
});

/** Rules for a turn with nothing resolved: every unresolved-action pattern is live. */
const NOTHING_RESOLVED_PLAYER_TURN: ContractEnvelope = {
  currentTurn: { slug: 'rook', isPlayer: true, round: 2 },
  actions: [],
  sceneDescription: 'Hanging from a rope over a chasm, the Throat of Basalt below.',
};

describe('tightened patterns: flavor is not a claim', () => {
  const clean = (narration: string, contract = NOTHING_RESOLVED_PLAYER_TURN) =>
    expect(checkNarrationAgainstContract(narration, contract)).toEqual([]);

  it('does not read "a dash of salt" or "a mad dash" as a Dash action', () => {
    clean('The cook adds a dash of salt to the broth.');
    clean('The apprentices make a mad dash for the door as the bell rings.');
  });

  it('does not read "you strike a match" or "you swing your torch" as an attack', () => {
    clean('You strike a match and the lantern sputters to life.');
    clean('You swing your torch in a wide arc, lighting the rock face.');
  });

  it('does not read "you cast a glance" as a spell', () => {
    clean('You cast a wary glance at the frayed rope above you.');
  });

  it('does not flag turn denial inside quoted NPC speech', () => {
    clean('"You cannot act rashly," Sister Varna warns. "Wait your turn at the stove."');
  });

  it('still flags turn denial in narrator voice', () => {
    const violations = checkNarrationAgainstContract(
      'You cannot act yet; the spider moves first.',
      NOTHING_RESOLVED_PLAYER_TURN,
    );
    expect(violations.map((v) => v.rule)).toEqual(['false_turn_denial']);
    expect(violations[0].matched).toBe('You cannot act yet');
  });

  it('matches relocation words on word boundaries only', () => {
    clean("A gull cries over Hallowreach as the Tavernkeeper's voice fades on the wind.");
  });

  it('never flags scene drift in an indoor scene (the Academy is halls and chambers)', () => {
    clean('You hurry through the Academy halls toward the tasting chamber.', {
      ...NOTHING_RESOLVED_PLAYER_TURN,
      sceneDescription: 'The Academy of Arcane Gastronomy, main kitchen.',
    });
  });

  it('does not flag drift when the scene description names no specific setting', () => {
    clean('The chamber falls silent.', {
      ...NOTHING_RESOLVED_PLAYER_TURN,
      sceneDescription: 'The fight continues.',
    });
  });

  it('does not let a stray inch mark shift quote pairing (round 3)', () => {
    clean('The sign reads 6" tall. "You cannot act yet," the priest warns.');
    clean('The rope is 12" thick. "You cannot act yet," the priest warns.');
  });

  it('does not pair quotes across paragraph breaks (round 3)', () => {
    clean('The sign reads 6" tall.\n\n"You cannot act yet," the priest warns.');
  });

  it('still strips balanced quotes after an unbalanced stray', () => {
    clean('She shouts "Hold on! "You cannot act yet," the priest warns.');
  });

  it('still strips a multi-sentence quote within one paragraph', () => {
    clean('"It is not your turn yet. Wait for my signal," the priest says.');
  });

  it('does not read "a flurry of snow" as multiple attacks', () => {
    clean('A flurry of snow whips across the gorge as the spider misses.', RUN_10_NPC_MISS);
  });

  it('reports the matched text on every violation', () => {
    const violations = checkNarrationAgainstContract(
      'You dash across the room.',
      RUN_M4_SPELL_DECLARED,
    );
    expect(violations).toEqual([
      expect.objectContaining({ rule: 'unresolved_action', matched: 'You dash' }),
    ]);
  });
});

describe('enforceNarrationContract fallback policy', () => {
  const contextFor = (contract: ContractEnvelope) =>
    `<narration_contract><contract_json>${JSON.stringify(contract)}</contract_json></narration_contract>`;
  const raw = (text: string) =>
    JSON.stringify({ text, combat_actions: [{ action_type: 'attack' }] });
  const textOf = (response: string) => JSON.parse(response).text as string;

  it('makes no model call when the narration is clean', async () => {
    const generateText = vi.fn();
    const response = raw('The spider snaps and misses.');
    const result = await enforceNarrationContract(response, {
      tacticalContext: contextFor(RUN_10_NPC_MISS),
      generateText,
    });
    expect(result).toBe(response);
    expect(generateText).not.toHaveBeenCalled();
  });

  it('falls back to engine prose when a factual violation survives the regen', async () => {
    const result = await enforceNarrationContract(raw('You dash across the room.'), {
      tacticalContext: contextFor(RUN_M4_SPELL_DECLARED),
      generateText: async () => 'You dash away again.',
    });
    expect(textOf(result)).toBe(buildDeterministicFallback(RUN_M4_SPELL_DECLARED));
    expect(JSON.parse(result).combat_actions).toEqual([{ action_type: 'attack' }]);
  });

  it.each([
    ['scene_drift', 'You land on the stone floor.', 'You slam onto the stone floor again.'],
    ['success_on_miss', 'Your blow lands.', 'Your blow lands hard.'],
    ['inflated_action_count', 'A flurry of blows.', 'A barrage of strikes.'],
  ])(
    'keeps the regenerated prose for %s even if it still trips',
    async (_rule, original, regen) => {
      const onViolation = vi.fn();
      const result = await enforceNarrationContract(raw(original), {
        tacticalContext: contextFor(RUN_10_NPC_MISS),
        generateText: async () => regen,
        onViolation,
      });
      expect(textOf(result)).toBe(regen);
      expect(onViolation).toHaveBeenCalledWith(expect.objectContaining({ rule: _rule }), 'regen');
    },
  );

  it('keeps the original prose for a stylistic violation when the regen fails', async () => {
    const response = raw('You land on the stone floor.');
    const onRegenError = vi.fn();
    const result = await enforceNarrationContract(response, {
      tacticalContext: contextFor(RUN_10_NPC_MISS),
      generateText: async () => {
        throw new Error('provider down');
      },
      onRegenError,
    });
    expect(result).toBe(response);
    expect(onRegenError).toHaveBeenCalled();
  });

  it('logs every original violation with its rule and matched text', async () => {
    const onViolation = vi.fn();
    await enforceNarrationContract(raw('It is not your turn yet. You dash away.'), {
      tacticalContext: contextFor(RUN_M4_SPELL_DECLARED),
      generateText: async () => 'The elemental crackles; you ready Chill Touch.',
      onViolation,
    });
    expect(onViolation.mock.calls).toEqual([
      [expect.objectContaining({ rule: 'unresolved_action', matched: 'You dash' }), 'original'],
      [
        expect.objectContaining({ rule: 'false_turn_denial', matched: 'not your turn' }),
        'original',
      ],
    ]);
  });
});
