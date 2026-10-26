/**
 * #633 PR2: unit tests for the incremental narration extractor used by the
 * SSE streaming path.
 */
import { describe, expect, it } from 'bun:test';

import { normalizeReplyNarration } from '../../../services/dm/narration-text.js';
import { extractPartialNarration } from '../llm-streaming.js';

describe('extractPartialNarration', () => {
  it('returns null before the text key arrives', () => {
    expect(extractPartialNarration('')).toBeNull();
    expect(extractPartialNarration('{"combat_transition": "none", ')).toBeNull();
  });

  it('returns null when the key itself is cut mid-token', () => {
    expect(extractPartialNarration('{"tex')).toBeNull();
    expect(extractPartialNarration('{"text"')).toBeNull();
  });

  it('extracts the narration prefix as tokens arrive', () => {
    expect(extractPartialNarration('{"text": "The tavern')).toBe('The tavern');
    expect(extractPartialNarration('{"text": "The tavern door')).toBe('The tavern door');
  });

  it('decodes a complete envelope', () => {
    expect(extractPartialNarration('{"text": "Hi", "combat_transition": "none"}')).toBe('Hi');
  });

  it('finds the text key when it is not first', () => {
    expect(extractPartialNarration('{"combat_transition": "none", "text": "Late"}')).toBe('Late');
  });

  it('ignores a nested "text" key before the top-level one', () => {
    expect(extractPartialNarration('{"scene": {"text": "nested"}, "text": "top-level')).toBe(
      'top-level',
    );
  });

  it('tolerates whitespace around the colon', () => {
    expect(extractPartialNarration('{"text"  :  "spaced"}')).toBe('spaced');
  });

  it('handles a value cut mid-escape', () => {
    // Tail is a lone backslash: trimmed, the rest decodes.
    expect(extractPartialNarration('{"text": "abc\\')).toBe('abc');
    // Tail is a partial \u escape.
    expect(extractPartialNarration('{"text": "abc\\u00')).toBe('abc');
    // A complete escape decodes normally.
    expect(extractPartialNarration('{"text": "a\\"b')).toBe('a"b');
  });

  it('returns null for a value that never opens', () => {
    expect(extractPartialNarration('{"text": ')).toBeNull();
    expect(extractPartialNarration('{"text": 42')).toBeNull();
  });
});

describe('#875 options never enter the preview', () => {
  it('stops at text with reordered keys and escaped quotes at every chunk boundary', () => {
    const story = 'She says "Welcome" and waits.';
    const raw = JSON.stringify({ options: ['A. Sit'], text: story, scene: { text: 'nested' } });
    for (let i = 0; i <= raw.length; i++) {
      const preview = extractPartialNarration(raw.slice(0, i));
      if (preview !== null) expect(story.startsWith(preview)).toBe(true);
    }
    expect(extractPartialNarration(raw)).toBe(story);
  });
  it('removes an options appendix authored inside text, including a truncated array', () => {
    expect(
      extractPartialNarration(
        JSON.stringify({ text: 'The door opens.\noptions: ["A. Enter", "B.' }),
      ),
    ).toBe('The door opens.');
  });
  it('never prints an in-text options appendix at any chunk boundary', () => {
    const story = 'You shift your grip on the rope and look down into the dark.';
    const raw = JSON.stringify({
      text: story + '\noptions: ["A. Climb down", "B. Call out", "C. Wait"]',
      options: ['A. Climb down'],
      narration_segments: [],
      roll_requests: [],
      combat_transition: 'none',
    });
    for (let i = 0; i <= raw.length; i++) {
      const preview = extractPartialNarration(raw.slice(0, i));
      if (preview !== null) expect(story.startsWith(preview)).toBe(true);
    }
    expect(extractPartialNarration(raw)).toBe(story);
  });
  it('previews the inner narration when the model nested an envelope inside text', () => {
    const story = 'You shift your grip on the rope and look down into the dark.';
    // Inner envelope lists options before text (key order must not matter).
    const inner = JSON.stringify({
      options: ['A. Climb down', 'B. Call out'],
      text: story,
      narration_segments: [],
      roll_requests: [],
      combat_transition: 'none',
    });
    const raw = JSON.stringify({
      text: inner,
      options: [],
      narration_segments: [],
      roll_requests: [],
      combat_transition: 'none',
    });
    for (let i = 0; i <= raw.length; i++) {
      const preview = extractPartialNarration(raw.slice(0, i));
      if (preview !== null) expect(story.startsWith(preview)).toBe(true);
    }
    expect(extractPartialNarration(raw)).toBe(story);
  });
  it('previews the inner narration through two levels of nesting', () => {
    const story = 'You shift your grip on the rope and look down into the dark.';
    const innermost = JSON.stringify({ text: story, options: ['A. Climb down'] });
    const middle = JSON.stringify({ text: innermost, options: [] });
    const raw = JSON.stringify({ text: middle, options: [] });
    for (let i = 0; i <= raw.length; i++) {
      const preview = extractPartialNarration(raw.slice(0, i));
      if (preview !== null) expect(story.startsWith(preview)).toBe(true);
    }
    expect(extractPartialNarration(raw)).toBe(story);
  });
  it('previews the inner narration when the nested envelope is code-fenced', () => {
    const story = 'You shift your grip on the rope and look down into the dark.';
    const inner = JSON.stringify({ text: story, options: ['A. Climb down'] });
    const raw = JSON.stringify({ text: '```json\n' + inner + '\n```', options: [] });
    for (let i = 0; i <= raw.length; i++) {
      const preview = extractPartialNarration(raw.slice(0, i));
      if (preview !== null) expect(story.startsWith(preview)).toBe(true);
    }
    expect(extractPartialNarration(raw)).toBe(story);
  });
  it('previews brace-opening prose as itself once its string completes', () => {
    const prose = '{"weight": 5} is etched into the stone above the door.';
    const raw = JSON.stringify({ text: prose, options: [] });
    for (let i = 0; i <= raw.length; i++) {
      const preview = extractPartialNarration(raw.slice(0, i));
      if (preview !== null) expect(prose.startsWith(preview)).toBe(true);
    }
    expect(extractPartialNarration(raw)).toBe(prose);
  });
});

