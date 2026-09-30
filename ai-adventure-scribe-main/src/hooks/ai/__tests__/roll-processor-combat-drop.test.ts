/**
 * #2378 — the DM shape from run 15, through the real roll-request parser: a ROLL_REQUESTS_V1
 * block carrying an attack request and a "Critical damage roll" 1d6 after a natural 7. In combat
 * the engine owns every die, so neither becomes a popup; outside combat both do.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processRollRequests } from '../roll-processor';

import logger from '@/lib/logger';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// Outside combat every request is the player's; the real roller would call the DM back.
vi.mock('@/services/combat/npc-auto-roller', () => ({
  executeAllNPCRolls: vi.fn(async (requests: unknown[]) => ({
    npcRolls: [],
    playerRolls: requests,
  })),
}));

const RUN_15_DM_TEXT = [
  'Cold clings to the professor and he yelps.',
  '```ROLL_REQUESTS_V1',
  JSON.stringify({
    rolls: [
      { type: 'attack', formula: '1d20+6', purpose: 'Chill Touch spell attack', ac: 12 },
      { type: 'damage', formula: '1d6', purpose: 'Critical damage roll' },
    ],
  }),
  '```',
].join('\n');

const params = (gameState: Record<string, unknown>): Parameters<typeof processRollRequests>[0] => ({
  responseText: RUN_15_DM_TEXT,
  existingRequests: [],
  isDiceRollMessage: false,
  processedSet: new Set<string>(),
  aiContext: { gameState },
  sessionId: 'session-1',
  characterId: 'char-1',
});

describe('processRollRequests: the DM cannot add a roll popup during an encounter (#2378)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('drops the attack and the "Critical damage roll" 1d6 and logs both', async () => {
    const processed = await processRollRequests(params({ isInCombat: true, encounterId: 'enc-1' }));

    expect(processed.playerRollRequests).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('DM_ROLL_REQUEST_DROPPED', {
      encounterId: 'enc-1',
      type: 'attack',
      purpose: 'Chill Touch spell attack',
    });
    expect(logger.warn).toHaveBeenCalledWith('DM_ROLL_REQUEST_DROPPED', {
      encounterId: 'enc-1',
      type: 'damage',
      purpose: 'Critical damage roll',
    });
  });

  it('drops the same requests when they arrive as structured roll_requests', async () => {
    const processed = await processRollRequests({
      ...params({ isInCombat: true, encounterId: 'enc-1' }),
      responseText: 'Cold clings to the professor.',
      existingRequests: [
        { type: 'attack', formula: '1d20+6', purpose: 'Chill Touch spell attack' },
        { type: 'damage', formula: '1d6', purpose: 'Critical damage roll' },
        { type: 'save', formula: '1d20+2', purpose: 'Dexterity save', dc: 13 },
      ],
    });

    expect(processed.playerRollRequests).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });

  it('does not remember a dropped request, so the same wording after combat still prompts (#2386)', async () => {
    const processedSet = new Set<string>();

    const inCombat = await processRollRequests({
      ...params({ isInCombat: true, encounterId: 'enc-1' }),
      processedSet,
    });
    expect(inCombat.playerRollRequests).toEqual([]);
    expect(processedSet.size).toBe(0);

    const afterCombat = await processRollRequests({
      ...params({ isInCombat: false }),
      processedSet,
    });
    expect(afterCombat.playerRollRequests.map((request) => request.type)).toEqual([
      'attack',
      'damage',
    ]);
  });

  it('keeps them when no encounter is active', async () => {
    const processed = await processRollRequests(params({ isInCombat: false }));

    expect(processed.playerRollRequests.map((request) => request.type)).toEqual([
      'attack',
      'damage',
    ]);
    expect(logger.warn).not.toHaveBeenCalledWith('DM_ROLL_REQUEST_DROPPED', expect.anything());
  });
});
