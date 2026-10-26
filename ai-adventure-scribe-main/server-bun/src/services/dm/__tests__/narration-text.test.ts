import { describe, expect, test } from 'bun:test';

import { normalizePartialNarration, normalizeReplyNarration } from '../narration-text.js';

/**
 * #1067: the server normalizer (#875/#992, extended here) must strip the
 * three raw-model-artifact shapes Hark D23-006 caught in story text, and
 * must leave every other shape untouched. Fixtures follow the real producer:
 * the envelope object `llm-provider-service.ts` hands to
 * `normalizeReplyNarration` after parsing (forced-tool path and the
 * strict/instructed `normalizeStructuredReplyText` path alike).
 */
const envelope = (text: string): Record<string, unknown> => ({
  text,
  options: [],
  narration_segments: [],
  roll_requests: [],
  combat_transition: 'none',
  scene_spec: null,
  map_actions: [],
  handout_actions: [],
  combatants: [],
  combat_actions: [],
});

const normalizedText = (text: string): { text: string; kind: unknown } => {
  const env = envelope(text);
  const kind = normalizeReplyNarration(env);
  return { text: env.text as string, kind };
};

describe('normalizeReplyNarration #1067 artifact strips', () => {
  test('shape (a): a <parameter name="options"> block is removed, prose survives', () => {
    const { text, kind } = normalizedText(
      'Granny leans in close, her voice dropping to a whisper.' +
        '<parameter name="options">["Give the password", "Refuse"]</parameter>' +
        ' The room holds its breath.',
    );
    expect(kind).toBe('stripped');
    expect(text).toBe(
      'Granny leans in close, her voice dropping to a whisper. The room holds its breath.',
    );
    // Dangling fragment (no closing tag): the tool argument goes, prose stays.
    const dangling = normalizedText(
      'Granny leans in close.<parameter name="options">["Give the password", "Refuse"]',
    );
    expect(dangling.text).toBe('Granny leans in close.');
    expect(dangling.kind).toBe('stripped');
    // Dangling fragment followed by real prose: only the tag goes, the
    // prose tail survives (the tail is not purely the tool argument).
    const proseTail = normalizedText('Story.<parameter name="options">She turns and runs.');
    expect(proseTail.text).toBe('Story.She turns and runs.');
    expect(proseTail.kind).toBe('stripped');
  });

  test('shape (b): a trailing prose options list is removed', () => {
    const { text, kind } = normalizedText(
      'The prince studies you, waiting for an answer. ' +
        'options: A. Give the password Granny taught you. B. Refuse and run.',
    );
    expect(kind).toBe('stripped');
    expect(text).toBe('The prince studies you, waiting for an answer.');
  });

  test('shape (c): a trailing bracket tracker line is removed', () => {
    const { text, kind } = normalizedText(
      'The sun breaks over the garden wall, and for a moment everything is still. ' +
        '[HP 18/?] [Clock 0/6] [Contentment 0] [Spare Wish: unused] ' +
        "[Prince's tricks left: 2] [Scene: The Sunlit Garden]",
    );
    expect(kind).toBe('stripped');
    expect(text).toBe('The sun breaks over the garden wall, and for a moment everything is still.');
  });
});

// Stacking orders the loop in normalizeReplyNarration exists to handle:
// each trailing strip can expose another artifact behind it, so a single
// pass is not enough — these tests fail if the loop is removed.
describe('normalizeReplyNarration #1067 stacked artifacts', () => {
  const story = 'The sun breaks over the garden wall.';
  const tracker = ' [HP 18/?] [Clock 0/6]';
  const appendix = '\noptions: ["a", "b"]';
  const proseList = ' options: A. Give the password. B. Refuse.';

  test('tracker line behind an options appendix still comes off', () => {
    const { text, kind } = normalizedText(story + tracker + appendix);
    expect(kind).toBe('stripped');
    expect(text).toBe(story);
  });

  test('options appendix behind a tracker line still comes off', () => {
    const { text, kind } = normalizedText(story + appendix + tracker);
    expect(kind).toBe('stripped');
    expect(text).toBe(story);
  });

  test('prose list behind a tracker line still comes off', () => {
    const { text, kind } = normalizedText(story + proseList + tracker);
    expect(kind).toBe('stripped');
    expect(text).toBe(story);
  });

  test('unwrap adopts inner options and the strip still applies to inner text', () => {
    const inner = JSON.stringify({
      text: 'The prince waits. options: A. Give the password. B. Refuse.',
      options: ['Give the password', 'Refuse'],
      combat_transition: 'enter',
    });
    const env = envelope(inner);
    env.options = [];
    expect(normalizeReplyNarration(env)).toBe('unwrapped+stripped');
    expect(env.text).toBe('The prince waits.');
    expect(env.options).toEqual(['Give the password', 'Refuse']);
  });
});

