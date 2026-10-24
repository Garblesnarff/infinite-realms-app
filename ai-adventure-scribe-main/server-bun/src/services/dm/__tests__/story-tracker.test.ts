/**
 * #1042: the pure halves of story-tracker.ts — the change validator, the
 * clock-definition parser over campaign_rules rows (the audit's parseable
 * shape), and the directive text — run without a database. The applier's
 * database behavior is covered by
 * services/__tests__/story-ending.real-db.test.ts (the tracker describe).
 */
import { describe, expect, test } from 'bun:test';

import {
  ONE_SHOT_TURN_BUDGET,
  buildEndingRequiredCorrectivePrompt,
  engineWrittenEndingSummary,
  mergeStoredTrackers,
  normalizeClockName,
  pacingBudgetFor,
  pacingDirectiveTurn,
  parseClockDefinitions,
  trackerDirectiveText,
  validTrackerChanges,
} from '../story-tracker.js';

describe('validTrackerChanges', () => {
  test('accepts delta and set changes', () => {
    expect(validTrackerChanges([{ name: 'Sunset', delta: 1 }])).toBe(true);
    expect(validTrackerChanges([{ name: 'Score', set: 6 }])).toBe(true);
    expect(
      validTrackerChanges([
        { name: 'Fade', delta: 1 },
        { name: 'Setback', set: 5 },
      ]),
    ).toBe(true);
  });

  test('rejects malformed changes', () => {
    expect(validTrackerChanges(null)).toBe(false);
    expect(validTrackerChanges(undefined)).toBe(false);
    expect(validTrackerChanges([])).toBe(false);
    expect(validTrackerChanges('Sunset')).toBe(false);
    expect(validTrackerChanges([{}])).toBe(false);
    expect(validTrackerChanges([{ name: 'Sunset' }])).toBe(false);
    expect(validTrackerChanges([{ name: 'Sunset', delta: 1, set: 6 }])).toBe(false);
    expect(validTrackerChanges([{ name: '', delta: 1 }])).toBe(false);
    expect(validTrackerChanges([{ name: '  ', delta: 1 }])).toBe(false);
    expect(validTrackerChanges([{ name: 'Sunset', delta: 1.5 }])).toBe(false);
    expect(validTrackerChanges([{ name: 'Sunset', delta: '1' }])).toBe(false);
    expect(validTrackerChanges([{ name: 6, delta: 1 }])).toBe(false);
  });

  test('rejects an unbounded change list', () => {
    const nine = Array.from({ length: 9 }, () => ({ name: 'Sunset', delta: 1 }));
    expect(validTrackerChanges(nine)).toBe(false);
    expect(validTrackerChanges(nine.slice(0, 8))).toBe(true);
  });
});

describe('normalizeClockName', () => {
  test('the rules name, the DM name and the prose name agree', () => {
    expect(normalizeClockName('Sunset')).toBe('sunset');
    expect(normalizeClockName('Sunset Clock')).toBe('sunset');
    expect(normalizeClockName('the Sunset Clock')).toBe('sunset');
    expect(normalizeClockName('  Breath ')).toBe('breath');
  });
});

