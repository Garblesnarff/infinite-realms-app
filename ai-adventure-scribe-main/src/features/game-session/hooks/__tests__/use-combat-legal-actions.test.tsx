import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';

import { upcastAcidArrowIntent } from '../../../../../shared/test-fixtures/upcast-spell-intent';
import { useCombatLegalActions } from '../use-combat-legal-actions';

import type { ChatMessage } from '@/types/game';

import { requestPlayerAttackRoll } from '@/services/combat/player-roll-bridge';
import { engineRollWasRefused } from '@/services/combat/roll-outcome-display';
import { requestSpellTargetSave } from '@/services/combat/spell-target-save-bridge';

vi.mock('@/services/combat/player-roll-bridge', () => ({
  requestPlayerAttackRoll: vi.fn(),
}));
vi.mock('@/services/combat/spell-target-save-bridge', () => ({
  requestSpellTargetSave: vi.fn(),
}));

const inspirationHolder = vi.hoisted(() => ({
  armed: false,
  arm: vi.fn(),
  disarm: vi.fn(),
  spendInspiration: vi.fn(async () => true),
}));
vi.mock('@/features/game-session/hooks/use-inspiration-spend', () => ({
  useInspirationSpend: () => ({
    armed: inspirationHolder.armed,
    arm: (...args: unknown[]) => {
      inspirationHolder.arm(...args);
      inspirationHolder.armed = true;
    },
    disarm: (...args: unknown[]) => {
      inspirationHolder.disarm(...args);
      inspirationHolder.armed = false;
    },
    spendInspiration: inspirationHolder.spendInspiration,
  }),
}));
// #1414 round 4 (CI fix): useCombatLegalActions reads the armed state straight from
// the armed context now (it never spends), so the chip tests mock that hook. The
// useInspirationSpend mock above stays as the B2 tripwire: if a spend ever creeps
// back into runAction, the mock is wired up again and the no-spend tests catch it.
vi.mock('@/features/game-session/contexts/inspiration-armed-context', () => ({
  useInspirationArmed: () => ({
    armed: inspirationHolder.armed,
    arm: (...args: unknown[]) => {
      inspirationHolder.arm(...args);
      inspirationHolder.armed = true;
    },
    disarm: (...args: unknown[]) => {
      inspirationHolder.disarm(...args);
      inspirationHolder.armed = false;
    },
  }),
}));

const combatHolder = vi.hoisted(() => ({
  current: {
    state: {
      isInCombat: true,
      activeEncounter: {
        id: 'enc-1',
        currentTurnParticipantId: 'pc-1',
        currentRound: 1,
        participants: [{ id: 'pc-1', participantType: 'player' }],
      },
    },
    refreshCombatState: vi.fn(),
  },
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => combatHolder.current,
  useOptionalCombat: () => combatHolder.current,
}));

const movementHolder = vi.hoisted(() => ({
  remaining: vi.fn(async () => 0),
}));

vi.mock('@/services/combat/player-movement-remaining', () => ({
  actorMovementRemaining: movementHolder.remaining,
}));

