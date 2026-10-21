import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { test } from 'bun:test';

import { parseOverview } from './parser.js';

// Fixture overviews live in __fixtures__/, read the same way as chunker.test.ts.
const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');

test('one-shot overview: the Estimated Length line parses as a single session (#829)', () => {
  // The fixture carries the exact line from #829 finding 6:
  // "**Estimated Length:** One-shot — 1 session (2–4 hours)".
  // Before the fix this parsed as "2-4" — the hours range leaked into
  // estimatedSessions and the detail page rendered it as "2-4 sessions".
  const campaign = parseOverview(fixture('one-shot-overview.md'), 'Completed/Horror/twelve-bells');
  assert.deepEqual(campaign, {
    id: 'twelve-bells',
    slug: 'twelve-bells',
    title: 'Twelve Bells',
    genre: ['mystery', 'gothic horror'],
    tone: ['tense', 'mournful'],
    difficulty: 'medium',
    levelRange: '3-3',
    estimatedSessions: '1',
    premise:
      'The abbey bell has rung twelve times for a thirteenth year running, and every villager who hears the final toll forgets one name. The party has until midnight to climb the bell tower, face the keeper who collects the names, and decide which single memory the village can afford to lose.',
  });
});

test('the exact one-shot line on its own parses as "1"', () => {
  const campaign = parseOverview(
    '# Twelve Bells\n\n**Estimated Length:** One-shot — 1 session (2–4 hours)\n',
    'twelve-bells',
  );
  assert.equal(campaign.estimatedSessions, '1');
});

test('a bare "1 session" length parses as "1"', () => {
  const campaign = parseOverview('# X\n\n**Estimated Length:** 1 session\n', 'x');
  assert.equal(campaign.estimatedSessions, '1');
});

test('the fallback does not turn an hours range into sessions', () => {
  assert.equal(
    parseOverview('# Z\n\nEstimated Length: 2-4 hours\n', 'z').estimatedSessions,
    undefined,
  );
  assert.equal(
    parseOverview('# Z\n\n**Estimated Length:** 2–4 hours\n', 'z').estimatedSessions,
    undefined,
  );
  // Two-digit bounds: without the \b after the capture group, the trailing
  // \d+ backtracks a digit and the hours lookahead passes mid-number,
  // yielding "10-1" / "3-1" (#829 round 2).
  assert.equal(
    parseOverview('# Z\n\nEstimated Length: 10-12 hours\n', 'z').estimatedSessions,
    undefined,
  );
  assert.equal(
    parseOverview('# Z\n\nEstimated Length: 3-10 hours\n', 'z').estimatedSessions,
    undefined,
  );
});

test('the fallback still reads a bare session range with no unit', () => {
  assert.equal(
    parseOverview('# Y\n\nEstimated Length: 6-10\n', 'y').estimatedSessions,
    '6-10',
  );
});

test('full-campaign overview parses exactly as before (pin)', () => {
  const campaign = parseOverview(
    fixture('full-campaign-overview.md'),
    'Completed/Fantasy/the-sunken-meridian',
  );
  assert.deepEqual(campaign, {
    id: 'the-sunken-meridian',
    slug: 'the-sunken-meridian',
    title: 'The Sunken Meridian',
    genre: ['exploration', 'seafaring fantasy'],
    tone: ['wondrous', 'perilous', 'hopeful'],
    difficulty: 'hard',
    levelRange: '1-8',
    estimatedSessions: '8-12',
    premise:
      'A drowned meridian line of ley power has resurfaced off the coast, and every chart in the admiralty is suddenly wrong. The party sails the shifting straits aboard a borrowed brig, racing a cartographers\' guild that would sell the new map to the highest bidder, while the sea itself keeps redrawing the route home.',
  });
});

test('a range followed by the singular "session" still parses as the full range', () => {
  // The bare-count branch must not capture the tail of a range in this
  // shape ("12" from "8-12 session") and shadow the fallback (#829 round 3).
  assert.equal(
    parseOverview('# W\n\nEstimated Length: 8-12 session campaign\n', 'w').estimatedSessions,
    '8-12',
  );
  assert.equal(
    parseOverview('# W\n\n**Estimated Length:** 8–12 session adventure\n', 'w').estimatedSessions,
    '8-12',
  );
  assert.equal(
    parseOverview('# W\n\n**Estimated Length:** 3-5 session adventure\n', 'w').estimatedSessions,
    '3-5',
  );
});

test('an en-dash session range normalizes to a hyphen range', () => {
  assert.equal(
    parseOverview('# W\n\n**Estimated Length:** 8–12 sessions\n', 'w').estimatedSessions,
    '8-12',
  );
});
