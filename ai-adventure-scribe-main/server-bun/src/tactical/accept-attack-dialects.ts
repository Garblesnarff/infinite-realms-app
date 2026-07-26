/**
 * The acceptance ladder: whatever envelope an attack arrives in, it leaves here as an action.
 *
 * Three channels are read in descending order of explicitness, and exactly one claims each
 * response:
 *
 *   1. `combat_actions` the model wrote itself — passed through untouched.
 *   2. Attack-shaped `roll_requests` — rewritten by `legacy-attack-translation`. This is the
 *      dialect the prompt teaches, because it is the only one gemini-3.1-flash-lite reliably
 *      speaks (proven across runs 5-8 by eleven corrective firings that changed nothing).
 *   3. Narration alone — read by `prose-attack-intent`. Run 9 emptied the first two channels
 *      for thirty consecutive turns while narrating twenty-three attacks, so this floor is the
 *      difference between a fight and a slideshow.
 *
 * The ordering matters as much as the layers. The floor runs on the POST-translation response,
 * so an attack that was translated already counts as declared and cannot be read a second time
 * out of the paragraph that describes it — one swing, one roll.
 */
import { translateLegacyAttackRolls } from './legacy-attack-translation.js';
import { applyProseAttackIntent, inferProseAttackIntent } from './prose-attack-intent.js';

import type { LegacyAttackTranslationResult } from './legacy-attack-translation.js';
import type { ProseAttackInference } from './prose-attack-intent.js';
import type { DMResponse } from '../services/dm/dm-response-schema.js';

export type AcceptedResponse = {
  response: DMResponse;
  /** Set when layer 2 claimed the response. */
  translation: LegacyAttackTranslationResult | null;
  /** Set when layer 3 claimed it. Never set alongside a translation of the same attack. */
  inference: ProseAttackInference | null;
  /** False when the model already spoke the engine's dialect and nothing was rewritten. */
  rewritten: boolean;
};

export function acceptWhateverWasEmitted(
  parsed: DMResponse,
  prompt: string,
  combatActive: boolean,
): AcceptedResponse {
  const translation = translateLegacyAttackRolls(parsed, prompt, combatActive);
  const translated = translation?.response ?? parsed;
  const inference = inferProseAttackIntent(translated, prompt, combatActive);
  return {
    response: inference ? applyProseAttackIntent(translated, inference) : translated,
    translation,
    inference,
    rewritten: !!translation || !!inference,
  };
}
