/* eslint-disable max-lines -- one turn pipeline shared by the CLI and the browser. */
import { mapToAscii } from '../../server-bun/src/tactical/serialize';
import { buildTacticalDigest } from '../../server-bun/src/tactical/tactical-context';

import type { InitiativeOrderEntry } from '../../server-bun/src/services/combat/initiative-order';
import type { RollRequest } from '@/types/roll-request';

import { buildAIContext } from '@/hooks/ai/ai-utils';
import { processRollRequests } from '@/hooks/ai/roll-processor';
import { AIService } from '@/services/ai-service';
import { combatStartErrorFromResponse } from '@/services/combat/combat-start-failure';
import { startStructuredCombatTransition } from '@/services/combat/structured-combat-transition';
import { DiceEngine, type DiceRollResult } from '@/services/dice/DiceEngine';
import { extractHeadlessOptions } from '@/services/headless-game-options';
import { userDataApi } from '@/services/user-data-api';
import { resolveFormulaForCharacter } from '@/utils/roll-request/formula-utils';

export type HeadlessEvent =
  | { type: 'narration'; text: string; provider?: 'openrouter' | 'gemini'; model?: string }
  | { type: 'options'; options: string[] }
  | { type: 'roll_request'; requests: RollRequest[] }
  | { type: 'roll_result'; request: RollRequest; result: DiceRollResult }
  | {
      type: 'map_state';
      map: unknown;
      ascii: string;
      digest: string;
      initiative: InitiativeOrderEntry[];
    }
  | { type: 'error'; message: string };