describe('parseClockDefinitions', () => {
  // The audit's live shape (the-gardeners-heir): clean causality rows whose
  // condition is exactly "the <Name> Clock reaches <N>", metadata empty.
  const auditRows = [2, 4, 6].map((n) => ({
    condition: `the Breath Clock reaches ${n}`,
    metadata: {},
  }));

  test('the limit is the highest reaches-N when no metadata pins it', () => {
    expect(parseClockDefinitions(auditRows)).toEqual([
      { name: 'Breath', limit: 6, atLimit: 'climax' },
    ]);
  });

  test('metadata limit and at_limit win over the prose rows', () => {
    const rows = [
      { condition: 'the Score Clock reaches 3', metadata: {} },
      { condition: 'the Score Clock reaches 5', metadata: { limit: 6, at_limit: 'ending' } },
    ];
    expect(parseClockDefinitions(rows)).toEqual([
      { name: 'Score', limit: 6, atLimit: 'ending' },
    ]);
  });

  test('a metadata limit is not raised by a later higher reaches row', () => {
    const rows = [
      { condition: 'the Score Clock reaches 5', metadata: { limit: 5 } },
      { condition: 'the Score Clock reaches 6', metadata: {} },
    ];
    expect(parseClockDefinitions(rows)).toEqual([
      { name: 'Score', limit: 5, atLimit: 'climax' },
    ]);
  });

  test('non-parseable rows define nothing (the audit’s two unparseable campaigns)', () => {
    const rows = [
      // the-held-rest: 6 appears only inside a compound condition.
      {
        condition: 'the Score Clock jumps to 6 when the wedge is pulled or the hero waits',
        metadata: {},
      },
      // the-last-true-blue p7: reaches 6 and two more conditions.
      {
        condition: 'the Fade Clock reaches 6 and no color is given and Orrin still conducts',
        metadata: {},
      },
      { condition: 'The party earns the grove’s trust', metadata: {} },
    ];
    expect(parseClockDefinitions(rows)).toEqual([]);
  });

  test('two clocks in one campaign stay separate', () => {
    const rows = [
      { condition: 'the Dawn Clock reaches 6', metadata: {} },
      { condition: 'the Dawn Clock reaches 2', metadata: {} },
      { condition: 'the Setback Clock reaches 6', metadata: {} },
    ];
    expect(parseClockDefinitions(rows)).toEqual([
      { name: 'Dawn', limit: 6, atLimit: 'climax' },
      { name: 'Setback', limit: 6, atLimit: 'climax' },
    ]);
  });

  test('row order changes nothing (the rules load carries no ORDER BY)', () => {
    const rows = [
      { condition: 'the Score Clock reaches 3', metadata: {} },
      { condition: 'the Score Clock reaches 5', metadata: { limit: 6, at_limit: 'ending' } },
      { condition: 'the Score Clock reaches 6', metadata: {} },
      { condition: 'the Breath Clock reaches 4', metadata: { limit: 4 } },
      { condition: 'the Breath Clock reaches 2', metadata: {} },
    ];
    const forward = parseClockDefinitions(rows);
    const reversed = parseClockDefinitions([...rows].reverse());
    const byName = (defs: typeof forward) => [...defs].sort((a, b) => a.name.localeCompare(b.name));
    expect(byName(reversed)).toEqual(byName(forward));
    expect(byName(forward)).toEqual([
      { name: 'Breath', limit: 4, atLimit: 'climax' },
      { name: 'Score', limit: 6, atLimit: 'ending' },
    ]);
  });
});