describe('useCombatLegalActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('a failed refresh clears previously loaded actions and a successful retry restores them', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ actorId: 'pc-1', actions: [{ type: 'attack', label: 'Attack' }] }),
      } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ actorId: 'pc-1', actions: [{ type: 'attack', label: 'Attack' }] }),
      } as Response);

    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendText: vi.fn() }),
    );

    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.retryLoad();
    });
    await waitFor(() => expect(result.current.actions).toEqual([]));

    await act(async () => {
      await result.current.retryLoad();
    });
    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    expect(fetchSpy).toHaveBeenCalled();
  });

  it('does not restore a stale Attack after a newer spent-action refresh', async () => {
    let resolveOld!: (response: Response) => void;
    const old = new Promise<Response>((resolve) => {
      resolveOld = resolve;
    });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ actorId: 'pc-1', actions: [{ type: 'attack', label: 'Attack' }] }),
      } as Response)
      .mockReturnValueOnce(old)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ actorId: 'pc-1', actions: [] }),
      } as Response);
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendText: vi.fn() }),
    );
    await waitFor(() => expect(result.current.actions).toHaveLength(1));
    let first!: Promise<void>;
    act(() => {
      first = result.current.retryLoad();
    });
    await act(async () => {
      await result.current.retryLoad();
    });
    expect(result.current.actions).toEqual([]);
    await act(async () => {
      resolveOld({
        ok: true,
        json: async () => ({ actorId: 'pc-1', actions: [{ type: 'attack', label: 'Attack' }] }),
      } as Response);
      await first;
    });
    expect(result.current.actions).toEqual([]);
  });

  it('refuses an unknown engine-only action instead of sending its label as chat (#1276)', async () => {
    const onSendText = vi.fn(async () => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        actorId: 'pc-1',
        actions: [{ type: 'future_engine_action', label: 'Future engine action' }],
      }),
    } as Response);

    const { result } = renderHook(() => useCombatLegalActions({ enabled: true, onSendText }));
    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(result.current.actions[0]);
    });

    expect(result.current.error).toBe('Reload to use this');
    expect(onSendText).not.toHaveBeenCalled();
  });

  it('sends Divine Sense as a player action with the current encounter version', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const path = String(url);
      if (path.includes('/legal-actions'))
        return {
          ok: true,
          json: async () => ({
            actorId: 'pc-1',
            actions: [{ type: 'divine_sense', label: 'Divine Sense' }],
          }),
        } as Response;
      if (path.includes('/status'))
        return { ok: true, json: async () => ({ encounter: { version: 7 } }) } as Response;
      if (path.includes('/intent')) return { ok: true, json: async () => ({}) } as Response;
      throw new Error(`Unexpected request ${path} ${String(init?.method)}`);
    });
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendText: vi.fn() }),
    );
    await waitFor(() => expect(result.current.actions).toHaveLength(1));
    await act(async () => {
      await result.current.runAction(result.current.actions[0]);
    });
    const call = fetchSpy.mock.calls.find(([url]) => String(url).includes('/intent'));
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      source: 'player',
      origin: 'action_bar',
      intent: { type: 'divine_sense', actorId: 'pc-1', expectedVersion: 7 },
    });
  });
});

describe('useCombatLegalActions use_item (#1147)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  const useItemAction = { type: 'use_item', label: 'Use Potion of Healing', itemId: 'potion-1' };

  function routeFetch(): MockInstance<typeof fetch> {
    return vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url: unknown, init?: unknown) => {
        const href = String(url);
        if (href.includes('/legal-actions')) {
          return {
            ok: true,
            json: async () => ({ actorId: 'pc-1', actions: [useItemAction] }),
          } as Response;
        }
        if (href.includes('/intent')) {
          const body = JSON.parse(String((init as { body?: string }).body ?? '{}')) as {
            intent?: { type?: string };
          };
          if (body.intent?.type === 'use_item') {
            return {
              ok: true,
              json: async () => ({
                accepted: true,
                result: {
                  itemName: 'Potion of Healing',
                  healed: 9,
                  newHp: 18,
                  maxHp: 20,
                },
              }),
            } as Response;
          }
          return { ok: true, json: async () => ({ accepted: true, result: {} }) } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });
  }

  interface IntentCallBody {
    intent: { type: string; actorId?: string; itemId?: string; actionId?: string };
    source?: string;
    dmStartedAt?: number;
  }

  function intentCalls(
    fetchSpy: ReturnType<typeof routeFetch>,
  ): Array<{ url: string; body: IntentCallBody }> {
    return fetchSpy.mock.calls
      .map(([url, init]) => ({
        url: String(url),
        body: JSON.parse(String((init as { body?: string }).body ?? '{}')),
      }))
      .filter((call) => call.url.includes('/intent'));
  }

  it('posts use_item, sends the engine notice, and ends the turn when movement is exhausted', async () => {
    movementHolder.remaining.mockResolvedValue(0);
    const fetchSpy = routeFetch();
    const onSendMessage = vi.fn(async (_message: ChatMessage) => {});
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage, onSendText: vi.fn() }),
    );

    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(useItemAction as never);
    });

    const intents = intentCalls(fetchSpy);
    expect(intents).toHaveLength(2);
    expect(intents[0].body.intent).toEqual({
      type: 'use_item',
      actorId: 'pc-1',
      itemId: 'potion-1',
    });
    expect(intents[0].body.source).toBe('dm');
    expect(intents[1].body.intent.type).toBe('end_turn');
    expect(onSendMessage).toHaveBeenCalled();
    const notice = onSendMessage.mock.calls[0][0];
    expect(notice.text).toContain('Potion of Healing');
    expect(notice.text).toContain('9 HP');
    expect(combatHolder.current.refreshCombatState).toHaveBeenCalled();
  });

  it('does not end the turn when movement remains', async () => {
    movementHolder.remaining.mockResolvedValue(5);
    const fetchSpy = routeFetch();
    const onSendMessage = vi.fn(async (_message: ChatMessage) => {});
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage, onSendText: vi.fn() }),
    );

    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(useItemAction as never);
    });

    const intents = intentCalls(fetchSpy);
    expect(intents).toHaveLength(1);
    expect(intents[0].body.intent.type).toBe('use_item');
    expect(onSendMessage).toHaveBeenCalled();
  });

  it('refuses without sending when the action carries no itemId', async () => {
    const fetchSpy = routeFetch();
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage: vi.fn(), onSendText: vi.fn() }),
    );

    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction({ type: 'use_item', label: 'Use item' } as never);
    });

    expect(intentCalls(fetchSpy)).toHaveLength(0);
    expect(result.current.error).toBe('That item could not be used. Nothing was spent.');
  });
});

