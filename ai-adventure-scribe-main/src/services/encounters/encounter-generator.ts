import { generateSocialEncounter, generateExplorationEncounter } from './social-templates';
import { loadMonsters } from './srd-loader';
import { getDifficultyAdjustment } from './telemetry';
import { encounterXpPerCharacter } from '../../../shared/xp-tables';

import type {
  EncounterGenerationInput,
  EncounterSpec,
  Difficulty,
  MonsterDef,
} from '@/types/encounters';

// Minimal SRD-like sample to keep file small; real dataset should be loaded from data files.
const SAMPLE_MONSTERS: MonsterDef[] = [
  { id: 'srd:goblin', name: 'Goblin', cr: 0.25, xp: 50, tags: ['forest', 'caves'] },
  { id: 'srd:wolf', name: 'Wolf', cr: 0.25, xp: 50, tags: ['forest', 'plains'] },
  { id: 'srd:orc', name: 'Orc', cr: 0.5, xp: 100, tags: ['hills', 'forest'] },
  { id: 'srd:bandit', name: 'Bandit', cr: 0.125, xp: 25, tags: ['road'] },
];

const MULTIPLIERS = [
  { count: 1, mult: 1 },
  { count: 2, mult: 1.5 },
  { count: 3, mult: 2 },
  { count: 4, mult: 2 },
  { count: 5, mult: 2 },
  { count: 6, mult: 2 },
];

function partyAverages(levels: number[]) {
  const size = levels.length || 1;
  const avg = Math.max(1, Math.round(levels.reduce((a, b) => a + b, 0) / size));
  return { size, avgLevel: avg };
}

function difficultyBudget(size: number, avgLevel: number, diff: Difficulty): number {
  return encounterXpPerCharacter(avgLevel, diff) * size;
}

function effectiveXp(xpPerMonster: number, count: number): number {
  const mult = MULTIPLIERS.find((m) => count <= m.count)?.mult || 2.5;
  return xpPerMonster * count * mult;
}

function pickMonstersForBudget(
  budget: number,
  biome?: string,
): { id: string; count: number; xpEach: number }[] {
  const tagged = biome ? SAMPLE_MONSTERS.filter((m) => m.tags?.includes(biome)) : SAMPLE_MONSTERS;
  const srd = loadMonsters();
  const catalog = srd.length ? srd : SAMPLE_MONSTERS;
  const pool = tagged.length > 0 ? tagged : catalog;
  const sorted = [...pool].sort((a, b) => a.xp - b.xp);
  // Greedy fill with lowest XP creatures to meet budget within ~±10%
  const result: { id: string; count: number; xpEach: number }[] = [];
  let remaining = budget;
  const tolerance = Math.max(25, budget * 0.1);

  for (let i = 0; i < 100 && remaining > 0; i++) {
    // pick the best that doesn't overshoot too much
    const choice = sorted.find((m) => effectiveXp(m.xp, 1) <= remaining + tolerance) || sorted[0];
    const count = Math.max(1, Math.round(remaining / (choice.xp * 1.5)));
    result.push({ id: choice.id, count, xpEach: choice.xp });
    remaining -= effectiveXp(choice.xp, count);
    if (Math.abs(remaining) <= tolerance) break;
    if (i > 20 && remaining < 0) break;
  }
  return result;
}

export class EncounterGenerator {
  generate(input: EncounterGenerationInput): EncounterSpec {
    if (input.type === 'social') return generateSocialEncounter(input);
    if (input.type === 'exploration') return generateExplorationEncounter(input);
    const levels = input.party.members.map((m) => m.level);
    const { size, avgLevel } = partyAverages(levels);
    const difficulty = input.requestedDifficulty ?? 'medium';
    let xpBudget = difficultyBudget(size, avgLevel, difficulty);
    const sessionId = input.sessionId;
    if (sessionId) {
      const adjust = getDifficultyAdjustment(sessionId, difficulty);
      xpBudget = Math.round(xpBudget * adjust);
    }

    const picks = pickMonstersForBudget(xpBudget, input.world.biome);
    const hostiles = picks.map((p) => ({ ref: p.id, count: Math.max(1, p.count) }));

    const type = input.type ?? 'combat';
    const spec: EncounterSpec = {
      type,
      difficulty,
      xpBudget,
      participants: { hostiles, friendlies: [] },
      terrain: { biome: input.world.biome, features: ['light cover'] },
      objectives: type === 'combat' ? ['defeat or drive off hostiles'] : ['progress scene'],
      startState: { initiative: 'roll', surprise: false },
      lootHooks: ['treasure:roll:hoard-A'],
      followUps: [],
    };

    return spec;
  }
}

export default new EncounterGenerator();
