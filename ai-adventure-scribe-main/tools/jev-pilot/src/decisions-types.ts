/** Guidance accepted by the Decisions API: a string, object, or array. */
export type Guidance = string | Record<string, unknown> | unknown[];

export type NoulQuestion = {
  type: 'noul';
  instructions: Guidance;
  criteria?: { true: Guidance; false: Guidance };
};

export type ChoiceQuestion = {
  type: 'choice';
  instructions: Guidance;
  criteria: Record<string, Guidance | null>;
};

export type ScoreQuestion = {
  type: 'score';
  instructions: Guidance;
  /** Ordered lowest to highest. Levels are 0-based. At most 10. */
  criteria: Guidance[];
};

export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

/** POST https://openrouter.ai/api/alpha/decisions — not chat completions. */
export type DecisionsRequest = {
  model: string;
  state: string | Record<string, unknown> | unknown[];
  questions: Record<string, DecisionQuestion>;
  session_id?: string;
  user?: string;
};

export type NoulAnswer = { type: 'noul'; noul: number };
export type ChoiceAnswer = {
  type: 'choice';
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
};
export type ScoreAnswer = {
  type: 'score';
  score: number;
  confidence?: number;
  probabilities?: Record<string, number>;
  legend?: Record<string, string>;
};
export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type DecisionsUsage = {
  input_tokens: number;
  output_tokens: number;
  cost?: number;
};

export type DecisionsResponse = {
  id?: string;
  model: string;
  provider?: string;
  answers: Record<string, DecisionAnswer>;
  usage: DecisionsUsage;
};

export const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
export const JEV_MODEL = 'typesafe/jev-1.13';
/** $0.042 per 1M input tokens; output is free. */
export const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;
export const INPUT_TOKEN_CAP = 2_000_000;
