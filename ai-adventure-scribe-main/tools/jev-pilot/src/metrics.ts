import { calculateImportance, importanceToFive } from './importance-baseline';
import { noulDecision, scoreToFive } from './questions';

import type { DecisionAnswer } from './decisions-types';
import type { ImportanceFixture, MemoryCandidate, NarrationFixture } from './fixtures';
import type { NarrationQuestionId } from './questions';

export type RuleScore = {
  labeledTrue: number;
  caught: number;
  labeledFalse: number;
  falseFlags: number;
  abstain: number;
};

export function emptyRuleScore(): RuleScore {
  return { labeledTrue: 0, caught: 0, labeledFalse: 0, falseFlags: 0, abstain: 0 };
}

export function addNoul(score: RuleScore, label: boolean, probability: number): void {
  const decision = noulDecision(probability);
  if (decision === null) {
    score.abstain += 1;
    if (label) {
      score.labeledTrue += 1;
    } else {
      score.labeledFalse += 1;
    }
    return;
  }
  if (label) {
    score.labeledTrue += 1;
    if (decision) {
      score.caught += 1;
    }
  } else {
    score.labeledFalse += 1;
    if (decision) {
      score.falseFlags += 1;
    }
  }
}

export function catchRate(score: RuleScore): number | null {
  if (score.labeledTrue === 0) {
    return null;
  }
  return score.caught / score.labeledTrue;
}

export function falseFlagsPer20Clean(score: RuleScore): number | null {
  if (score.labeledFalse === 0) {
    return null;
  }
  return (score.falseFlags / score.labeledFalse) * 20;
}

export function recallAt5(rankedIds: string[], relevantIds: string[]): number {
  if (relevantIds.length === 0) {
    return 1;
  }
  const top = new Set(rankedIds.slice(0, 5));
  const hits = relevantIds.filter((id) => top.has(id)).length;
  return hits / relevantIds.length;
}

/**
 * Live `loadTopMemories` orders by the stored importance column, then `created_at`
 * descending (`server-bun/src/services/memory-service.ts`). Quote fixtures have neither,
 * so those rows fall back to `calculateImportance` and keep their listed order on ties.
 */
export function rankByImportance(candidates: MemoryCandidate[]): string[] {
  return candidates
    .map((candidate, index) => ({
      id: candidate.id,
      index,
      score:
        typeof candidate.storedImportance === 'number'
          ? candidate.storedImportance
          : calculateImportance({
              content: candidate.text,
              type: candidate.type,
              category: candidate.category,
            }),
      createdAt: candidate.createdAt ?? '',
    }))
    .sort(
      (a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt) || a.index - b.index,
    )
    .map((row) => row.id);
}

export function narrationState(fixture: NarrationFixture): Record<string, unknown> {
  const turn = fixture.engine.currentTurn;
  return {
    narration: fixture.narration,
    player_declared: fixture.playerDeclared,
    whose_turn: turn ? (turn.isPlayer ? 'player' : 'npc') : 'unknown',
    round: turn?.round ?? null,
    resolved_actions: fixture.engine.actions,
    scene: fixture.engine.sceneDescription,
  };
}

export function requireNoul(answers: Record<string, DecisionAnswer>, name: string): number {
  const answer = answers[name];
  if (!answer || answer.type !== 'noul') {
    throw new Error(`Expected a noul answer for ${name}`);
  }
  return answer.noul;
}

export function requireScore(
  answers: Record<string, DecisionAnswer>,
  name: string,
): DecisionAnswer & { type: 'score' } {
  const answer = answers[name];
  if (!answer || answer.type !== 'score') {
    throw new Error(`Expected a score answer for ${name}`);
  }
  return answer;
}

export type ImportanceComparison = {
  id: string;
  hand: number;
  baseline: number;
  jev: number | null;
  abstain: boolean;
};

export function compareImportance(
  fixture: ImportanceFixture,
  rawScore: number | null,
  confidence: number | undefined,
): ImportanceComparison {
  const baseline = importanceToFive(
    calculateImportance({
      content: fixture.text,
      type: fixture.type,
      category: fixture.category,
    }),
  );
  const abstain = confidence !== undefined && confidence < 0.05;
  return {
    id: fixture.id,
    hand: fixture.handImportance,
    baseline,
    jev: rawScore === null || abstain ? null : scoreToFive(rawScore),
    abstain,
  };
}

export function agreement(rows: ImportanceComparison[], key: 'baseline' | 'jev'): number | null {
  const scored = rows.filter((row) => (key === 'baseline' ? true : row.jev !== null));
  if (scored.length === 0) {
    return null;
  }
  const hits = scored.filter((row) => row[key] === row.hand).length;
  return hits / scored.length;
}

export type { NarrationQuestionId };