describe('parseClockDefinitions fail-closed (strategist FIX, PR #1053)', () => {
  // The audit's two unparseable campaigns, in its own row shapes: the
  // clean "reaches N" rows stop at 5, and 6 exists only in a tick row
  // (held-rest p2: pulling the Tuner's wedge sets the clock to 6) and a
  // compound ending row (p7). Reading the limit as 5 would climax both
  // campaigns one segment early, so no clock is defined at all.
  const heldRestRows = [
    ...[2, 3, 4, 5].map((n) => ({
      condition: `the Score Clock reaches ${n}`,
      effect: `The Score Clock stands at ${n} of 6 segments.`,
      metadata: {},
    })),
    {
      condition: 'the hero pulls the Tuner’s wedge',
      effect: 'The Score Clock jumps to 6.',
      metadata: {},
    },
    {
      condition:
        'the Score Clock reaches 5 for the third time or reaches 6 and the hero never offers a phrase',
      effect: 'Ending D: the Tuner takes the stage alone.',
      metadata: {},
    },
  ];
  const lastTrueBlueRows = [
    ...[2, 4, 5].map((n) => ({
      condition: `the Fade Clock reaches ${n}`,
      effect: `The Fade Clock stands at ${n} of 6 segments.`,
      metadata: {},
    })),
    {
      condition: 'the hero attacks, grapples or blocks Orrin before midnight',
      effect: 'The Fade Clock advances by 1 segment.',
      metadata: {},
    },
    {
      condition: 'the Fade Clock reaches 6 and no color is given and Orrin still conducts',
      effect: 'Ending D: the last true blue sounds alone.',
      metadata: {},
    },
  ];

  test('held-rest (Score): a higher value in tick and compound rows vetoes the prose limit', () => {
    expect(parseClockDefinitions(heldRestRows)).toEqual([]);
    expect(parseClockDefinitions([...heldRestRows].reverse())).toEqual([]);
  });

  test('last-true-blue (Fade): the compound reaches-6 row vetoes the prose limit', () => {
    expect(parseClockDefinitions(lastTrueBlueRows)).toEqual([]);
  });

  test('metadata limit rescues both shapes: stated, not inferred, so never vetoed', () => {
    const withMeta = (rows: typeof heldRestRows) =>
      rows.map((row) =>
        /^the (Score|Fade) Clock reaches 5$/.test(row.condition)
          ? { ...row, metadata: { limit: 6 } }
          : row,
      );
    expect(parseClockDefinitions(withMeta(heldRestRows))).toEqual([
      { name: 'Score', limit: 6, atLimit: 'climax' },
    ]);
    expect(parseClockDefinitions(withMeta(lastTrueBlueRows))).toEqual([
      { name: 'Fade', limit: 6, atLimit: 'climax' },
    ]);
  });

  test('singing-seal: non-clean rows at or below the clean limit do not veto it', () => {
    const rows = [
      ...[4, 6].map((n) => ({
        condition: `the Drill Clock reaches ${n}`,
        effect: `The Drill Clock stands at ${n} of 6 segments.`,
        metadata: {},
      })),
      {
        condition: 'the Drill Clock reaches 5, or anyone touches the Seal',
        effect: 'The drill falters.',
        metadata: {},
      },
      {
        condition: 'the Drill Clock reaches 3 and the powder catches',
        effect: 'Smoke fills the gallery.',
        metadata: {},
      },
      {
        condition: 'the shore guns fire on the Seal Gate',
        effect: 'The guns fire them at Clock 6.',
        metadata: {},
      },
    ];
    expect(parseClockDefinitions(rows)).toEqual([{ name: 'Drill', limit: 6, atLimit: 'climax' }]);
  });

  test('sown-field: the Setback counter’s 6 is not the Dawn Clock’s', () => {
    const rows = [
      ...[2, 4, 6].map((n) => ({
        condition: `the Dawn Clock reaches ${n}`,
        effect: `The Dawn Clock stands at ${n} of 6 segments.`,
        metadata: {},
      })),
      {
        condition: 'the hero is caught at the shrine or accuses the miller without proof',
        effect: 'The Setback counter reaches 6 and the Dawn Clock is set to 5.',
        metadata: {},
      },
    ];
    expect(parseClockDefinitions(rows)).toEqual([{ name: 'Dawn', limit: 6, atLimit: 'climax' }]);
  });

  test('a higher value stated in a CLEAN row’s effect vetoes the prose limit too', () => {
    // The condition is parseable; the higher value hides in its effect.
    // A rule states the limit clearly only when no row text contradicts
    // it — the effect is row text.
    const rows = [
      ...[2, 3, 4].map((n) => ({
        condition: `the Score Clock reaches ${n}`,
        effect: `The Score Clock stands at ${n} of 6 segments.`,
        metadata: {},
      })),
      {
        condition: 'the Score Clock reaches 5',
        effect: 'The Score Clock reaches 6 when the wedge is pulled.',
        metadata: {},
      },
    ];
    expect(parseClockDefinitions(rows)).toEqual([]);
  });

  test('a multi-word clock name attributes by its full name', () => {
    const rows = [
      ...[2, 4, 5].map((n) => ({
        condition: `the True Blue Clock reaches ${n}`,
        effect: `The True Blue Clock stands at ${n} of 6 segments.`,
        metadata: {},
      })),
      {
        condition: 'the True Blue Clock reaches 6 and no color is given',
        effect: 'Ending D.',
        metadata: {},
      },
    ];
    expect(parseClockDefinitions(rows)).toEqual([]);
  });

  test('a higher value tied to a different clock vetoes nothing', () => {
    const rows = [
      ...[2, 4, 6].map((n) => ({
        condition: `the Dawn Clock reaches ${n}`,
        metadata: {},
      })),
      { condition: 'the Bell Clock reaches 9 and the tower falls', metadata: {} },
    ];
    expect(parseClockDefinitions(rows)).toEqual([{ name: 'Dawn', limit: 6, atLimit: 'climax' }]);
  });
});