/**
 * #1067 follow-up: bracket lines (and the other artifact shapes) must never
 * be visible WHILE STREAMING, even though the final text removes them
 * (Hark DM #4/#127). The server only emits a delta when the new preview
 * starts with what was already emitted, so the preview normalizer holds
 * back a trailing shape that is still arriving instead of removing text
 * that was already shown — removing shown text would stall the stream.
 * This block replays llm.ts's onToken emission rule over every chunk
 * boundary and asserts the artifact substrings never appear in the
 * emitted stream.
 */
describe('#1067 follow-up: the stream is normalized too', () => {
  // The exact emission rule from llm.ts's onToken.
  const simulateStream = (raw: string): string => {
    let emitted = '';
    for (let i = 0; i <= raw.length; i++) {
      const preview = extractPartialNarration(raw.slice(0, i));
      if (preview !== null && preview.length > emitted.length && preview.startsWith(emitted)) {
        emitted = preview;
      }
    }
    return emitted;
  };

  it('never emits a bracket tracker line at any chunk boundary', () => {
    const story = 'The sun breaks over the garden wall.';
    const raw = JSON.stringify({
      text: story + ' [HP 18/?] [Clock 0/6] [Scene: The Sunlit Garden]',
      options: [],
    });
    const emitted = simulateStream(raw);
    expect(emitted.includes('[HP')).toBe(false);
    expect(emitted.includes('[Clock')).toBe(false);
    expect(emitted.includes('[Scene')).toBe(false);
    expect(story.startsWith(emitted.trimEnd())).toBe(true);
  });

  it('a mid-text bracket run converges to the final text once prose follows it', () => {
    // Boundary of the fix, documented deliberately: the final strip is
    // trailing-only (#1081), so a run that prose follows is KEPT by the
    // final text — and the preview must converge to the final text, not
    // hide the run forever. Only trailing runs (which the final text
    // removes) are held while streaming; a mid-text run is emitted once
    // the prose after it proves it is not trailing.
    const story = 'The sun breaks over the garden wall.';
    const raw = JSON.stringify({
      text: story + ' [HP 18/?] [Clock 0/6] The garden wakes.',
      options: [],
    });
    const emitted = simulateStream(raw);
    expect(emitted.includes('[HP 18/?] [Clock 0/6]')).toBe(true);
    expect(emitted.includes('The garden wakes.')).toBe(true);
    // ...but while the run is still trailing (no prose yet), it is held.
    const trailingRaw = JSON.stringify({
      text: story + ' [HP 18/?] [Clock 0/6]',
      options: [],
    });
    expect(simulateStream(trailingRaw).includes('[HP')).toBe(false);
  });

  it('never emits an inline lettered list, and releases a lone A. item once prose follows', () => {
    const story = 'The hollow yawns before you, dark and cold.';
    const raw = JSON.stringify({
      text: story + ' A. Race for the hollow. B. Hide among the roots. The wind answers nothing.',
      options: [],
    });
    const emitted = simulateStream(raw);
    expect(emitted.includes('A. Race')).toBe(false);
    expect(emitted.includes('B. Hide')).toBe(false);
    expect(emitted.includes('The wind answers nothing.')).toBe(true);
    const lone = JSON.stringify({
      text: story + ' A. Race for the hollow. The wind answers nothing.',
      options: [],
    });
    const loneEmitted = simulateStream(lone);
    expect(loneEmitted.includes('A. Race for the hollow.')).toBe(true);
    expect(loneEmitted.includes('The wind answers nothing.')).toBe(true);
  });

  it('never emits the meta sentence, including its partial prefixes', () => {
    const story = 'The prince studies you, waiting for an answer.';
    const raw = JSON.stringify({
      text:
        story + ' Options are not shown here; choose your next move. The room holds its breath.',
      options: [],
    });
    const emitted = simulateStream(raw);
    expect(emitted.includes('Options are not shown here')).toBe(false);
    expect(emitted.includes('choose your next move')).toBe(false);
    expect(emitted.includes('The room holds its breath.')).toBe(true);
  });

  it('#1067 V-008: never emits the long trailing tracker run (Scene group with commas)', () => {
    const story = 'The king smiles and says nothing more.';
    const raw = JSON.stringify({
      text:
        story +
        ' [HP 100/100] [Clock 6/6] [Contentment 0] [Spare Wish: unused] ' +
        "[Prince's tricks left: 2] [Scene: the Palace of the Contented King, the throne room, sunset]",
      options: [],
    });
    const emitted = simulateStream(raw);
    expect(emitted.includes('[')).toBe(false);
    expect(emitted.includes('Contented King')).toBe(false);
    expect(story.startsWith(emitted.trimEnd())).toBe(true);
  });

  it('#1067 V-009: never emits the player-input meta sentence, and converges when prose follows', () => {
    const story = 'The king smiles and says nothing more.';
    const raw = JSON.stringify({
      text: story + ' Player input is required on what you do next.',
      options: [],
    });
    const emitted = simulateStream(raw);
    expect(emitted.includes('Player input')).toBe(false);
    expect(story.startsWith(emitted.trimEnd())).toBe(true);
    const followed = JSON.stringify({
      text: story + ' Player input is required on what you do next. The court waits.',
      options: [],
    });
    const followedEmitted = simulateStream(followed);
    expect(followedEmitted.includes('Player input')).toBe(false);
    expect(followedEmitted.includes('The court waits.')).toBe(true);
  });

  it('never emits a tool-parameter block, including its partial argument tail', () => {
    const story = 'Granny leans in close, her voice dropping to a whisper.';
    const raw = JSON.stringify({
      text:
        story +
        '<parameter name="options">["Give the password", "Refuse"]</parameter> The room holds its breath.',
      options: [],
    });
    const emitted = simulateStream(raw);
    expect(emitted.includes('<parameter')).toBe(false);
    expect(emitted.includes('Give the password')).toBe(false);
    expect(emitted.includes('The room holds its breath.')).toBe(true);
  });

  it('releases a lone bracket aside once prose follows it', () => {
    const story = 'The scribe copies the line faithfully.';
    const raw = JSON.stringify({
      text: story + ' [sic] And moves on.',
      options: [],
    });
    const emitted = simulateStream(raw);
    expect(emitted.includes('[sic]')).toBe(true);
    expect(emitted.includes('And moves on.')).toBe(true);
  });

  it('holds a lone bracket aside at the very end (done delivers it)', () => {
    const raw = JSON.stringify({ text: 'The scribe copies the line. [sic]', options: [] });
    expect(extractPartialNarration(raw)).toBe('The scribe copies the line.');
  });

  // Self-review FIX round: the first version of the preview normalizer
  // stalled the stream permanently in four places. These tests pin the
  // fixes by asserting exact convergence (emitted stream == final
  // normalized text) for each shape, not just artifact absence.
  const finalText = (text: string): string => {
    const envelope: Record<string, unknown> = { text, options: [] };
    normalizeReplyNarration(envelope);
    return envelope.text as string;
  };

  it('the "The options ..." meta variant streams the following sentence (self-review Required 1)', () => {
    const text =
      'The prince studies you. The options are not shown here; choose your next move. The room holds its breath.';
    const emitted = simulateStream(JSON.stringify({ text, options: [] }));
    expect(emitted.includes('The options are not shown here')).toBe(false);
    expect(emitted).toBe(finalText(text));
    const arent =
      "The prince studies you. The options aren't shown here. The room holds its breath.";
    expect(simulateStream(JSON.stringify({ text: arent, options: [] }))).toBe(finalText(arent));
  });

  it('an A/B/C list converges exactly, including the bare-C boundary (self-review Required 2)', () => {
    const text =
      'The hollow yawns. A. Race for the hollow. B. Hide among the roots. C. Call out. The wind answers nothing.';
    const emitted = simulateStream(JSON.stringify({ text, options: [] }));
    expect(emitted).toBe(finalText(text));
    expect(emitted).toBe('The hollow yawns. The wind answers nothing.');
  });

  it('a dangling tag with a complete argument plus prose streams the prose (self-review Required 3)', () => {
    const text =
      'Story here. <parameter name="options">["Give the password", "Refuse"] The room holds its breath. More story follows here.';
    const emitted = simulateStream(JSON.stringify({ text, options: [] }));
    expect(emitted).toBe(finalText(text));
    expect(emitted.includes('The room holds its breath.')).toBe(true);
  });

  it('an unterminated bracket releases once it breaks tracker shape (self-review Required 4)', () => {
    const text = 'Story here. [to himself, walking on and on through the dark forest road.';
    const emitted = simulateStream(JSON.stringify({ text, options: [] }));
    expect(emitted).toBe(finalText(text));
    expect(emitted.includes('walking on and on')).toBe(true);
    // ...but a tracker-plausible prefix is still held.
    const held = simulateStream(JSON.stringify({ text: 'Story here. [HP 18/?', options: [] }));
    expect(held.includes('[HP')).toBe(false);
  });
});
