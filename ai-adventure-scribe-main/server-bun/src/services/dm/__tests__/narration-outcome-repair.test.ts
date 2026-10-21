import { describe, expect, test } from 'bun:test';

import { describeAttackRoll } from '../../../../../shared/describe-attack-roll.js';
import {
  contradictsEngineOutcome,
  spliceContradictingSentences,
} from '../../../../../shared/narration-harm.js';
import { repairNarration, repairPrematureRollClaims } from '../narration-outcome.js';

// #266: the repair states the engine's authoritative outcome plainly — it replaces the false
// claim, it does not embroider it, and it never invents a consequence.
describe('repairNarration (#266)', () => {
  test('a failed check becomes a plain failure statement', () => {
    expect(
      repairNarration({
        success: false,
        total: 7,
        dc: 14,
        description: 'Stealth check to climb the shaft unheard',
      }),
    ).toBe('The Stealth check to climb the shaft unheard failed (7 vs DC 14).');
  });

  test('a successful attack narrated as a miss becomes a plain success statement', () => {
    expect(
      repairNarration({ success: true, total: 18, ac: 15, description: 'longsword attack' }),
    ).toBe('The longsword attack succeeded (18 vs AC 15).');
  });

  test('missing details degrade gracefully', () => {
    expect(repairNarration({ success: false, total: 7 })).toBe('The attempt failed (7).');
    expect(repairNarration({ success: true, total: 20 })).toBe('The attempt succeeded (20).');
  });
});

// #467 NT-013: the DM dismissed an engine hit as "ignores your magical assault".
// The roll_result payload uses the describeAttackRoll shape: a spell attack
// description, success, total, and AC. The description is derived from the real
// producer, not handwritten.
describe('NT-013 repair (strategist FIX)', () => {
  const nt013Text = 'The mechanical server ignores your magical assault, its gears grinding on.';
  const nt013Description = describeAttackRoll({
    kind: 'spell-attack',
    weaponName: 'Chill Touch',
    targetLabel: 'Mechanical Server',
    actorLabel: 'The Apprentice',
    attackBonus: 5,
    targetAc: 15,
    advantage: false,
    disadvantage: false,
  });
  const nt013Outcome = {
    success: true,
    total: 22,
    ac: 15,
    requestType: 'attack',
    description: nt013Description,
  };

  test('the dismissal is caught and the sentence is replaced by the engine truth', () => {
    const claims = contradictsEngineOutcome(nt013Text, nt013Outcome);
    expect(claims.length).toBeGreaterThan(0);
    const truth = repairNarration(nt013Outcome);
    expect(truth).toBe(`The ${nt013Description} succeeded (22 vs AC 15).`);
    const spliced = spliceContradictingSentences(nt013Text, claims, truth);
    expect(spliced).toBe(truth);
    expect(spliced).not.toContain('ignores your magical assault');
  });
});

