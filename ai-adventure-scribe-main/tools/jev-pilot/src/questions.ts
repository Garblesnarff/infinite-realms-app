import type { DecisionQuestion } from './decisions-types';

/**
 * Yes/no questions for one narration. The four named in #2277, plus the two
 * #2236 rules the #2249 checker also scores (inflated count, scene drift),
 * so a later comparison is on the same claims.
 */
export const NARRATION_QUESTION_IDS = [
  'unresolved_action',
  'false_turn_denial',
  'invented_dice_result',
  'speaks_for_the_player',
  'inflated_action_count',
  'scene_drift',
] as const;

export type NarrationQuestionId = (typeof NARRATION_QUESTION_IDS)[number];

const noul = (instructions: string, yes: string, no: string): DecisionQuestion => ({
  type: 'noul',
  instructions,
  criteria: { true: yes, false: no },
});

export const NARRATION_QUESTIONS: Record<NarrationQuestionId, DecisionQuestion> = {
  unresolved_action: noul(
    'Does the narration name an action (attack, spell, Dash, Disengage, Dodge, or a lunge that is an attack) that resolved_actions does not contain?',
    'It claims an action the engine did not resolve.',
    'Every described action was resolved, or no action is described.',
  ),
  false_turn_denial: noul(
    'Does the narration say it is not the player\'s turn, or tell the player to wait, while whose_turn is "player"?',
    "It denies the player's turn against the engine.",
    "It does not deny the turn, or it is not the player's turn.",
  ),
  invented_dice_result: noul(
    'Does the narration state a hit, miss, damage, or other die outcome the engine did not produce, including success wording on a miss?',
    'It states a mechanical outcome the engine did not produce.',
    'Outcomes match the engine, or no mechanical outcome is stated.',
  ),
  speaks_for_the_player: noul(
    'Does the narration give the player an action or spoken line they did not declare and the engine did not resolve? Restating a declared action is no.',
    'It invents what the player did or said.',
    'Player action and speech match what was declared or resolved.',
  ),
  inflated_action_count: noul(
    'Does the narration describe several strikes, a flurry, or multiple blows when the engine resolved only one attack or spell?',
    'One resolved action is told as many.',
    'The count matches, or no count is implied.',
  ),
  scene_drift: noul(
    'Does the narration move the scene to a place the scene field does not support (for example a stone floor, chamber, or halls while the scene is a rope over a chasm)?',
    'The place contradicts the scene field.',
    'The place matches the scene field, or no place is named.',
  ),
};

export function relevanceQuestion(candidateId: string): DecisionQuestion {
  return noul(
    `Is candidates["${candidateId}"] relevant to player_message? Relevant means the DM would answer that message wrong if they ignored this memory: same creature, NPC, place, object, or the outcome the message continues. A different campaign is not relevant.`,
    'Same people, place, or the outcome this message continues.',
    'Different campaign, or a fact that does not change the answer.',
  );
}

/** Five levels. The API scores them 0 through 4; the pilot reports 1 through 5. */
export const IMPORTANCE_CRITERIA = [
  'Color or voice. The next decision does not change if this is dropped.',
  'Scene dressing. The DM could drop it and still answer.',
  'Useful context: who is here, where, or a standing warning.',
  'Changes the immediate situation: a hit, a miss, a refusal, or a position.',
  'The DM would play the next turn wrong without it.',
];

export function importanceQuestion(memoryId: string): DecisionQuestion {
  return {
    type: 'score',
    instructions: `How important is memories["${memoryId}"] for the DM's next turn? Score the text, not its type label.`,
    criteria: IMPORTANCE_CRITERIA,
  };
}

/** API score is 0-based. Level 0 is hand-label 1. */
export function scoreToFive(raw: number): number {
  return Math.min(5, Math.max(1, Math.round(raw) + 1));
}

/**
 * A noul of 0.5 means the model cannot tell (TypeSafe). Anything above is yes.
 * Exactly 0.5 is an abstain, not a false flag and not a catch.
 */
export function noulDecision(probability: number): boolean | null {
  if (probability === 0.5) {
    return null;
  }
  return probability > 0.5;
}