describe('normalizeReplyNarration #1067 new shapes (follow-up)', () => {
  test('shape (d): an inline lettered list mid-article is removed, prose survives', () => {
    const { text, kind } = normalizedText(
      'The hollow yawns before you, dark and cold. ' +
        'A. Race for the hollow. B. Hide among the roots. C. Call out to the others. ' +
        'The wind answers nothing.',
    );
    expect(kind).toBe('stripped');
    expect(text).toBe('The hollow yawns before you, dark and cold. The wind answers nothing.');
  });

  test('shape (d): an options:-labelled list mid-text still leaks (the #1081 pin owns that shape)', () => {
    const input =
      'You weigh your options: A. Race for the hollow. B. Hide among the roots. Then you decide.';
    const { text, kind } = normalizedText(input);
    expect(kind).toBeNull();
    expect(text).toBe(input);
  });

  test('shape (d): an inline list behind a tracker line still comes off (loop)', () => {
    const { text, kind } = normalizedText(
      'The hollow yawns. A. Race for the hollow. B. Hide among the roots. ' +
        '[HP 18/?] [Clock 0/6]',
    );
    expect(kind).toBe('stripped');
    expect(text).toBe('The hollow yawns.');
  });

  test('shape (d): Plan A. is not a list start (no sentence boundary)', () => {
    const input = 'You settle on Plan A. Race for the hollow at dawn. B. Hide if it fails.';
    const { text, kind } = normalizedText(input);
    expect(kind).toBeNull();
    expect(text).toBe(input);
  });

  test('shape (d): a lone A. item is untouched (needs A and B)', () => {
    const input = 'The hollow yawns. A. Race for the hollow. The wind answers nothing.';
    const { text, kind } = normalizedText(input);
    expect(kind).toBeNull();
    expect(text).toBe(input);
  });

  test('shape (d): a non-sequential run is untouched (leaked, not deleted)', () => {
    const input = 'The hollow yawns. A. Race for the hollow. C. Call out to the others.';
    const { text, kind } = normalizedText(input);
    expect(kind).toBeNull();
    expect(text).toBe(input);
  });

  test('shape (d): an abbreviation breaks the run (multi-sentence item leaks)', () => {
    const input = 'The hollow yawns. A. Meet Dr. No. B. Hide among the roots.';
    const { text, kind } = normalizedText(input);
    expect(kind).toBeNull();
    expect(text).toBe(input);
  });

  test('shape (d): text that is only the list is kept (fail open, never empty)', () => {
    const input = 'A. Race for the hollow. B. Hide among the roots.';
    const { text, kind } = normalizedText(input);
    expect(kind).toBeNull();
    expect(text).toBe(input);
  });

  test('shape (e): the meta sentence is removed mid-text, at start, and at end', () => {
    const mid = normalizedText(
      'The prince studies you, waiting for an answer. ' +
        'Options are not shown here; choose your next move. The room holds its breath.',
    );
    expect(mid.kind).toBe('stripped');
    expect(mid.text).toBe(
      'The prince studies you, waiting for an answer. The room holds its breath.',
    );
    const start = normalizedText(
      'Options are not shown here; choose your next move. The prince studies you.',
    );
    expect(start.kind).toBe('stripped');
    expect(start.text).toBe('The prince studies you.');
    const end = normalizedText('The prince studies you. Options are not shown here.');
    expect(end.kind).toBe('stripped');
    expect(end.text).toBe('The prince studies you.');
    const theVariant = normalizedText(
      'The prince studies you. The options are not shown here. The room holds its breath.',
    );
    expect(theVariant.kind).toBe('stripped');
    expect(theVariant.text).toBe('The prince studies you. The room holds its breath.');
    const arent = normalizedText(
      "The prince studies you. Options aren't shown here. The room holds its breath.",
    );
    expect(arent.kind).toBe('stripped');
    expect(arent.text).toBe('The prince studies you. The room holds its breath.');
  });

  test('shape (e): a mid-sentence mention of the phrase is untouched', () => {
    const input = 'He said the options are not shown here, so choose blindly.';
    const { text, kind } = normalizedText(input);
    expect(kind).toBeNull();
    expect(text).toBe(input);
  });

  test('shape (d): a bare next-item letter rides along with a complete run (self-review Required 2)', () => {
    const { text, kind } = normalizedText(
      'The hollow yawns. A. Race for the hollow. B. Hide among the roots. C',
    );
    expect(kind).toBe('stripped');
    expect(text).toBe('The hollow yawns.');
  });

  test('shape (d): a bare letter that is not the expected next item does not ride along', () => {
    const { text, kind } = normalizedText(
      'The hollow yawns. A. Race for the hollow. B. Hide among the roots. D',
    );
    expect(kind).toBe('stripped');
    expect(text).toBe('The hollow yawns. D');
  });
});