// The strategist FIX: only the contradicting sentences are replaced — the rest of the DM's
// reply is legitimate prose and stays.
describe('spliceContradictingSentences (#266)', () => {
  const failedStealth = {
    success: false,
    description: 'Stealth check to climb the shaft unheard',
    requestType: 'skill_check',
  };
  const truth = 'The Stealth check to climb the shaft unheard failed (7 vs DC 14).';

  const claimsFor = (text: string) => contradictsEngineOutcome(text, failedStealth);

  test('the contradicting sentence is replaced, the rest of the reply stands', () => {
    const text =
      'You take 2 damage scraping against the rough wall. ' +
      'You succeed in climbing the shaft unheard. ' +
      'Something below stirs at the noise.';
    const claims = claimsFor(text);
    expect(claims.length).toBeGreaterThan(0);
    expect(spliceContradictingSentences(text, claims, truth)).toBe(
      'You take 2 damage scraping against the rough wall. ' +
        'The Stealth check to climb the shaft unheard failed (7 vs DC 14). ' +
        'Something below stirs at the noise.',
    );
  });

  test('a second contradicting sentence is removed, not repeated', () => {
    const text =
      'You succeed in climbing the shaft unheard. ' +
      'You manage to keep climbing the shaft in silence. ' +
      'The guards notice nothing.';
    const claims = claimsFor(text);
    expect(claims.length).toBeGreaterThan(1);
    expect(spliceContradictingSentences(text, claims, truth)).toBe(
      'The Stealth check to climb the shaft unheard failed (7 vs DC 14). The guards notice nothing.',
    );
  });

  test('a contradicting first sentence is replaced in place', () => {
    const text = 'You succeed without a sound. Loose stones clatter down the shaft.';
    const result = spliceContradictingSentences(text, claimsFor(text), truth);
    expect(result.startsWith(truth)).toBe(true);
    expect(result).toContain('Loose stones clatter down the shaft.');
  });

  test('no claims leaves the text untouched', () => {
    const text = 'You fail to keep quiet. Loose stones clatter down the shaft.';
    expect(spliceContradictingSentences(text, [], truth)).toBe(text);
  });

  test('an unknown claim leaves the text untouched', () => {
    const text = 'You fail to keep quiet. Loose stones clatter down the shaft.';
    expect(spliceContradictingSentences(text, [{ match: 'you succeed', index: 999 }], truth)).toBe(
      text,
    );
  });

  test('reversed-order claims splice in text order (strategist FIX)', () => {
    // "you succeed" comes before "you manage to" in the text, but the pattern order
    // lists "you manage to" first. Both sentences must go.
    const text =
      'You succeed in climbing the shaft unheard. ' +
      'You manage to keep climbing the shaft in silence. ' +
      'The guards notice nothing.';
    const claims = claimsFor(text);
    expect(claims.length).toBeGreaterThan(1);
    const result = spliceContradictingSentences(text, claims, truth);
    expect(result).toBe(
      'The Stealth check to climb the shaft unheard failed (7 vs DC 14). The guards notice nothing.',
    );
  });

  test('a repeated phrase splices every occurrence (strategist FIX)', () => {
    const text =
      'You succeed in climbing the shaft unheard. ' +
      'You succeed in climbing the shaft unheard. ' +
      'The guards notice nothing.';
    const claims = claimsFor(text);
    // Two occurrences, two claims with different indices.
    expect(claims.length).toBe(2);
    const result = spliceContradictingSentences(text, claims, truth);
    expect(result).toBe(
      'The Stealth check to climb the shaft unheard failed (7 vs DC 14). The guards notice nothing.',
    );
  });

  test('a negated first occurrence does not hide a later real one (strategist FIX)', () => {
    // "You don't succeed" is negated (filtered); "You succeed" later is real.
    // The splicer must find the real one, not stop at the negated text.
    const text = "You don't succeed in climbing. You succeed in climbing the shaft unheard.";
    const claims = claimsFor(text);
    expect(claims.length).toBe(1);
    const result = spliceContradictingSentences(text, claims, truth);
    expect(result).toContain('The Stealth check to climb the shaft unheard failed (7 vs DC 14).');
  });
});

