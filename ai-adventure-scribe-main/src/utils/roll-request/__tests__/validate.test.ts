import { describe, expect, it } from 'vitest';

import {
  findLastSentenceBoundary,
  truncateAtRollRequest,
  containsRollRequest,
  detectsSuccessfulAttack,
  detectsCriticalHit,
  extractPrimaryRollRequest,
  removeRollRequestsFromMessage,
} from '../validate';

const ROLL_BLOCK =
  '```ROLL_REQUESTS_V1\n{"rolls":[{"type":"check","formula":"1d20+3","purpose":"Perception","dc":14}]}\n```';

describe('validate helpers', () => {
  it('containsRollRequest returns true when requests are present', () => {
    expect(containsRollRequest('Roll for Stealth')).toBe(true);
    expect(containsRollRequest('The weather is nice')).toBe(false);
  });

  it('detectsSuccessfulAttack identifies hit keywords', () => {
    expect(detectsSuccessfulAttack('That hits!')).toBe(true);
    expect(detectsSuccessfulAttack('You hit the orc')).toBe(true);
    expect(detectsSuccessfulAttack('A natural 20!')).toBe(true);
    expect(detectsSuccessfulAttack('Your sword strikes true')).toBe(true);
    expect(detectsSuccessfulAttack('You miss miserably')).toBe(false);
  });

  it('detectsCriticalHit identifies crit keywords', () => {
    expect(detectsCriticalHit('Critical hit!')).toBe(true);
    expect(detectsCriticalHit('Nat 20')).toBe(true);
    expect(detectsCriticalHit('It is a crit')).toBe(true);
    expect(detectsCriticalHit('Regular hit')).toBe(false);
  });

  it('extractPrimaryRollRequest gets the first request', () => {
    const msg = 'Roll initiative! Also make a Perception check.';
    const rr = extractPrimaryRollRequest(msg);
    expect(rr).toBeTruthy();
    expect(rr!.type).toBe('initiative');
  });

  it('extractPrimaryRollRequest returns null if no requests', () => {
    expect(extractPrimaryRollRequest('Just text')).toBe(null);
  });
});

describe('removeRollRequestsFromMessage', () => {
  it('removes roll block and metadata', () => {
    const msg = [
      'Narrative text.',
      '',
      ROLL_BLOCK,
      '',
      '**VISUAL PROMPT:** An orc.',
      '---',
      'Footer text'
    ].join('\n');
    const cleaned = removeRollRequestsFromMessage(msg);
    expect(cleaned).toContain('Narrative text.');
    expect(cleaned).not.toContain('ROLL_REQUESTS_V1');
    expect(cleaned).not.toContain('VISUAL PROMPT');
    expect(cleaned).not.toContain('---');
  });

  it('strips A/B/C options', () => {
    const msg = 'Decide:\nA. Attack\nB. Run';
    const cleaned = removeRollRequestsFromMessage(msg);
    expect(cleaned).toBe('Decide:');
  });

  it('strips bold markers', () => {
    const msg = 'The **big** bad wolf';
    const cleaned = removeRollRequestsFromMessage(msg);
    expect(cleaned).toBe('The big bad wolf');
  });

  it('handles empty or null message', () => {
    expect(removeRollRequestsFromMessage('')).toBe('');
    expect(removeRollRequestsFromMessage(null as any)).toBe(null as any);
  });
});

// ---------------------------------------------------------------------------
// findLastSentenceBoundary
// ---------------------------------------------------------------------------

describe('findLastSentenceBoundary', () => {
  it('finds the index of the terminal period in a single sentence', () => {
    const text = 'The goblin snarls at you.';
    expect(findLastSentenceBoundary(text)).toBe(24);
  });

  it('finds the LAST boundary when multiple sentences are present', () => {
    const text = 'First sentence. Second sentence!';
    expect(findLastSentenceBoundary(text)).toBe(31);
  });

  it('returns -1 when no sentence-ending punctuation exists', () => {
    expect(findLastSentenceBoundary('No boundary here at all')).toBe(-1);
  });

  it('does NOT count an em-dash as a sentence boundary', () => {
    expect(findLastSentenceBoundary('Your sword connects and—')).toBe(-1);
  });

  it('counts ? as a valid sentence terminator', () => {
    const text = 'What do you do?';
    expect(findLastSentenceBoundary(text)).toBe(14);
  });

  it('counts ! as a valid sentence terminator', () => {
    const text = 'The dragon roars! Run!';
    expect(findLastSentenceBoundary(text)).toBe(21);
  });
});

// ---------------------------------------------------------------------------
// truncateAtRollRequest
// ---------------------------------------------------------------------------