describe('normalizeReplyNarration #1067 regression pins', () => {
  test('prose that merely mentions options is untouched', () => {
    const input = 'You weigh your options carefully before answering the prince.';
    const { text, kind } = normalizedText(input);
    expect(kind).toBeNull();
    expect(text).toBe(input);
  });

  test('a lone lettered item after options: is untouched (needs A and B)', () => {
    const input = 'You weigh your options: A. plan forms in your mind.';
    const { text, kind } = normalizedText(input);
    expect(kind).toBeNull();
    expect(text).toBe(input);
  });

  test('an options mention with no lettered items is untouched', () => {
    const input = 'You consider your options: fight or flight.';
    const { text, kind } = normalizedText(input);
    expect(kind).toBeNull();
    expect(text).toBe(input);
  });

  test('a prose list followed by resumed narration is untouched (leaked, not deleted)', () => {
    const input =
      'The prince waits. options: A. Give the password. B. Refuse. The sun rises and the garden wakes.';
    const { text, kind } = normalizedText(input);
    expect(kind).toBeNull();
    expect(text).toBe(input);
    const contract =
      'The contract reads — options: A. Serve one year. B. Pay the fine. You sign with a trembling hand.';
    const contractResult = normalizedText(contract);
    expect(contractResult.kind).toBeNull();
    expect(contractResult.text).toBe(contract);
  });

  test('trailing whitespace alone is not a strip (kind stays null, bytes kept)', () => {
    for (const input of ['The prince waits.   ', 'The prince waits.\n']) {
      const { text, kind } = normalizedText(input);
      expect(kind).toBeNull();
      expect(text).toBe(input);
    }
  });

  test('a single bracket aside is untouched', () => {
    const input = 'The scribe copies the line faithfully [sic] and moves on.';
    const { text, kind } = normalizedText(input);
    expect(kind).toBeNull();
    expect(text).toBe(input);
  });

  test('trailing asset tags are untouched', () => {
    const input =
      'The captain turns to you. [ASSET:npc:captain-sarah-reeves] [ASSET:npc:professor-emil-darkwater]';
    const { text, kind } = normalizedText(input);
    expect(kind).toBeNull();
    expect(text).toBe(input);
  });

  test('a lone tracker-looking group is untouched (needs a run)', () => {
    const input = 'The clock tower chimes midnight. [Clock 0/6]';
    const { text, kind } = normalizedText(input);
    expect(kind).toBeNull();
    expect(text).toBe(input);
  });

  test('text that is only the tracker line is kept (fail open, never empty)', () => {
    const input = '[HP 18/?] [Clock 0/6]';
    const { text, kind } = normalizedText(input);
    expect(kind).toBeNull();
    expect(text).toBe(input);
  });

  test('the structured options field is untouched by every strip', () => {
    const env = envelope('The prince waits. options: A. Give the password. B. Refuse.');
    env.options = ['Give the password', 'Refuse'];
    expect(normalizeReplyNarration(env)).toBe('stripped');
    expect(env.text).toBe('The prince waits.');
    expect(env.options).toEqual(['Give the password', 'Refuse']);
  });
});

const BRACKET_RUN_1067 =
  '[HP 100/100] [Clock 6/6] [Contentment 0] [Spare Wish: unused] ' +
  "[Prince's tricks left: 2] [Scene: the Palace of the Contented King, the throne room, sunset]";

describe('normalizeReplyNarration #1067 V-008/V-009', () => {
  const story = 'The king smiles and says nothing more.';

  test('strips the long trailing bracket tracker run', () => {
    const { text, kind } = normalizedText(story + ' ' + BRACKET_RUN_1067);
    expect(kind).toBe('stripped');
    expect(text).toBe(story);
  });

  test('strips the player input is required meta sentence', () => {
    const { text, kind } = normalizedText(
      'The king smiles and says nothing more. Player input is required on what you do next.',
    );
    expect(kind).toBe('stripped');
    expect(text).toBe('The king smiles and says nothing more.');
  });

  test('untouched: a single trailing long group', () => {
    const input =
      'The throne room glows. [Scene: the Palace of the Contented King, the throne room, sunset]';
    const { text, kind } = normalizedText(input);
    expect(kind).toBeNull();
    expect(text).toBe(input);
  });

  test('untouched: one bracket group mid-sentence', () => {
    const input = 'The herald reads [Spare Wish: unused] aloud and bows.';
    const { text, kind } = normalizedText(input);
    expect(kind).toBeNull();
    expect(text).toBe(input);
  });

  test('untouched: a mid-sentence mention of player input is required', () => {
    const input = 'The oracle says that player input is required on what you do next.';
    const { text, kind } = normalizedText(input);
    expect(kind).toBeNull();
    expect(text).toBe(input);
  });
});

describe('normalizePartialNarration #1067 V-008/V-009', () => {
  const story = 'The king smiles and says nothing more.';

  test('holds back the long trailing bracket tracker run', () => {
    expect(normalizePartialNarration(story + ' ' + BRACKET_RUN_1067)).toBe(story);
  });

  test('holds back the player input is required meta sentence', () => {
    expect(
      normalizePartialNarration(story + ' Player input is required on what you do next.'),
    ).toBe(story);
  });
});