export function stripAssetTags(text: string): string {
  return text
    .replace(/\[ASSET:[^\]]+\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export class ContractViolationError extends Error {
  readonly category = 'contract';

  constructor(message: string) {
    super(message);
    this.name = 'ContractViolationError';
  }
}

export type HeadlessRollOutcome =
  | { skipped: false; request: RollRequest; result: DiceRollResult }
  | { skipped: true; request: RollRequest; error: ContractViolationError };
export type CompletedHeadlessRoll = Extract<HeadlessRollOutcome, { skipped: false }>;

/**
 * A non-React orchestrator over the exact client services used by the browser.
 * React owns presentation; this class owns only the reusable play pipeline.
 */
export class HeadlessGameClient {
  private readonly processedRolls = new Set<string>();
  private pending: RollRequest[] = [];
  private options: string[] = [];
  private history: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }> = [];
  private turnCount = 0;
  private character: Record<string, unknown> = {};
  private combatActive = false;

  constructor(readonly sessionId: string) {}

  async load(): Promise<void> {
    const [session, messages] = await Promise.all([
      userDataApi.getSession(this.sessionId),
      userDataApi.listSessionMessages(this.sessionId, 0, 200),
    ]);
    this.turnCount = Number(session.turn_count || 0);
    this.history = (messages.messages || []).map(
      (message: Record<string, unknown>, index: number) => ({
        id: String(message.id || `history-${index}`),
        role: message.speaker_type === 'player' ? 'user' : 'assistant',
        content: String(message.message || ''),
        timestamp: new Date(String(message.timestamp || Date.now())),
      }),
    );
    this.combatActive = Boolean(await this.getMap());
  }

  get pendingRolls(): readonly RollRequest[] {
    return this.pending;
  }

  get availableOptions(): readonly string[] {
    return this.options;
  }

  /**
   * One turn. Any failure after the LLM has answered is re-thrown with the provider/model
   * that served it attached, so a failed turn still lands in provider telemetry.
   */
  async play(
    input: string,
    diceRollBatch?: readonly CompletedHeadlessRoll[],
  ): Promise<HeadlessEvent[]> {
    const telemetry: { provider?: 'openrouter' | 'gemini'; model?: string } = {};
    try {
      return await this.runTurn(input, diceRollBatch, telemetry);
    } catch (error) {
      throw this.withTelemetry(error as object, telemetry.provider, telemetry.model);
    }
  }

  private async runTurn(
    input: string,
    diceRollBatch: readonly CompletedHeadlessRoll[] | undefined,
    telemetry: { provider?: 'openrouter' | 'gemini'; model?: string },
  ): Promise<HeadlessEvent[]> {
    const diceRolls = diceRollBatch || [];
    const diceRoll = diceRolls.at(-1);
    if (this.pending.length && !diceRolls.length) {
      throw new Error('Resolve the pending roll before sending another action');
    }
    const rollMessages = diceRolls.map((roll) => this.formatRoll(roll));
    const isUnresolvableContinuation = input === 'I attempt it.';
    const effectiveInput = isUnresolvableContinuation ? input : rollMessages.at(-1) || input;
    const priorRollMessages = isUnresolvableContinuation ? rollMessages : rollMessages.slice(0, -1);
    const priorRollHistory = priorRollMessages.map((content, index) => ({
      id: `roll-${crypto.randomUUID()}-${index}`,
      role: 'user' as const,
      content,
      timestamp: new Date(),
    }));
    const context = diceRoll
      ? { intent: 'dice_roll', diceRoll: this.rollContext(diceRoll) }
      : { intent: this.turnCount === 0 ? 'first_action' : 'query' };
    const game = await userDataApi.getSessionContext(this.sessionId);
    this.character = game.character;
    const aiContext = buildAIContext({
      sessionId: this.sessionId,
      starterCampaignId: game.starter_campaign_id || undefined,
      campaign: game.campaign,
      character: game.character,
      currentPhase: 'exploration',
      isInCombat: this.combatActive,
      pendingRollsCount: this.pending.length,
    });
    const nextTurnCount = this.turnCount + 1;
    const response = await AIService.chatWithDM({
      message: effectiveInput,
      context: aiContext,
      conversationHistory: [...this.history, ...priorRollHistory],
      turnCount: nextTurnCount,
      onProviderResponse: (metadata) => {
        telemetry.provider = metadata.provider;
        telemetry.model = metadata.model;
      },
    });
    if (!response || typeof response.text !== 'string' || !response.text.trim()) {
      throw new ContractViolationError('DM response is missing a non-empty text field');
    }
    if (response.roll_requests !== undefined && !Array.isArray(response.roll_requests)) {
      throw new ContractViolationError('DM response roll_requests field is not an array');
    }
    if (response.combat_transition === 'start' && response.scene_spec) {
      const startResponse = await startStructuredCombatTransition(
        this.sessionId,
        this.character,
        response as Parameters<typeof startStructuredCombatTransition>[2],
      );
      if (!startResponse?.ok) {
        // Carries the DM envelope and the server's body so the transcript records what was
        // actually attempted, not just a status code.
        throw await combatStartErrorFromResponse(startResponse, response);
      }
      this.combatActive = true;
    } else if (response.combat_transition === 'end') {
      const endResponse = await userDataApi.endTacticalMap(this.sessionId);
      if (!endResponse.ok) throw new Error(`Structured combat end failed (${endResponse.status})`);
      this.combatActive = false;
    }
    if (response.map_actions?.length) {
      const actionResponse = await userDataApi.applyDmTacticalActions(
        this.sessionId,
        response.map_actions as Parameters<typeof userDataApi.applyDmTacticalActions>[1],
      );
      if (!actionResponse.ok)
        throw new Error(`DM tactical action batch failed (${actionResponse.status})`);
    }
    const processed = await processRollRequests({
      responseText: response.text,
      existingRequests: (response.roll_requests || []) as RollRequest[],
      isDiceRollMessage: Boolean(diceRoll),
      processedSet: this.processedRolls,
      aiContext,
      sessionId: this.sessionId,
      characterId: String(game.character.id || 'player'),
    });
    this.pending = processed.playerRollRequests;
    const text = stripAssetTags(response.text);
    for (let index = 0; index < priorRollMessages.length; index += 1) {
      await userDataApi.saveSessionMessages(this.sessionId, {
        speaker_type: 'player',
        message: priorRollMessages[index],
        context: { intent: 'dice_roll', diceRoll: this.rollContext(diceRolls[index]) },
        timestamp: new Date().toISOString(),
      });
    }
    await userDataApi.saveSessionMessages(this.sessionId, {
      speaker_type: 'player',
      message: effectiveInput,
      context,
      timestamp: new Date().toISOString(),
    });
    await userDataApi.saveSessionMessages(this.sessionId, {
      speaker_type: 'dm',
      message: text,
      context: { roll_requests: this.pending },
      timestamp: new Date().toISOString(),
    });
    this.history.push(...priorRollHistory);
    this.history.push({
      id: crypto.randomUUID(),
      role: 'user',
      content: effectiveInput,
      timestamp: new Date(),
    });
    this.history.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: text,
      timestamp: new Date(),
    });
    this.turnCount = nextTurnCount;
    await userDataApi.updateSession(this.sessionId, { turn_count: this.turnCount });
    const events: HeadlessEvent[] = [
      { type: 'narration', text, provider: telemetry.provider, model: telemetry.model },
    ];
    this.options = extractHeadlessOptions(text, response.options);
    if (this.options.length) events.push({ type: 'options', options: this.options });
    if (this.pending.length) events.push({ type: 'roll_request', requests: this.pending });
    const map = await this.getMap();
    if (map) {
      const tacticalMap = map as Parameters<typeof mapToAscii>[0];
      events.push({
        type: 'map_state',
        map,
        ascii: mapToAscii(tacticalMap),
        digest: buildTacticalDigest(tacticalMap),
        initiative: await this.getInitiativeOrder(),
      });
    }
    return events;
  }

  roll(request = this.pending[0]): HeadlessRollOutcome {
    if (!request) throw new Error('No roll is pending');
    const formula = resolveFormulaForCharacter(
      request.formula,
      this.character,
      request.purpose,
      request.type,
    );
    this.pending = this.pending.filter((entry) => entry !== request);
    if (!formula) {
      return {
        skipped: true,
        request,
        error: new ContractViolationError(
          `Cannot auto-roll unresolved formula: ${request.formula}`,
        ),
      };
    }
    const result = DiceEngine.roll(formula, {
      advantage: request.advantage,
      disadvantage: request.disadvantage,
      purpose: request.purpose,
    });
    return { skipped: false, request, result };
  }

  /**
   * A turn that fails *after* the LLM answered still consumed a provider call. Attaching the
   * telemetry to the error is what lets the auto-play loop attribute failed turns to a
   * provider/model instead of losing them from the totals entirely.
   */
  private withTelemetry<T extends object>(error: T, provider?: string, model?: string): T {
    return Object.assign(error, provider ? { provider, model } : {});
  }

  private rollContext(diceRoll: { request: RollRequest; result: DiceRollResult }) {
    return {
      formula: diceRoll.result.expression,
      total: diceRoll.result.total,
      naturalRoll: diceRoll.result.naturalRoll,
      results: diceRoll.result.rolls.map((roll) => roll.value),
      advantage: !!diceRoll.result.advantage,
      disadvantage: !!diceRoll.result.disadvantage,
    };
  }

  private formatRoll({
    request,
    result,
  }: {
    request: RollRequest;
    result: DiceRollResult;
  }): string {
    let formatted = `${request.purpose}: ${result.total}`;
    if (
      result.naturalRoll !== undefined &&
      (result.modifiers !== 0 || result.naturalRoll !== result.total)
    ) {
      formatted += ` (nat ${result.naturalRoll}${result.modifiers >= 0 ? '+' : ''}${result.modifiers})`;
    }
    if (result.advantage) formatted += ' [ADV]';
    if (result.disadvantage) formatted += ' [DIS]';
    const target = request.type === 'attack' ? request.ac : request.dc;
    if (target !== undefined && target !== null) formatted += result.total >= target ? ' ✓' : ' ✗';
    if (request.type === 'attack' && result.naturalRoll === 20) formatted += ' CRITICAL HIT!';
    if (request.type === 'attack' && result.naturalRoll === 1) formatted += ' Critical Miss';
    return formatted;
  }

  async move(entityId: string, x: number, y: number): Promise<unknown> {
    const response = await fetch(
      `${(import.meta.env.VITE_API_URL || 'http://localhost:8888').replace(/\/$/, '')}/v1/sessions/${encodeURIComponent(this.sessionId)}/tactical-map/move`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await import('@/services/auth/TokenService')).getAuthHeaders(),
        },
        body: JSON.stringify({ entityId, x, y }),
      },
    );
    if (!response.ok) throw new Error(`Move failed (${response.status})`);
    return response.json();
  }

  /** The whole order, monsters included; an unavailable encounter degrades to an empty list. */
  async getInitiativeOrder(): Promise<InitiativeOrderEntry[]> {
    try {
      const response = await userDataApi.getActiveCombat(this.sessionId);
      if (!response.ok) return [];
      const payload = (await response.json()) as { initiativeOrder?: InitiativeOrderEntry[] };
      return payload.initiativeOrder ?? [];
    } catch {
      // Turn order is reporting, never gameplay: a lookup failure must not lose the turn.
      return [];
    }
  }

  async getMap(): Promise<unknown | null> {
    const response = await fetch(
      `${(import.meta.env.VITE_API_URL || 'http://localhost:8888').replace(/\/$/, '')}/v1/sessions/${encodeURIComponent(this.sessionId)}/tactical-map`,
      { headers: (await import('@/services/auth/TokenService')).getAuthHeaders() },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Tactical map failed (${response.status})`);
    return response.json();
  }
}
