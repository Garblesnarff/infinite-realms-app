import { describe, expect, it } from 'vitest';

import { extractVisualPrompt } from '../visualPrompt';

describe('extractVisualPrompt', () => {
  it('returns original text when no prompt is present', () => {
    const sample = 'A simple response without visual hints.';
    const { cleaned, prompt } = extractVisualPrompt(sample);
    expect(cleaned).toBe(sample);
    expect(prompt).toBeNull();
  });

  it('pulls prompt from fenced block and removes it from text', () => {
    const sample = `Scene description leading to image.\n\n\`\`\`VISUAL_PROMPT\nStormy sky above ruined citadel with glowing runes\n\`\`\``;
    const { cleaned, prompt } = extractVisualPrompt(sample);
    expect(cleaned).toBe('Scene description leading to image.');
    expect(prompt).toBe('Stormy sky above ruined citadel with glowing runes');
  });

  it('supports legacy inline marker', () => {
    const sample = 'Narrative text here.\nVISUAL PROMPT: Moonlit forest with ancient stones';
    const { cleaned, prompt } = extractVisualPrompt(sample);
    expect(cleaned).toBe('Narrative text here.');
    expect(prompt).toBe('Moonlit forest with ancient stones');
  });

  it('handles multiple prompts by keeping first and stripping all markers', () => {
    const sample = `Intro.\nVISUAL PROMPT: First prompt\n\n\`\`\`VISUAL_PROMPT\nSecond prompt\n\`\`\``;
    const { cleaned, prompt } = extractVisualPrompt(sample);
    expect(cleaned).toBe('Intro.');
    expect(prompt).toBe('First prompt');
  });

  it('normalizes excessive blank lines after removal', () => {
    const sample = `Line one.\n\n\nVISUAL PROMPT: Something\n\nLine two.`;
    const { cleaned } = extractVisualPrompt(sample);
    expect(cleaned).toBe('Line one.\n\nLine two.');
  });

  it('handles empty or null input', () => {
    expect(extractVisualPrompt('')).toEqual({ cleaned: '', prompt: null });
    expect(extractVisualPrompt(null)).toEqual({ cleaned: '', prompt: null });
    expect(extractVisualPrompt(undefined)).toEqual({ cleaned: '', prompt: null });
  });

  it('handles text that is only a prompt', () => {
    const sample = '```VISUAL_PROMPT\nA lonely mountain\n```';
    const { cleaned, prompt } = extractVisualPrompt(sample);
    expect(cleaned).toBe('');
    expect(prompt).toBe('A lonely mountain');
  });

  it('supports mixed case and varied delimiters in markers', () => {
    const samples = [
      'vIsUaL pRoMpT: Mixed case',
      'VISUAL-PROMPT: Hyphen',
      'VISUAL_PROMPT: Underscore',
      '``` VISUAL  PROMPT\nFenced mixed\n```',
    ];

    samples.forEach((sample) => {
      const { prompt } = extractVisualPrompt(sample);
      expect(prompt).toBeTruthy();
    });
  });

  it('handles malformed markers (unclosed fence)', () => {
    const sample = '```VISUAL_PROMPT\nThis fence never ends';
    const { cleaned, prompt } = extractVisualPrompt(sample);
    // If fence is not closed, it shouldn't match the fence regex
    // But it should be caught by the safety net line-based regex for the marker
    expect(prompt).toBeNull();
    expect(cleaned).toBe('This fence never ends');
  });

  it('handles inline prompt without colon', () => {
    const sample = 'Narrative\nVISUAL PROMPT A prompt without colon';
    const { cleaned, prompt } = extractVisualPrompt(sample);
    expect(cleaned).toBe('Narrative');
    expect(prompt).toBe('A prompt without colon');
  });

  it('strips all markers even if multiple different types exist', () => {
    const sample = `Text\nVISUAL PROMPT: p1\n\`\`\`VISUAL_PROMPT\np2\n\`\`\`\nMore text\nVISUAL_PROMPT: p3`;
    const { cleaned, prompt } = extractVisualPrompt(sample);
    expect(prompt).toBe('p1');
    expect(cleaned).toBe('Text\n\nMore text');
  });

  it('correctly picks the first prompt when both inline and fenced exist', () => {
    // Fenced comes first
    const s1 = '```VISUAL_PROMPT\np1\n```\nVISUAL PROMPT: p2';
    expect(extractVisualPrompt(s1).prompt).toBe('p1');

    // Inline comes first
    const s2 = 'VISUAL PROMPT: p1\n```VISUAL_PROMPT\np2\n```';
    expect(extractVisualPrompt(s2).prompt).toBe('p1');
  });
});
