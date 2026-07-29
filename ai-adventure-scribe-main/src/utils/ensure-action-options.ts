/**
 * Guarantees DM messages end with clickable action options.
 *
 * The DM prompt instructs the model to end non-combat responses with
 * lettered options (A. **Action**, description) that the UI renders as
 * buttons (see parseMessageOptions / DynamicOptionsSection). Models
 * occasionally ignore this, leaving the player with no affordance.
 * This module repairs such responses:
 * 1. Try a small, options-only LLM call grounded in the scene text.
 * 2. If that fails, append safe generic options so the UI never dead-ends.
 */
import { llmApiClient } from '@/infrastructure/api';
import logger from '@/lib/logger';
import { parseMessageOptions } from '@/utils/parseMessageOptions';

const STATIC_FALLBACK_OPTIONS = [
  'A. **Take in your surroundings**, study the scene for details, dangers, or opportunities.',
  'B. **Speak up**, address whoever is present and see how they respond.',
  'C. **Act on instinct**, follow your gut and make a bold move.',
].join('\n');

const REPAIR_MAX_SCENE_CHARS = 2000;

function buildRepairPrompt(sceneText: string): string {
  const scene = sceneText.slice(-REPAIR_MAX_SCENE_CHARS);
  return `You are a D&D 5e Dungeon Master. The scene below was shown to the player, but it is missing the action options the game UI needs.

<scene>
${scene}
</scene>

Write exactly 3 action options for the player, grounded in this scene.
Output ONLY the 3 option lines and nothing else.
Every line must use this exact format: A. **Action Name**, short description

Example:
A. **Join the kitchen line**, step in beside the cooks and prove you can keep pace.
B. **Question the manager**, press for details about the missing hire.
C. **Slip toward the larder**, investigate the strange disturbance yourself.`;
}

export function messageHasOptions(text: string): boolean {
  try {
    return parseMessageOptions(text).hasOptions;
  } catch {
    return false;
  }
}

async function generateRepairOptions(sceneText: string): Promise<string | null> {
  try {
    const raw = await llmApiClient.generateText({
      prompt: buildRepairPrompt(sceneText),
      temperature: 0.8,
      maxTokens: 400,
    });
    const candidate = (raw || '').trim();
    if (!candidate) return null;
    // Validate through the same parser the UI uses before trusting it.
    const parsed = parseMessageOptions(`Scene.\n\n${candidate}`);
    if (!parsed.hasOptions || parsed.options.length < 2) return null;
    return candidate;
  } catch (error) {
    logger.warn('[EnsureOptions] Options repair call failed:', error);
    return null;
  }
}

/**
 * Returns `text` unchanged when it already contains parseable options;
 * otherwise appends repaired (or static fallback) options.
 */
export async function ensureActionOptions(text: string): Promise<string> {
  if (!text || messageHasOptions(text)) return text;
  logger.warn('[EnsureOptions] DM response had no action options; repairing');
  const repaired = await generateRepairOptions(text);
  if (!repaired) {
    logger.warn('[EnsureOptions] Using static fallback options');
  }
  return `${text.trim()}\n\n${repaired ?? STATIC_FALLBACK_OPTIONS}`;
}