describe('useCombatLegalActions spell cast (#1185)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.mocked(requestPlayerAttackRoll).mockResolvedValue({ d20: 17 });
    vi.mocked(requestSpellTargetSave).mockResolvedValue('continue');
  });

  const castAction = {
    type: 'spell',
    label: 'Cast Acid Arrow',
    spellId: 'acid-arrow',
    targetIds: ['monster-1'],
  };

  function routeFetch(
    legalActions: Array<Record<string, unknown>> = [castAction],
  ): MockInstance<typeof fetch> {
    return vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url: unknown, init?: unknown) => {
        const href = String(url);
        if (href.includes('/legal-actions')) {
          return {
            ok: true,
            json: async () => ({ actorId: 'pc-1', actions: legalActions }),
          } as Response;
        }
        if (href.includes('/intent')) {
          const body = JSON.parse(String((init as { body?: string }).body ?? '{}')) as {
            intent?: { type?: string };
            phase?: string;
          };
          // The dice popup reads its bonus and target AC from the engine's proposal.
          if (body.phase === 'propose') {
            return {
              ok: true,
              json: async () => ({
                proposal: {
                  movementOnly: false,
                  spellId: 'acid-arrow',
                  spellName: 'Acid Arrow',
                  kind: 'attack',
                  attackBonus: 5,
                  saveDC: 13,
                  targetAc: 11,
                  advantage: false,
                  disadvantage: false,
                  targetLabel: 'Rubble Sentinel',
                },
              }),
            } as Response;
          }
          return { ok: true, json: async () => ({ accepted: true, result: {} }) } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });
  }

  interface IntentCallBody {
    intent: { type: string; actorId?: string; spellId?: string; spellName?: string };
    source?: string;
    origin?: string;
    phase?: string;
  }

  function intentCalls(
    fetchSpy: ReturnType<typeof routeFetch>,
  ): Array<{ url: string; body: IntentCallBody }> {
    return fetchSpy.mock.calls
      .map(([url, init]) => ({
        url: String(url),
        body: JSON.parse(String((init as { body?: string }).body ?? '{}')),
      }))
      .filter((call) => call.url.includes('/intent') && !call.body.phase);
  }

  it('commits the cast through the declare → dialog → commit pipeline and keeps the turn open when movement remains', async () => {
    movementHolder.remaining.mockResolvedValue(5);
    const fetchSpy = routeFetch();
    const onSendMessage = vi.fn(async (_message: ChatMessage) => {});
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage, onSendText: vi.fn() }),
    );

    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(castAction as never);
    });

    const intents = intentCalls(fetchSpy);
    expect(intents).toHaveLength(1);
    // The exact wire body the ActionBar sends for a cast: the spell's own level rides
    // as slotLevel — the engine refuses a leveled spell with no slot level
    // (missing_spell_slot_level), so a null here would refuse the cast. The commit
    // carries the player's own die from the popup.
    expect(intents[0].body.intent).toEqual({
      type: 'spell',
      actorId: 'pc-1',
      targetIds: ['monster-1'],
      spellId: 'acid-arrow',
      spellName: 'Acid Arrow',
      slotLevel: 2,
      d20: 17,
    });
    expect(intents[0].body.source).toBe('dm');
    expect(intents[0].body.origin).toBe('action_bar');
    // The dice popup's proposal names the same slot level.
    const proposals = fetchSpy.mock.calls
      .map(([, init]) => JSON.parse(String((init as { body?: string }).body ?? '{}')))
      .filter((body: { phase?: string }) => body.phase === 'propose');
    expect(proposals).toHaveLength(1);
    expect(proposals[0].intent).toMatchObject({ spellId: 'acid-arrow', slotLevel: 2 });
    // The mocked commit carries no engine lines, so no notice is composed; the turn
    // staying open is the movement read plus the refresh below.
    expect(combatHolder.current.refreshCombatState).toHaveBeenCalled();
  });

  it('sends a Divine Smite chip as the attack with its slot level, and a plain attack without one (#1362)', async () => {
    movementHolder.remaining.mockResolvedValue(0);
    const attack = {
      type: 'attack',
      label: 'Attack with Quarterstaff',
      weaponId: 'quarterstaff',
      targetIds: ['monster-1'],
    };
    const smite = {
      type: 'divine_smite',
      label: 'Attack with Quarterstaff and Divine Smite 2d8 (level 1 slot)',
      weaponId: 'quarterstaff',
      targetIds: ['monster-1'],
      slotLevel: 1,
      smiteDice: 2,
    };
    const fetchSpy = routeFetch([attack, smite]);
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage: vi.fn(), onSendText: vi.fn() }),
    );
    await waitFor(() => expect(result.current.actions).toHaveLength(2));

    await act(async () => {
      await result.current.runAction(smite as never);
    });
    // With no movement left the hook ends the turn after each attack, so only the attack posts count.
    const attackPosts = () =>
      intentCalls(fetchSpy).filter((call) => call.body.intent.type === 'attack');
    const smiteIntents = attackPosts();
    expect(smiteIntents).toHaveLength(1);
    // The Smite chip commits the existing attack intent, with the slot it spends on a hit.
    expect(smiteIntents[0].body.intent).toMatchObject({
      type: 'attack',
      actorId: 'pc-1',
      targetId: 'monster-1',
      weaponId: 'quarterstaff',
      divineSmiteSlotLevel: 1,
      d20: 17,
    });

    await act(async () => {
      await result.current.runAction(attack as never);
    });
    const plainIntent = attackPosts()[1];
    expect(plainIntent.body.intent).toMatchObject({ type: 'attack', targetId: 'monster-1' });
    expect(plainIntent.body.intent).not.toHaveProperty('divineSmiteSlotLevel');
  });

  it('sends the slot the chip names for an upcast cast (#1206)', async () => {
    movementHolder.remaining.mockResolvedValue(5);
    const upcastChip = { ...castAction, label: 'Cast Acid Arrow (3rd-level slot)', slotLevel: 3 };
    const fetchSpy = routeFetch([upcastChip]);
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage: vi.fn(), onSendText: vi.fn() }),
    );

    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(upcastChip as never);
    });

    const intents = intentCalls(fetchSpy);
    expect(intents).toHaveLength(1);
    // The exact commit the real-route test posts (npc-engine-rows.real-db.test.ts).
    expect(intents[0].body.intent).toEqual(upcastAcidArrowIntent('pc-1', 'monster-1', 17));
    const proposals = fetchSpy.mock.calls
      .map(([, init]) => JSON.parse(String((init as { body?: string }).body ?? '{}')))
      .filter((body: { phase?: string }) => body.phase === 'propose');
    expect(proposals[0].intent).toMatchObject({ spellId: 'acid-arrow', slotLevel: 3 });
  });

  it('sends a save spell chip to the DM as its label, which names the upcast slot (#1206)', async () => {
    const burningHands = {
      type: 'spell',
      label: 'Cast Burning Hands (2nd-level slot)',
      spellId: 'burning-hands',
      slotLevel: 2,
    };
    routeFetch([burningHands]);
    const onSendText = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage: vi.fn(), onSendText }),
    );

    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(burningHands as never);
    });

    expect(onSendText).toHaveBeenCalledWith('Cast Burning Hands (2nd-level slot)');
  });

  it('ends the turn after the cast when no movement remains', async () => {
    movementHolder.remaining.mockResolvedValue(0);
    const fetchSpy = routeFetch();
    const onSendMessage = vi.fn(async (_message: ChatMessage) => {});
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage, onSendText: vi.fn() }),
    );

    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(castAction as never);
    });

    const intents = intentCalls(fetchSpy);
    expect(intents).toHaveLength(2);
    expect(intents[0].body.intent.type).toBe('spell');
    expect(intents[1].body.intent.type).toBe('end_turn');
  });

  it('keeps the turn open after the cast with no movement left while a bonus-action spell is offered', async () => {
    movementHolder.remaining.mockResolvedValue(0);
    // The server offers a bonus-action spell only while the bonus action is unspent.
    const healingWord = { type: 'spell', label: 'Cast Healing Word', spellId: 'healing-word' };
    const fetchSpy = routeFetch([castAction, healingWord, { type: 'end_turn', label: 'End turn' }]);
    const onSendMessage = vi.fn(async (_message: ChatMessage) => {});
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage, onSendText: vi.fn() }),
    );

    await waitFor(() => expect(result.current.actions).toHaveLength(3));

    await act(async () => {
      await result.current.runAction(castAction as never);
    });

    const intents = intentCalls(fetchSpy);
    expect(intents).toHaveLength(1);
    expect(intents[0].body.intent.type).toBe('spell');
  });

  it('ends the turn after the cast when the only offered bonus-action spell is narrated', async () => {
    movementHolder.remaining.mockResolvedValue(0);
    const narratedMistyStep = {
      type: 'spell',
      label: 'Misty Step',
      spellId: 'misty-step',
      narrated: true,
    };
    const fetchSpy = routeFetch([castAction, narratedMistyStep]);
    const onSendMessage = vi.fn(async (_message: ChatMessage) => {});
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage, onSendText: vi.fn() }),
    );

    await waitFor(() => expect(result.current.actions).toHaveLength(2));

    await act(async () => {
      await result.current.runAction(castAction as never);
    });

    const intents = intentCalls(fetchSpy);
    expect(intents).toHaveLength(2);
    expect(intents[1].body.intent.type).toBe('end_turn');
  });
});

