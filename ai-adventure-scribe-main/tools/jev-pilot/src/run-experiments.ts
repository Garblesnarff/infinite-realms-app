import { estimateInputTokens } from './cost-ledger';
import {
  addNoul,
  compareImportance,
  emptyRuleScore,
  rankByImportance,
  recallAt5,
  requireNoul,
  requireScore,
} from './metrics';
import { NARRATION_QUESTION_IDS } from './questions';
import { chunkImportance, importanceRequest, narrationRequest, rerankRequest } from './requests';
import { rankBySimilarity } from './similarity';

import type { DecisionsClient } from './decisions-client';
import type { ImportanceFixture, NarrationFixture, RerankFixture } from './fixtures';
import type { ImportanceComparison, RuleScore } from './metrics';
import type { NarrationQuestionId } from './questions';
import type { NarrationChecker } from './regex-checker';

export function estimateRequests(bodies: unknown[]): number {
  return bodies.reduce<number>((sum, body) => sum + estimateInputTokens(body), 0);
}

export async function runNarration(
  client: DecisionsClient,
  fixtures: NarrationFixture[],
  checker: NarrationChecker | null,
): Promise<{
  rules: Record<NarrationQuestionId, RuleScore>;
  regex: { status: 'not-on-ref' | 'ran'; flags: Array<{ id: string; rules: string[] }> };
}> {
  const rules = Object.fromEntries(
    NARRATION_QUESTION_IDS.map((id) => [id, emptyRuleScore()]),
  ) as Record<NarrationQuestionId, RuleScore>;
  const flags: Array<{ id: string; rules: string[] }> = [];
  for (const fixture of fixtures) {
    const response = await client.decide(narrationRequest(fixture));
    for (const id of NARRATION_QUESTION_IDS) {
      addNoul(rules[id], fixture.labels[id], requireNoul(response.answers, id));
    }
    if (checker) {
      flags.push({
        id: fixture.id,
        rules: checker(fixture.narration, fixture.engine).map((violation) => violation.rule),
      });
    }
  }
  return {
    rules,
    regex: checker ? { status: 'ran', flags } : { status: 'not-on-ref', flags: [] },
  };
}

export type RerankRow = {
  id: string;
  jev: number | null;
  importance: number;
  similarity: number | null;
};

/** Both baselines, with no model call. Similarity is null when no stored vectors are present. */
export function scoreRerankBaselines(fixtures: RerankFixture[]): {
  importanceRecall: number | null;
  similarityRecall: number | null;
  similarityRows: number;
  rows: RerankRow[];
} {
  const rows: RerankRow[] = fixtures.map((fixture) => {
    const similarityOrder = rankBySimilarity(fixture.queryEmbedding, fixture.candidates);
    return {
      id: fixture.id,
      jev: null,
      importance: recallAt5(rankByImportance(fixture.candidates), fixture.relevantIds),
      similarity: similarityOrder === null ? null : recallAt5(similarityOrder, fixture.relevantIds),
    };
  });
  return summarizeRerank(rows);
}

export async function runRerank(
  client: DecisionsClient,
  fixtures: RerankFixture[],
): Promise<{
  jevRecall: number | null;
  importanceRecall: number | null;
  similarityRecall: number | null;
  similarityRows: number;
  rows: RerankRow[];
}> {
  const rows: RerankRow[] = [];
  for (const fixture of fixtures) {
    const response = await client.decide(rerankRequest(fixture));
    const ranked = [...fixture.candidates].sort((left, right) => {
      return requireNoul(response.answers, right.id) - requireNoul(response.answers, left.id);
    });
    const similarityOrder = rankBySimilarity(fixture.queryEmbedding, fixture.candidates);
    rows.push({
      id: fixture.id,
      jev: recallAt5(
        ranked.map((candidate) => candidate.id),
        fixture.relevantIds,
      ),
      importance: recallAt5(rankByImportance(fixture.candidates), fixture.relevantIds),
      similarity: similarityOrder === null ? null : recallAt5(similarityOrder, fixture.relevantIds),
    });
  }
  return summarizeRerank(rows);
}

function summarizeRerank(rows: RerankRow[]): {
  jevRecall: number | null;
  importanceRecall: number | null;
  similarityRecall: number | null;
  similarityRows: number;
  rows: RerankRow[];
} {
  const mean = (values: number[]): number | null => {
    if (values.length === 0) {
      return null;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  const similarityValues = rows
    .map((row) => row.similarity)
    .filter((value): value is number => value !== null);
  const jevValues = rows.map((row) => row.jev).filter((value): value is number => value !== null);
  return {
    jevRecall: mean(jevValues),
    importanceRecall: mean(rows.map((row) => row.importance)),
    similarityRecall: mean(similarityValues),
    similarityRows: similarityValues.length,
    rows,
  };
}

export async function runImportance(
  client: DecisionsClient,
  fixtures: ImportanceFixture[],
): Promise<ImportanceComparison[]> {
  const rows = [];
  for (const chunk of chunkImportance(fixtures, 20)) {
    const response = await client.decide(importanceRequest(chunk));
    for (const fixture of chunk) {
      const answer = requireScore(response.answers, fixture.id);
      rows.push(compareImportance(fixture, answer.score, answer.confidence));
    }
  }
  return rows;
}