describe('trackerDirectiveText', () => {
  test('stored state renders as the tracker line', () => {
    const text = trackerDirectiveText({
      trackers: [{ name: 'Breath', value: 4, limit: 6 }],
      phase: null,
    });
    expect(text).toContain('Breath Clock: 4/6');
  });

  test('nothing to say is null', () => {
    expect(trackerDirectiveText({ trackers: [], phase: null })).toBeNull();
  });

  test('the first climax turn announces the climax', () => {
    const text = trackerDirectiveText({
      trackers: [{ name: 'Breath', value: 6, limit: 6 }],
      phase: {
        phase: 'climax',
        clock: 'Breath',
        climaxTurns: 0,
        endingRequired: false,
        lastMessageId: 'm1',
      },
    });
    expect(text).toContain('the climax is now');
  });

  test('a tripped safety net requires the ending', () => {
    const text = trackerDirectiveText({
      trackers: [{ name: 'Breath', value: 6, limit: 6 }],
      phase: {
        phase: 'climax',
        clock: 'Breath',
        climaxTurns: 6,
        endingRequired: true,
        lastMessageId: 'm7',
      },
    });
    expect(text).toContain('the ending is required');
    expect(text).toContain('campaign_ending');
  });

  test('a final-beat-armed phase requires the ending without naming a filled clock', () => {
    const text = trackerDirectiveText({
      trackers: [{ name: 'Breath', value: 1, limit: 6 }],
      phase: {
        phase: 'climax',
        clock: 'Breath',
        climaxTurns: 0,
        endingRequired: true,
        finalBeat: true,
        lastMessageId: 'm2',
      },
    });
    expect(text).toContain('final beat');
    expect(text).toContain('the ending is required');
    expect(text).toContain('Breath Clock: 1/6');
  });
});

describe('mergeStoredTrackers (#1062: the line the envelope carries)', () => {
  test('a stored value wins; a defined-but-untouched clock shows its start value', () => {
    expect(
      mergeStoredTrackers(
        [
          { name: 'Breath', limit: 6, atLimit: 'climax' },
          { name: 'Dawn', limit: 4, atLimit: 'climax' },
        ],
        [{ name: 'Breath', value: 5, limit: 6 }],
      ),
    ).toEqual([
      { name: 'Breath', value: 5, limit: 6 },
      { name: 'Dawn', value: 0, limit: 4 },
    ]);
  });

  test('a stored row whose rule was edited away still renders', () => {
    expect(
      mergeStoredTrackers(
        [{ name: 'Breath', limit: 6, atLimit: 'climax' }],
        [
          { name: 'Breath', value: 3, limit: 6 },
          { name: 'Ember', value: 2, limit: 5 },
        ],
      ),
    ).toEqual([
      { name: 'Breath', value: 3, limit: 6 },
      { name: 'Ember', value: 2, limit: 5 },
    ]);
  });
});

describe('trackerDirectiveText (#1062: the UI owns the line now)', () => {
  test('the directive tells the DM not to render a tracker line in prose', () => {
    const text = trackerDirectiveText({
      trackers: [{ name: 'Breath', value: 4, limit: 6 }],
      phase: null,
    });
    expect(text).toContain('Breath Clock: 4/6');
    expect(text).toContain('game UI');
    expect(text).toContain('do NOT render a tracker line');
  });
});

describe('the safety net as a real request (strategist FIX, PR #1053)', () => {
  test('the corrective prompt names the breach and the field that fixes it', () => {
    const prompt = buildEndingRequiredCorrectivePrompt({ clock: 'Breath' });
    expect(prompt).toContain('<corrective_instruction>');
    expect(prompt).toContain('Breath Clock reached its limit');
    expect(prompt).toContain('the ending is required');
    expect(prompt).toContain('campaign_ending');
  });

  test('the final-beat corrective prompt names the final beat, not a clock', () => {
    const prompt = buildEndingRequiredCorrectivePrompt({ clock: 'Breath', finalBeat: true });
    expect(prompt).toContain('final beat');
    expect(prompt).toContain('the ending is required');
    expect(prompt).not.toContain('Clock reached its limit');
  });

  test('the engine-written ending is short and names its trigger', () => {
    expect(engineWrittenEndingSummary({ clock: 'Breath' })).toContain('Breath Clock');
    expect(engineWrittenEndingSummary({ clock: 'Breath' })).toContain('the adventure ends');
    expect(engineWrittenEndingSummary({ clock: 'Breath', finalBeat: true })).toContain(
      'final beat',
    );
    expect(engineWrittenEndingSummary({ clock: 'Breath' }).length).toBeLessThan(600);
  });
});

