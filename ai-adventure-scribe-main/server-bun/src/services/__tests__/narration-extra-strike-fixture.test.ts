import { readdirSync } from 'fs';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { formatCombatEngineParts } from '../../../../shared/combat-outcome-transcript';
import {
  engineHitsOnPlayer,
  inventedExtraStrikeClaims,
} from '../../../../shared/narration-extra-strike';
import {
  ENEMY_HITS_PLAYER,
  FIGHT_ROSTER,
  REEVES,
  SCHOLAR,
  attackAction,
} from '../../../../shared/test-fixtures/engine-results';
import { LLMProviderService } from '../llm-provider-service.js';
import { DM_REQUEST } from './fixtures/llm/716-extra-strike/dm-request';

/**
 * #716: one engine HIT on the player, DM prose that lands a second strike. The DM reply is
 * replayed through the #734 LLM_FIXTURE_DIR seam (`llmFetch`), so the provider path that parses
 * the OpenRouter response runs for real and the network is never touched.
 *
 * The fixture is NOT a live recording: no provider key is used in this lane, and the Hetzner ops
 * session records the real ones. It was written by the real producer — `llmFetch`'s
 * LLM_RECORD_DIR branch — over a stubbed OpenRouter chat-completion response carrying the Hark
 * D5-029 prose (see fixtures/llm/716-extra-strike/README.md).
 */

const FIXTURE_DIR = join(import.meta.dir, 'fixtures', 'llm', '716-extra-strike');
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
let fetchCalls = 0;

describe('#716 extra strike against a replayed DM reply', () => {
  beforeEach(() => {
    fetchCalls = 0;
    process.env.LLM_FIXTURE_DIR = FIXTURE_DIR;
    delete process.env.LLM_RECORD_DIR;
    // The provider refuses to run without a key name set; replay never sends it anywhere.
    process.env.OPENROUTER_API_KEY = 'replay-only';
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error('network must not be touched in replay');
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  it('holds exactly one fixture file', () => {
    expect(readdirSync(FIXTURE_DIR).filter((file) => file.endsWith('.json'))).toHaveLength(1);
  });

  it('flags the second strike when the engine rolled one hit on the player', async () => {
    const reply = await LLMProviderService.generate(DM_REQUEST);
    expect(reply.error).toBeUndefined();
    expect(fetchCalls).toBe(0);
    expect(reply.text).toContain('a second strike lands');

    const cards = formatCombatEngineParts(
      attackAction(REEVES, SCHOLAR),
      ENEMY_HITS_PLAYER,
      FIGHT_ROSTER,
      { targetHp: true, targetMaxHp: 7 },
    ).map((part) => part.card);
    const hits = engineHitsOnPlayer(cards);
    expect(hits).toBe(1);

    const claims = inventedExtraStrikeClaims(reply.text, hits);
    expect(claims.map((claim) => claim.match)).toEqual([
      expect.stringContaining('second strike lands'),
    ]);
  });

  it('accepts the same reply when the engine rolled two hits on the player', async () => {
    const reply = await LLMProviderService.generate(DM_REQUEST);
    expect(inventedExtraStrikeClaims(reply.text, 2)).toEqual([]);
  });
});
