import { JEV_MODEL } from './decisions-types';
import { narrationState } from './metrics';
import { NARRATION_QUESTIONS, importanceQuestion, relevanceQuestion } from './questions';

import type { DecisionsRequest } from './decisions-types';
import type { ImportanceFixture, NarrationFixture, RerankFixture } from './fixtures';

export function narrationRequest(fixture: NarrationFixture): DecisionsRequest {
  return {
    model: JEV_MODEL,
    session_id: 'jev-pilot-narration',
    state: narrationState(fixture),
    questions: NARRATION_QUESTIONS,
  };
}

export function rerankRequest(fixture: RerankFixture): DecisionsRequest {
  const questions: DecisionsRequest['questions'] = {};
  for (const candidate of fixture.candidates) {
    questions[candidate.id] = relevanceQuestion(candidate.id);
  }
  return {
    model: JEV_MODEL,
    session_id: 'jev-pilot-rerank',
    state: {
      player_message: fixture.playerMessage,
      candidates: fixture.candidates.map((candidate) => ({
        id: candidate.id,
        text: candidate.text,
      })),
    },
    questions,
  };
}

export function importanceRequest(fixtures: ImportanceFixture[]): DecisionsRequest {
  const questions: DecisionsRequest['questions'] = {};
  for (const fixture of fixtures) {
    questions[fixture.id] = importanceQuestion(fixture.id);
  }
  return {
    model: JEV_MODEL,
    session_id: 'jev-pilot-importance',
    state: {
      memories: fixtures.map((fixture) => ({ id: fixture.id, text: fixture.text })),
    },
    questions,
  };
}

/** Split a score batch so one state stays under the context window. */
export function chunkImportance(
  fixtures: ImportanceFixture[],
  maxItems: number,
): ImportanceFixture[][] {
  if (maxItems < 1) {
    throw new Error('maxItems must be at least 1');
  }
  const chunks: ImportanceFixture[][] = [];
  for (let index = 0; index < fixtures.length; index += maxItems) {
    chunks.push(fixtures.slice(index, index + maxItems));
  }
  return chunks;
}