describe('one-shot pacing budget (#1083)', () => {
  test('the budget is 60 player turns for one-shots, unbounded otherwise', () => {
    expect(ONE_SHOT_TURN_BUDGET).toBe(60);
    expect(pacingBudgetFor('one-shot')).toBe(60);
    expect(pacingBudgetFor('campaign')).toBeNull();
    expect(pacingBudgetFor(null)).toBeNull();
    expect(pacingDirectiveTurn(60)).toBe(45);
  });

  test('below 75% of the budget the pacing line does not render', () => {
    const text = trackerDirectiveText({
      trackers: [{ name: 'Breath', value: 3, limit: 6 }],
      phase: null,
      pacing: { turns: 44, budget: 60, clockName: 'Breath' },
    });
    expect(text).not.toContain('move toward the climax');
  });

  test('at 75% the pacing line names the turn, the budget and the clock to advance', () => {
    const text = trackerDirectiveText({
      trackers: [{ name: 'Breath', value: 3, limit: 6 }],
      phase: null,
      pacing: { turns: 45, budget: 60, clockName: 'Breath' },
    });
    expect(text).toContain('turn 45 of 60');
    expect(text).toContain('move toward the climax');
    expect(text).toContain('the Breath Clock');
    expect(text).toContain('bring in the final beat');
  });

  test('with no defined clock the pacing line still renders, clock-generic', () => {
    const text = trackerDirectiveText({
      trackers: [],
      phase: null,
      pacing: { turns: 50, budget: 60, clockName: null },
    });
    expect(text).toContain('turn 50 of 60');
    expect(text).toContain('the story clock');
  });

  test('once the climax phase exists the pacing line is superseded, not stacked', () => {
    const text = trackerDirectiveText({
      trackers: [{ name: 'Breath', value: 3, limit: 6 }],
      phase: {
        phase: 'climax',
        clock: 'Breath',
        climaxTurns: 2,
        endingRequired: false,
        lastMessageId: 'm1',
      },
      pacing: { turns: 62, budget: 60, clockName: 'Breath' },
    });
    expect(text).not.toContain('move toward the climax');
    expect(text).toContain('in its climax');
  });

  test('a budget-forced climax says the budget forced it, never a filled clock', () => {
    const first = trackerDirectiveText({
      trackers: [{ name: 'Breath', value: 3, limit: 6 }],
      phase: {
        phase: 'climax',
        clock: 'Breath',
        climaxTurns: 0,
        endingRequired: false,
        budgetForced: true,
        lastMessageId: 'm60',
      },
    });
    expect(first).toContain('turn budget is reached');
    expect(first).toContain('the climax is now');
    expect(first).not.toContain('reached its limit');
    const tripped = trackerDirectiveText({
      trackers: [{ name: 'Breath', value: 3, limit: 6 }],
      phase: {
        phase: 'climax',
        clock: 'Breath',
        climaxTurns: 6,
        endingRequired: true,
        budgetForced: true,
        lastMessageId: 'm66',
      },
    });
    expect(tripped).toContain('turn budget is reached');
    expect(tripped).toContain('the ending is required');
    expect(tripped).not.toContain('reached its limit');
  });

  test('the budget corrective prompt and engine ending name the budget, not a clock', () => {
    const prompt = buildEndingRequiredCorrectivePrompt({ clock: 'Breath', budgetForced: true });
    expect(prompt).toContain('turn budget is reached');
    expect(prompt).toContain('the ending is required');
    expect(prompt).not.toContain('Clock reached its limit');
    const summary = engineWrittenEndingSummary({ clock: 'Breath', budgetForced: true });
    expect(summary).toContain('turn budget is reached');
    expect(summary).toContain('the adventure ends');
    expect(summary).not.toContain('Clock reached its limit');
    // The final beat stays more specific than the budget when both armed it.
    expect(
      buildEndingRequiredCorrectivePrompt({ clock: 'Breath', finalBeat: true, budgetForced: true }),
    ).toContain('final beat');
    expect(
      trackerDirectiveText({
        trackers: [{ name: 'Breath', value: 3, limit: 6 }],
        phase: {
          phase: 'climax',
          clock: 'Breath',
          climaxTurns: 6,
          endingRequired: true,
          finalBeat: true,
          budgetForced: true,
          lastMessageId: 'm66',
        },
      }),
    ).toContain('final beat');
    expect(
      engineWrittenEndingSummary({ clock: 'Breath', finalBeat: true, budgetForced: true }),
    ).toContain('final beat');
  });
});