// #266 NT-011/NT-020: the reply that REQUESTS the roll narrates its outcome in the same
// breath — the narration posts before the dice exist, so no outcome repair can ever see
// it. The request objects below use the real envelope shape (dm-response-schema.ts
// roll_requests: type, formula, purpose, dc, ac, advantage, disadvantage).
describe('repairPrematureRollClaims (#266)', () => {
  const STEALTH_REQUEST = {
    type: 'check',
    formula: '1d20+5',
    purpose: 'Stealth check to climb the shaft',
    dc: 14,
    ac: null,
    advantage: false,
    disadvantage: false,
  };

  // #959 forward-fix: these two expectations FLIP, and the flip is a CONCESSION,
  // stated plainly (self-review HIGH 2): both inputs are semantically premature
  // claims about the pending action phrased in synonyms the request never uses
  // ("slipping past the guard post" for a shaft-climb Stealth check; "purchase on
  // the slick stone" for the climb itself). Lexically they cannot be told apart
  // from a decided roll's recap about a different action (harness case A below),
  // which the unscoped #959 pass corrupted — so the scoped pass leaves any verdict
  // sentence that names none of the pending action's distinctive keywords alone,
  // these included. The strategist's anchoring directive accepts that trade: the
  // pass now catches verdicts in the request's own vocabulary (and, when the
  // purpose names no distinctive action at all, falls back to the detector).
  test('a success verdict that does not name the pending action is left alone', () => {
    const text =
      'You succeed in slipping past the guard post without a sound. Roll for Stealth.';
    expect(repairPrematureRollClaims(text, [STEALTH_REQUEST])).toBeNull();
  });

  test('a failure verdict that does not name the pending action is left alone', () => {
    const text = 'You fail to find any purchase on the slick stone. Roll a Stealth check.';
    expect(repairPrematureRollClaims(text, [STEALTH_REQUEST])).toBeNull();
  });

  test('a soft verdict anchored on the requested action is repaired', () => {
    const text = 'You manage to climb the shaft in perfect silence. Roll a Stealth check.';
    const repaired = repairPrematureRollClaims(text, [STEALTH_REQUEST]);
    expect(repaired).toBe(
      'That outcome is not decided yet — the roll still has to be made. Roll a Stealth check.',
    );
  });

  test('a soft verdict about something else is not a claim on the pending roll', () => {
    const text =
      'You manage to catch your breath at the ledge. Roll a Stealth check to climb the shaft.';
    expect(repairPrematureRollClaims(text, [STEALTH_REQUEST])).toBeNull();
  });

  test('a neutral requesting reply passes through untouched', () => {
    const text =
      'The shaft rises into darkness above you, slick with condensation. ' +
      'Roll a Stealth check to climb it unheard.';
    expect(repairPrematureRollClaims(text, [STEALTH_REQUEST])).toBeNull();
  });

  test('no verdict-bearing request, no repair', () => {
    const text = 'You succeed in climbing the shaft unheard.';
    expect(repairPrematureRollClaims(text, [])).toBeNull();
    expect(repairPrematureRollClaims(text, undefined)).toBeNull();
    // Damage and initiative requests carry no pass/fail verdict to pre-narrate.
    expect(
      repairPrematureRollClaims(text, [
        { type: 'damage', formula: '1d6', purpose: 'falling damage', dc: null, ac: null },
        { type: 'initiative', formula: '1d20+3', purpose: 'initiative', dc: null, ac: null },
      ]),
    ).toBeNull();
  });

  test('a prototype key is not a request type', () => {
    const text = 'You succeed in climbing the shaft unheard.';
    for (const type of ['toString', 'constructor', 'hasOwnProperty']) {
      expect(
        repairPrematureRollClaims(text, [
          { type, formula: '1d20+5', purpose: 'Stealth check to climb the shaft', dc: 14, ac: null },
        ]),
      ).toBeNull();
    }
  });
});

// #959 forward-fix: PR #959 shipped the premature pass unscoped, and its own self-review
// (delivered after the merge) confirmed two blockers against the shipped code — a decided
// roll's recap spliced as if it claimed the pending roll, and conditional stakes framing
// replaced wholesale. The cases below are that review's harness inputs, verbatim.
describe('repairPrematureRollClaims — #959 forward-fix scoping', () => {
  const req = (type: string, purpose: string, dc: number | null = 14) => ({
    type,
    formula: '1d20+5',
    purpose,
    dc,
    ac: null,
    advantage: false,
    disadvantage: false,
  });
  const THIEVES_TOOLS_REQUEST = {
    type: 'check',
    formula: '1d20+5',
    purpose: "Thieves' Tools check to open the gate",
    dc: 15,
    ac: null,
    advantage: false,
    disadvantage: false,
  };

  test('case A: a decided roll’s recap in a requesting reply is untouched', () => {
    const text =
      'You succeed in climbing the shaft unheard. A locked gate blocks the ledge — ' +
      "roll a Thieves' Tools check.";
    expect(repairPrematureRollClaims(text, [THIEVES_TOOLS_REQUEST])).toBeNull();
  });

  test('case A mirror: a decided roll’s failure recap is equally untouched', () => {
    const text =
      'You fail to budge the portcullis. Roll a Thieves\' Tools check to pick the lock instead.';
    expect(repairPrematureRollClaims(text, [THIEVES_TOOLS_REQUEST])).toBeNull();
  });

  test('case B: conditional stakes framing is untouched', () => {
    const text =
      'Roll a Strength check. If you succeed, you pry the gate open before the patrol ' +
      'returns; if you fail, the alarm bell rings.';
    expect(
      repairPrematureRollClaims(text, [req('check', 'Strength check to pry the gate')]),
    ).toBeNull();
  });

  test('whether-framed stakes are untouched even with the action named', () => {
    const text =
      'Whether you succeed or fail at opening the gate, the noise will draw the patrol. ' +
      "Roll a Thieves' Tools check.";
    expect(repairPrematureRollClaims(text, [THIEVES_TOOLS_REQUEST])).toBeNull();
  });

  test('case C: the intended NT-011 catch still repairs', () => {
    const text =
      "You succeed in reading the crystal's fractures like a diagnosis. " +
      'Roll an Investigation check to learn more.';
    const repaired = repairPrematureRollClaims(text, [
      req('check', 'Investigation check to examine the crystal'),
    ]);
    expect(repaired).toBe(
      'That outcome is not decided yet — the roll still has to be made. ' +
        'Roll an Investigation check to learn more.',
    );
  });

  test('an anchored failure claim about the pending action still repairs', () => {
    const text = 'You fail to open the gate despite your tools. Roll a Thieves\' Tools check.';
    const repaired = repairPrematureRollClaims(text, [THIEVES_TOOLS_REQUEST]);
    expect(repaired).toBe(
      'That outcome is not decided yet — the roll still has to be made. ' +
        "Roll a Thieves' Tools check.",
    );
  });

  test('a miss with no player anchor is not the pending attack’s verdict', () => {
    const text = 'An arrow misses the goblin in the dark. Roll your attack.';
    expect(
      repairPrematureRollClaims(text, [req('attack', 'Longsword attack vs Goblin', null)]),
    ).toBeNull();
  });

  test('the player’s own miss narrated for the pending attack still repairs', () => {
    const text = 'Your strike misses the goblin. Roll your attack.';
    const repaired = repairPrematureRollClaims(text, [
      req('attack', 'Longsword attack vs Goblin', null),
    ]);
    expect(repaired).toBe(
      'That outcome is not decided yet — the roll still has to be made. Roll your attack.',
    );
  });
});

