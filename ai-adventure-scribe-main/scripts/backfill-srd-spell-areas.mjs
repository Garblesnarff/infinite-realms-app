#!/usr/bin/env node
/**
 * One-time, deliberately conservative metadata backfill for the bundled SRD
 * catalog. It examines every spell, writes only high-confidence matches, and
 * prints ambiguous candidates for human review.
 *
 * Run: node scripts/backfill-srd-spell-areas.mjs --write
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const spellsPath = fileURLToPath(new URL('../src/data/srd/spells.json', import.meta.url));
const write = process.argv.includes('--write');

const phrase = (spell) => `${spell.description || ''}\n${spell.higher_level_text || ''}`.toLowerCase();

function parseArea(text) {
  const explicit = text.match(/\b(\d+)-foot(?:-radius)?\s+(sphere|cone|cube|line)\b/);
  if (explicit) return { shape: explicit[2], size_feet: Number(explicit[1]), confidence: 'high' };

  const line = text.match(/\bline(?: that is)?\s+\d+\s+feet wide and\s+(\d+)\s+feet long\b/);
  if (line) return { shape: 'line', size_feet: Number(line[1]), confidence: 'high' };

  const lineFirst = text.match(/\bline\b[^.]{0,40}?\b(\d+)\s+feet long and\s+\d+\s+feet wide\b/);
  if (lineFirst) return { shape: 'line', size_feet: Number(lineFirst[1]), confidence: 'high' };

  const radius = text.match(/\b(sphere|cube)\s+(?:with )?(?:a )?radius of\s+(\d+)\s+feet\b/);
  if (radius) return { shape: radius[1], size_feet: Number(radius[2]), confidence: 'low' };
  return null;
}

function parseForcedMove(text) {
  const match = text.match(/\b(?:is |are )?(?:pushed|pulled)\s+(\d+)\s+feet\s+(away from|toward)\b/)
    || text.match(/\bpush(?:es)?\s+(?:the target |a creature )?(\d+)\s+feet\s+(away from|toward)\b/);
  if (!match) return null;
  return {
    distance_feet: Number(match[1]),
    direction: match[2].startsWith('away') ? 'away' : 'toward',
    confidence: 'high',
  };
}

const spells = JSON.parse(await readFile(spellsPath, 'utf8'));
const review = [];
let areas = 0;
let forcedMoves = 0;
for (const spell of spells) {
  const text = phrase(spell);
  const area = parseArea(text);
  const forcedMove = parseForcedMove(text);
  if (area) {
    spell.area_of_effect = { shape: area.shape, size_feet: area.size_feet };
    areas++;
    if (area.confidence !== 'high') review.push(`${spell.id}: ${area.confidence}-confidence area parse`);
  } else {
    delete spell.area_of_effect;
    if (/\b(?:sphere|cone|cube|line|radius)\b/.test(text))
      review.push(`${spell.id}: possible area wording was not parsed`);
  }
  if (forcedMove) {
    spell.forced_move = {
      distance_feet: forcedMove.distance_feet,
      direction: forcedMove.direction,
    };
    forcedMoves++;
  } else {
    delete spell.forced_move;
    if (/\b(?:push(?:ed|es)?|pull(?:ed|s)?)\b/.test(text))
      review.push(`${spell.id}: possible forced movement was not parsed`);
  }
}

const thunderwave = spells.find((spell) => spell.id === 'thunderwave');
if (
  thunderwave?.area_of_effect?.shape !== 'cube' ||
  thunderwave.area_of_effect.size_feet !== 15 ||
  thunderwave.forced_move?.distance_feet !== 10 ||
  thunderwave.forced_move.direction !== 'away'
) {
  throw new Error('Thunderwave backfill assertion failed');
}

if (write) await writeFile(spellsPath, `${JSON.stringify(spells, null, 2)}\n`);
console.log(`Processed ${spells.length} SRD spells: ${areas} areas, ${forcedMoves} forced moves.`);
if (review.length) {
  console.log(`Human review (${review.length}):`);
  for (const item of review) console.log(`- ${item}`);
}
if (!write) console.log('Dry run only. Re-run with --write to update spells.json.');
