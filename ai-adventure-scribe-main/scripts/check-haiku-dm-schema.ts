/* eslint-disable no-console */
/**
 * One-call Haiku schema check (Refs #633 PR 4).
 *
 * Verifies that the DM response schema compiles for Anthropic structured
 * output instead of 400ing like it did on 2026-10-16 (Haiku 5.5 rejected the
 * `oneOf` in combat_actions and the 32 union/nullable fields; limit 16).
 *
 * Run on the Hetzner box (it holds the API key; no live calls in unit tests):
 *
 *   OPENROUTER_API_KEY=... bun scripts/check-haiku-dm-schema.ts [--model anthropic/claude-haiku-5.5]
 *
 * Exit 0: schema accepted (200). Exit 1: schema rejected (400) or other HTTP error.
 * Exit 2: misconfigured (no API key).
 */
import { dmResponseSchema } from '../server-bun/src/services/dm/dm-response-schema.js';

const DEFAULT_MODEL = 'anthropic/claude-haiku-5.5';

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const model = argValue('--model') ?? process.env.OPENROUTER_TEXT_MODEL ?? DEFAULT_MODEL;
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is not set');
  process.exit(2);
}

// The real producer: the exact schema object the DM sends (full dmResponseSchema
// with extensions, not the base — the union/optional budget is exact at 16/24).
const schema = dmResponseSchema as Record<string, unknown>;

const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model,
    messages: [
      {
        role: 'user',
        content:
          'Reply with a minimal valid DM turn: text "ok", empty arrays, combat_transition "none", scene_spec null.',
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'dm_response', strict: true, schema },
    },
    max_tokens: 500,
  }),
});

const bodyText = await res.text();
console.log(`model: ${model}`);
console.log(`HTTP ${res.status}`);

if (res.status === 400) {
  console.error(`SCHEMA REJECTED (400): ${bodyText.slice(0, 800)}`);
  process.exit(1);
}
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${bodyText.slice(0, 800)}`);
  process.exit(1);
}
console.log('SCHEMA ACCEPTED: Haiku compiled the DM response schema without a 400.');