describe('truncateAtRollRequest', () => {
  it('removes an outcome narrated before the roll request', () => {
    const message = `You swing at the goblin. Your blade cuts deep into its shoulder!\n${ROLL_BLOCK}`;
    expect(truncateAtRollRequest(message)).toBe('You swing at the goblin.');
  });
  it('returns message unchanged when no roll block is present', () => {
    const msg = 'The forest is quiet. You hear nothing.';
    expect(truncateAtRollRequest(msg)).toBe(msg);
  });

  it('returns empty string when given empty string', () => {
    expect(truncateAtRollRequest('')).toBe('');
  });

  it('returns empty string when only a roll block is present with no preceding text', () => {
    expect(truncateAtRollRequest(ROLL_BLOCK)).toBe('');
  });

  it('preserves clean sentence boundary — no trimming needed', () => {
    const msg = `You step into the chamber. The air is thick with dust.\n\n${ROLL_BLOCK}`;
    expect(truncateAtRollRequest(msg)).toBe(
      'You step into the chamber. The air is thick with dust.',
    );
  });

  it('clips a mid-sentence fragment ending with an em-dash', () => {
    const msg = `You swing your blade at the orc. Your sword connects and—\n\n${ROLL_BLOCK}`;
    const result = truncateAtRollRequest(msg);
    expect(result).toBe('You swing your blade at the orc.');
    expect(result).not.toContain('connects and');
  });

  it('clips a mid-sentence fragment ending with a trailing comma', () => {
    const msg = `The wizard gestures. A bolt of lightning forms,\n\n${ROLL_BLOCK}`;
    const result = truncateAtRollRequest(msg);
    expect(result).toBe('The wizard gestures.');
    expect(result).not.toContain('lightning forms');
  });

  it('preserves multi-paragraph narrative with paragraph breaks intact', () => {
    const para1 = 'The inn is crowded tonight.';
    const para2 = 'A hooded figure sits in the corner.';
    const msg = `${para1}\n\n${para2}\n\n${ROLL_BLOCK}`;
    const result = truncateAtRollRequest(msg);
    expect(result).toContain(para1);
    expect(result).toContain(para2);
    expect(result).toMatch(/\n\n/);
  });

  it('collapses soft-wrap newlines within a single paragraph', () => {
    const msg = `The door is locked.\nYou hear footsteps.\n\n${ROLL_BLOCK}`;
    const result = truncateAtRollRequest(msg);
    expect(result).toBe('The door is locked. You hear footsteps.');
  });

  it('falls back gracefully when no sentence boundary found in pre-roll text', () => {
    const msg = `No punctuation here at all\n\n${ROLL_BLOCK}`;
    expect(truncateAtRollRequest(msg)).toBe('No punctuation here at all');
  });

  it('handles mixed content: narrative + roll block + options + visual prompt', () => {
    const fullResponse = [
      'The ancient door creaks open.',
      'You see a chamber filled with glowing runes.',
      '',
      ROLL_BLOCK,
      '',
      'A. **Examine the altar**, search for hidden mechanisms.',
      'B. **Pocket the gemstone**, take it for yourself.',
      '',
      '---',
      '',
      'VISUAL PROMPT: Dusty stone chamber with a glowing altar',
    ].join('\n');

    const result = truncateAtRollRequest(fullResponse);

    expect(result).toContain('The ancient door creaks open.');
    expect(result).toContain('You see a chamber filled with glowing runes.');
    expect(result).not.toContain('ROLL_REQUESTS_V1');
    expect(result).not.toContain('Examine the altar');
    expect(result).not.toContain('VISUAL PROMPT');
    expect(result).not.toContain('---');
    expect(result).toMatch(/[.!?]$/);
  });

  it('does not modify message when the pre-roll text already ends cleanly at a period', () => {
    const msg = `Ready your blade.\n\n${ROLL_BLOCK}`;
    expect(truncateAtRollRequest(msg)).toBe('Ready your blade.');
  });

  it('handles exclamation point as a valid terminal boundary', () => {
    const msg = `Combat begins! Your heart races and—\n\n${ROLL_BLOCK}`;
    expect(truncateAtRollRequest(msg)).toBe('Combat begins!');
  });

  it('handles roll block immediately adjacent to narrative (no blank line separator)', () => {
    const msg = `You step forward carefully.\n${ROLL_BLOCK}`;
    const result = truncateAtRollRequest(msg);
    expect(result).toBe('You step forward carefully.');
    expect(result).not.toContain('ROLL_REQUESTS_V1');
  });

  it('excludes A/B/C options that appear after the roll block', () => {
    const msg = [
      'The chamber is silent.',
      '',
      ROLL_BLOCK,
      '',
      'A. **Examine the altar**, look for traps.',
      'B. **Retreat**, back to the corridor.',
    ].join('\n');
    const result = truncateAtRollRequest(msg);
    expect(result).toBe('The chamber is silent.');
    expect(result).not.toContain('Examine the altar');
    expect(result).not.toContain('Retreat');
  });

  it('finds the last sentence boundary when narrative contains abbreviation-like periods mid-text', () => {
    // findLastSentenceBoundary returns the LAST match, so "Dr." mid-sentence is not the final cut
    const msg = `You meet Dr. Whisper at the inn. She greets you warmly.\n\n${ROLL_BLOCK}`;
    const result = truncateAtRollRequest(msg);
    expect(result).toBe('You meet Dr. Whisper at the inn. She greets you warmly.');
  });
});