// Self-review round (pre-push review of this fix): the pinned harness cases passed
// but trivial rewordings of both #959 harms survived. These are that review's probe
// inputs, pinned so the shapes — not the sample sentences — are what is fixed.
describe('repairPrematureRollClaims — self-review rewordings', () => {
  const req = (type: string, purpose: string, dc: number | null = 14) => ({
    type,
    formula: '1d20+5',
    purpose,
    dc,
    ac: null,
    advantage: false,
    disadvantage: false,
  });
  const THIEVES_TOOLS = req('check', "Thieves' Tools check to open the gate", 15);
  const PENDING = 'That outcome is not decided yet — the roll still has to be made.';

  test('paired stakes without "if" are untouched', () => {
    const text =
      'Roll a Strength check. You succeed, you pry the gate open; you fail, the alarm bell rings.';
    expect(
      repairPrematureRollClaims(text, [req('check', 'Strength check to pry the gate')]),
    ).toBeNull();
  });

  test('inverted and adverbial conditionals are untouched', () => {
    for (const opener of [
      'Should you succeed in opening the gate, the way inside stands clear.',
      'When you succeed in opening the gate, the way inside stands clear.',
      'Once you succeed in opening the gate, the way inside stands clear.',
      'Provided you succeed in opening the gate, the way inside stands clear.',
      'As long as you succeed in opening the gate quietly, the patrol hears nothing.',
    ]) {
      expect(
        repairPrematureRollClaims(`${opener} Roll a Thieves' Tools check.`, [THIEVES_TOOLS]),
      ).toBeNull();
    }
  });

  test('a stakes question is untouched', () => {
    const text =
      "Will you succeed in opening the gate before the patrol returns? Roll a Thieves' Tools check.";
    expect(repairPrematureRollClaims(text, [THIEVES_TOOLS])).toBeNull();
  });

  test('recaps sharing only type/ability words with the request are untouched', () => {
    expect(
      repairPrematureRollClaims(
        "You succeed skillfully in climbing the shaft unheard. A locked gate blocks the ledge — roll a Thieves' Tools check.",
        [THIEVES_TOOLS],
      ),
    ).toBeNull();
    expect(
      repairPrematureRollClaims(
        'You succeed in saving the child from the rubble. Roll a Strength saving throw to hold up the falling beam.',
        [req('save', 'Strength saving throw to hold up the falling beam')],
      ),
    ).toBeNull();
    expect(
      repairPrematureRollClaims(
        'You succeed in throwing the grappling hook up to the ledge. Roll a Dexterity saving throw to dodge the falling debris.',
        [req('save', 'Dexterity saving throw to dodge the falling debris')],
      ),
    ).toBeNull();
    expect(
      repairPrematureRollClaims(
        'You succeed in climbing the shaft because the iron rungs hold firm. Roll a Dexterity check to use the rope to descend.',
        [req('check', 'Dexterity check to use the rope to descend')],
      ),
    ).toBeNull();
  });

  test('an unrelated modal or a concessive clause does not shield an asserted claim', () => {
    for (const text of [
      "The lock can be heard clicking softly as you succeed in opening the gate. Roll a Thieves' Tools check.",
      "You may not have a key, but you succeed in opening the gate anyway. Roll a Thieves' Tools check.",
      "You succeed in opening the gate even if the old hinges protest. Roll a Thieves' Tools check.",
    ]) {
      expect(repairPrematureRollClaims(text, [THIEVES_TOOLS])).toBe(
        `${PENDING} Roll a Thieves' Tools check.`,
      );
    }
  });

  test('a conditional hidden behind an abbreviation still reads as stakes', () => {
    const text =
      "If the blessing of St. Cuthbert holds, you succeed in opening the gate. Roll a Thieves' Tools check.";
    expect(repairPrematureRollClaims(text, [THIEVES_TOOLS])).toBeNull();
  });

  test('a miss that names none of the attack vocabulary still repairs', () => {
    const attack = req('attack', 'Longsword attack vs Goblin', null);
    expect(
      repairPrematureRollClaims('Your strike misses entirely, ringing off stone. Roll your attack.', [
        attack,
      ]),
    ).toBe(`${PENDING} Roll your attack.`);
    expect(
      repairPrematureRollClaims('The creature ignores your assault, laughing in the dark. Roll your attack.', [
        attack,
      ]),
    ).toBe(`${PENDING} Roll your attack.`);
  });

  test("a third party's miss observed by the player is untouched", () => {
    const text =
      'While you watch from the shadows, an arrow misses the goblin and skitters away. Roll your attack.';
    expect(
      repairPrematureRollClaims(text, [req('attack', 'Longsword attack vs Goblin', null)], 'Mira'),
    ).toBeNull();
  });

  test('a bare purpose with no distinctive action falls back to the detector', () => {
    const text = 'You succeed in prying the gate open with a grunt. Roll a Strength check.';
    expect(repairPrematureRollClaims(text, [req('check', 'Strength check')])).toBe(
      `${PENDING} Roll a Strength check.`,
    );
  });

  test('back-to-back pending statements collapse to one', () => {
    const text =
      "You succeed in opening the gate. You fail to open the gate quietly. Roll a Thieves' Tools check.";
    expect(repairPrematureRollClaims(text, [THIEVES_TOOLS])).toBe(
      `${PENDING} Roll a Thieves' Tools check.`,
    );
  });
});