describe('useCombatLegalActions inspiration (#1414)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    inspirationHolder.armed = false;
  });

  const inspirationAction = {
    type: 'inspiration',
    label: 'Spend Inspiration — advantage on your next roll',
  };

  function routeFetch(legalActions: Array<Record<string, unknown>>): MockInstance<typeof fetch> {
    return vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url: unknown, init?: unknown) => {
        const href = String(url);
        if (href.includes('/legal-actions')) {
          return {
            ok: true,
            json: async () => ({ actorId: 'pc-1', actions: legalActions }),
          } as Response;
        }
        if (href.includes('/intent')) {
          const body = JSON.parse(String((init as { body?: string }).body ?? '{}')) as {
            intent?: { type?: string };
            phase?: string;
          };
          if (body.phase === 'propose') {
            if (body.intent?.type === 'spell') {
              return {
                ok: true,
                json: async () => ({
                  proposal: {
                    movementOnly: false,
                    spellId: 'acid-arrow',
                    spellName: 'Acid Arrow',
                    kind: 'attack',
                    attackBonus: 5,
                    saveDC: 13,
                    targetAc: 11,
                    advantage: false,
                    disadvantage: false,
                    targetLabel: 'Rubble Sentinel',
                  },
                }),
              } as Response;
            }
            return {
              ok: true,
              json: async () => ({
                proposal: {
                  movementOnly: false,
                  weaponName: 'Quarterstaff',
                  targetLabel: 'Rubble Sentinel',
                  attackBonus: 5,
                  targetAc: 11,
                  advantage: false,
                  disadvantage: false,
                },
              }),
            } as Response;
          }
          return { ok: true, json: async () => ({ accepted: true, result: {} }) } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });
  }

  it('surfaces a refused attack after the player rolled and clears its result', async () => {
    vi.mocked(requestPlayerAttackRoll).mockResolvedValue({ d20: 8, rollId: 'refused-test-roll' });
    const attack = { type: 'attack', label: 'Attack', weaponId: 'sword', targetIds: ['monster-1'] };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const path = String(url);
      if (path.includes('/legal-actions'))
        return { ok: true, json: async () => ({ actorId: 'pc-1', actions: [attack] }) } as Response;
      if (path.includes('/status'))
        return { ok: true, json: async () => ({ encounter: { version: 7 } }) } as Response;
      if (path.includes('/intent')) {
        const body = JSON.parse(String(init?.body));
        if (body.phase === 'propose')
          return {
            ok: true,
            json: async () => ({ proposal: { weaponName: 'Sword', attackBonus: 5, targetAc: 14 } }),
          } as Response;
        return {
          ok: false,
          status: 422,
          json: async () => ({ error: 'Action already used this turn' }),
        } as Response;
      }
      throw new Error(`Unexpected request ${path}`);
    });
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage: vi.fn(), onSendText: vi.fn() }),
    );
    await waitFor(() => expect(result.current.actions).toHaveLength(1));
    await act(async () => {
      await result.current.runAction(result.current.actions[0]);
    });
    expect(result.current.error).toBe('Action already used this turn');
    expect(engineRollWasRefused('refused-test-roll')).toBe(true);
  });

  it('an armed attack spends nothing in runAction — the popup is the single spend site (round 2, B2)', async () => {
    inspirationHolder.armed = true;
    vi.mocked(requestPlayerAttackRoll).mockResolvedValue({ d20: 17 });
    const attackAction = {
      type: 'attack',
      label: 'Attack with Quarterstaff',
      weaponId: 'quarterstaff',
      targetIds: ['monster-1'],
    };
    const fetchSpy = routeFetch([attackAction]);
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage: vi.fn(), onSendText: vi.fn() }),
    );
    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(result.current.actions[0] as never);
    });

    // The popup spends when the die is rolled; runAction must not spend again — and a
    // typed number must not spend at all. Either way this hook never calls the spend.
    expect(inspirationHolder.spendInspiration).not.toHaveBeenCalled();
    const intents = fetchSpy.mock.calls
      .map(([, init]) => JSON.parse(String((init as { body?: string }).body ?? '{}')))
      .filter(
        (body: { phase?: string; intent?: { type?: string } }) =>
          !body.phase && body.intent?.type === 'attack',
      );
    expect(intents).toHaveLength(1);
    expect(intents[0].intent).toMatchObject({ type: 'attack', d20: 17 });
  });

  it('an armed spell attack spends nothing in runAction (round 2, B2)', async () => {
    inspirationHolder.armed = true;
    vi.mocked(requestPlayerAttackRoll).mockResolvedValue({ d20: 17 });
    const castAction = {
      type: 'spell',
      label: 'Cast Acid Arrow',
      spellId: 'acid-arrow',
      targetIds: ['monster-1'],
    };
    const fetchSpy = routeFetch([castAction]);
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage: vi.fn(), onSendText: vi.fn() }),
    );
    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(result.current.actions[0] as never);
    });

    expect(inspirationHolder.spendInspiration).not.toHaveBeenCalled();
    const intents = fetchSpy.mock.calls
      .map(([, init]) => JSON.parse(String((init as { body?: string }).body ?? '{}')))
      .filter(
        (body: { phase?: string; intent?: { type?: string } }) =>
          !body.phase && body.intent?.type === 'spell',
      );
    expect(intents).toHaveLength(1);
    expect(intents[0].intent).toMatchObject({ type: 'spell', d20: 17 });
  });

  it('arms advantage from the chip and spends nothing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/legal-actions'))
        return {
          ok: true,
          json: async () => ({ actorId: 'pc-1', actions: [inspirationAction] }),
        } as Response;
      throw new Error(`Unexpected request ${String(url)}`);
    });
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendText: vi.fn() }),
    );
    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(result.current.actions[0]);
    });

    expect(inspirationHolder.arm).toHaveBeenCalled();
    // The chip itself spends nothing: no intent, no spend call.
    expect(inspirationHolder.spendInspiration).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it('tapping the chip while armed disarms', async () => {
    inspirationHolder.armed = true;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/legal-actions'))
        return {
          ok: true,
          json: async () => ({ actorId: 'pc-1', actions: [inspirationAction] }),
        } as Response;
      throw new Error(`Unexpected request ${String(url)}`);
    });
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendText: vi.fn() }),
    );
    await waitFor(() => expect(result.current.actions).toHaveLength(1));

    await act(async () => {
      await result.current.runAction(result.current.actions[0]);
    });

    expect(inspirationHolder.disarm).toHaveBeenCalled();
    expect(inspirationHolder.arm).not.toHaveBeenCalled();
  });
});
