import { DEFAULT_OPENROUTER_TEXT_MODEL } from '../../../../llm-model-config.js';

/** The DM generate call the #716 fixture answers; its body is the fixture key. */
export const DM_REQUEST = {
  provider: 'openrouter' as const,
  model: DEFAULT_OPENROUTER_TEXT_MODEL,
  systemPrompt: 'You are the Dungeon Master. Narrate only what the engine resolved.',
  prompt:
    '{"authoritativeCombatResults":[{"actor":"Captain Sarah Reeves","action":"attack","targets":["The Scholar"],"hit":true}],"turnHandoff":"End your response with: \\"The Scholar, what do you do?\\""}',
  maxTokens: 600,
  temperature: 0.8,
};