// Strategist FIX round 1 on PR #979: the paired-stakes exemption must require a
// branch structure; an asserted success+failure contrast is a claim.
describe('repairPrematureRollClaims — strategist FIX round 1', () => {
  test('an asserted success+failure contrast in one clause still repairs', () => {
    const text =
      'You succeed in slipping past the guard, but you fail to notice the dog. Roll a Stealth check.';
    const repaired = repairPrematureRollClaims(text, [
      {
        type: 'check',
        formula: '1d20+5',
        purpose: 'Stealth check to slip past the guard post',
        dc: 14,
        ac: null,
        advantage: false,
        disadvantage: false,
      },
    ]);
    expect(repaired).toBe(
      'That outcome is not decided yet — the roll still has to be made. Roll a Stealth check.',
    );
  });
});

// #266 round 2 (strategist items on #266, after #979): (1) the branch-marker scan
// is scoped to the claim's clause — a marker in a later clause cannot exempt an
// asserted contrast, and a ';' pair must carry its verdicts on different sides;
// (2) keyword inflection covers doubled consonants (slip→slipping/slipped).
describe('repairPrematureRollClaims — #266 round 2', () => {
  const req = (type: string, purpose: string, dc: number | null = 14) => ({
    type,
    formula: '1d20+5',
    purpose,
    dc,
    ac: null,
    advantage: false,
    disadvantage: false,
  });
  const STEALTH_SLIP = req('check', 'Stealth check to slip past the guard post');
  const PENDING = 'That outcome is not decided yet — the roll still has to be made.';

  test('a branch marker in a later clause does not exempt an asserted contrast', () => {
    const text =
      'You succeed in slipping past the guard, but you fail to notice the dog, ' +
      'even if the hinges protest. Roll a Stealth check.';
    expect(repairPrematureRollClaims(text, [STEALTH_SLIP])).toBe(
      `${PENDING} Roll a Stealth check.`,
    );
  });

  test('an asserted contrast is not a semicolon pair when both verdicts share a side', () => {
    const text =
      'You succeed in slipping past the guard, but you fail to notice the dog; ' +
      'the torch gutters in the wind. Roll a Stealth check.';
    expect(repairPrematureRollClaims(text, [STEALTH_SLIP])).toBe(
      `${PENDING} Roll a Stealth check.`,
    );
  });

  test('either/or stakes stay untouched: the opening marker scopes both branches', () => {
    const text =
      'Either you succeed and slip through, or you fail and fall. ' +
      'Roll a Stealth check to slip past the guard post.';
    expect(repairPrematureRollClaims(text, [STEALTH_SLIP])).toBeNull();
  });

  test('an or-joined pair in one semicolon branch stays untouched', () => {
    // A preamble clause before the ';' puts both verdicts in the second branch;
    // as an "or"-alternation they are still paired stakes, not an asserted
    // contrast (self-review BLOCKER 1).
    expect(
      repairPrematureRollClaims(
        'The guard turns away; you succeed and slip through, or you fail and stumble. ' +
          'Roll a Stealth check to slip past the guard post.',
        [STEALTH_SLIP],
      ),
    ).toBeNull();
    expect(
      repairPrematureRollClaims(
        'Torches gutter in the wind; you fail and fall, or you succeed and slip through. ' +
          'Roll a Stealth check to slip past the guard post.',
        [STEALTH_SLIP],
      ),
    ).toBeNull();
  });

  test('a branch marker after the claim’s clause no longer frames it (otherwise)', () => {
    // The comma variant of the ';' otherwise stakes above: "otherwise" opens a
    // LATER clause, so under the clause scope it frames nothing about the
    // asserted success claim (#266 round 2, by the item's letter).
    const text =
      'You succeed and slip through, otherwise you fail and the alarm rings. ' +
      'Roll a Stealth check to slip past the guard post.';
    expect(repairPrematureRollClaims(text, [STEALTH_SLIP])).toBe(
      `${PENDING} Roll a Stealth check to slip past the guard post.`,
    );
  });

  test('a branch marker inside the claim’s own clause still frames it', () => {
    const text =
      'You succeed if the hinges stay silent, or you fail if they creak. ' +
      'Roll a Stealth check to slip past the guard post.';
    expect(repairPrematureRollClaims(text, [STEALTH_SLIP])).toBeNull();
  });

  test('otherwise stakes stay untouched', () => {
    const text =
      'Slip through and you succeed; otherwise, you fail and the alarm rings. ' +
      'Roll a Stealth check to slip past the guard post.';
    expect(repairPrematureRollClaims(text, [STEALTH_SLIP])).toBeNull();
  });

  test('a doubled-consonant inflection names the pending action (slipping)', () => {
    const text =
      'You succeed in slipping through the dark unseen. ' +
      'Roll a Stealth check to slip past the guard.';
    expect(
      repairPrematureRollClaims(text, [req('check', 'Stealth check to slip past the guard')]),
    ).toBe(`${PENDING} Roll a Stealth check to slip past the guard.`);
  });

  test('a doubled-consonant inflection names the pending action (slipped, fail side)', () => {
    const text =
      'You fail as the knot slipped tighter instead. ' +
      'Roll a Dexterity check to slip free of the ropes.';
    expect(
      repairPrematureRollClaims(text, [req('check', 'Dexterity check to slip free of the ropes')]),
    ).toBe(`${PENDING} Roll a Dexterity check to slip free of the ropes.`);
  });

  test('a doubled-consonant inflection names the pending action (grabbing)', () => {
    const text =
      'You succeed in grabbing the ledge. Roll a Dexterity check to grab the rope.';
    expect(
      repairPrematureRollClaims(text, [req('check', 'Dexterity check to grab the rope')]),
    ).toBe(`${PENDING} Roll a Dexterity check to grab the rope.`);
  });

  test('a doubled form in a recap of a different action is still left alone', () => {
    const text =
      'You succeed in slipping past the outer guard post unheard. ' +
      "A locked gate blocks the ledge — roll a Thieves' Tools check.";
    expect(
      repairPrematureRollClaims(text, [req('check', "Thieves' Tools check to open the gate", 15)]),
    ).toBeNull();
  });

  test('a keyword does not match a longer word that merely shares its doubled stem', () => {
    // "slippery" contains slipp- but names no action; it must not anchor the claim.
    const text =
      'You succeed in crossing the slippery stones. ' +
      'Roll a Stealth check to slip past the guard.';
    expect(
      repairPrematureRollClaims(text, [req('check', 'Stealth check to slip past the guard')]),
    ).toBeNull();
  });
});
