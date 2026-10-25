/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { describeAttackRoll, targetAcLabel } from '../../../../shared/describe-attack-roll';
import { askPlayerForAttackDie } from '../player-attack-roll';

import { requestPlayerAttackRoll } from '@/services/combat/player-roll-bridge';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/auth/TokenService', () => ({ getAuthHeaders: () => ({}) }));
vi.mock('@/services/combat/player-roll-bridge', () => ({
  requestPlayerAttackRoll: vi.fn(async () => ({ d20: null })),
}));

describe('attack roll cover labels', () => {
  it('formats target AC with half and three-quarters cover', () => {
    expect(targetAcLabel(14, 2)).toBe('AC 12 +2 half cover');
    expect(targetAcLabel(15, 5)).toBe('AC 10 +5 three-quarters cover');
    expect(targetAcLabel(12, 0)).toBe('AC 12');
    expect(targetAcLabel(12)).toBe('AC 12');
  });

  it('includes cover in describeAttackRoll output', () => {
    expect(
      describeAttackRoll({
        actorLabel: 'Tavo',
        weaponName: 'Longbow',
        targetLabel: 'The Shard-Bearer',
        attackBonus: 5,
        targetAc: 14,
        coverBonus: 2,
        advantage: false,
        disadvantage: false,
      }),
    ).toContain('vs AC 12 +2 half cover');

    expect(
      describeAttackRoll({
        actorLabel: 'Tavo',
        weaponName: 'Longbow',
        targetLabel: 'The Shard-Bearer',
        attackBonus: 5,
        targetAc: 14,
        advantage: false,
        disadvantage: false,
      }),
    ).toContain('vs AC 14');
  });
});

/**
 * #1086 (e): the real client producer path. The fetch body is the server's proposeAttack
 * return shape (server-bun combat-attack-service.ts: targetAc = seated AC + cover, baseAc,
 * coverBonus, cover), as POST /v1/combat/:id/intent phase 'propose' wraps it in `proposal`.
 */
describe('a longbow shot through half cover (#1086 (e))', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('carries the cover bonus from the proposal into the dialog text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              proposal: {
                legal: true,
                refusal: null,
                weaponName: 'Longbow',
                attackBonus: 5,
                targetAc: 14,
                baseAc: 12,
                coverBonus: 2,
                cover: 1,
                advantage: false,
                disadvantage: false,
                advantageSources: [],
                disadvantageSources: [],
                movementOnly: false,
                targetLabel: 'The Shard-Bearer',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );

    await askPlayerForAttackDie({
      encounterId: 'enc-1',
      action: {
        actor_id: 'tavo-id',
        action_type: 'attack',
        target_ids: ['shard-bearer-id'],
        weapon_id: null,
      } as any,
      actorLabel: 'Tavo',
    });

    const spec = vi.mocked(requestPlayerAttackRoll).mock.calls[0]?.[0] as any;
    expect(spec.targetAc).toBe(14);
    expect(spec.coverBonus).toBe(2);
    expect(describeAttackRoll(spec)).toContain('vs AC 12 +2 half cover');
  });
});
