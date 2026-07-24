import { buildAIContext } from '@/hooks/ai/ai-utils';
import { processRollRequests } from '@/hooks/ai/roll-processor';
import { AIService } from '@/services/ai-service';
import { DiceEngine, type DiceRollResult } from '@/services/dice/DiceEngine';
import { userDataApi } from '@/services/user-data-api';
import { mapToAscii } from '../../server-bun/src/tactical/serialize';
import { buildTacticalDigest } from '../../server-bun/src/tactical/tactical-context';

import type { RollRequest } from '@/types/roll-request';

export type HeadlessEvent =
  | { type: 'narration'; text: string; provider?: 'openrouter' | 'gemini'; model?: string }
  | { type: 'options'; options: string[] }
  | { type: 'roll_request'; requests: RollRequest[] }
  | { type: 'roll_result'; request: RollRequest; result: DiceRollResult }
  | { type: 'map_state'; map: unknown; ascii: string; digest: string }
  | { type: 'error'; message: string };

export function stripAssetTags(text: string): string {
  return text.replace(/\[ASSET:[^\]]+\]/gi, '').replace(/\n{3,}/g, '\n\n').trim();
}

export function extractOptions(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim().replace(/^(?:\d+[.)]|[-*])\s+/, ''))
    .filter((line) => /^(?:\d+[.)]|[-*])\s+/.test(line));
}

/**
 * A non-React orchestrator over the exact client services used by the browser.
 * React owns presentation; this class owns only the reusable play pipeline.
 */
export class HeadlessGameClient {
  private readonly processedRolls = new Set<string>();
  private pending: RollRequest[] = [];
  private history: Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: Date }> = [];
  private turnCount = 0;

  constructor(readonly sessionId: string) {}

  async load(): Promise<void> {
    const [session, messages] = await Promise.all([
      userDataApi.getSession(this.sessionId),
      userDataApi.listSessionMessages(this.sessionId, 0, 200),
    ]);
    this.turnCount = Number(session.turn_count || 0);
    this.history = (messages.messages || []).map((message: Record<string, unknown>, index: number) => ({
      id: String(message.id || `history-${index}`),
      role: message.speaker_type === 'player' ? 'user' : 'assistant',
      content: String(message.message || ''),
      timestamp: new Date(String(message.timestamp || Date.now())),
    }));
  }

  get pendingRolls(): readonly RollRequest[] {
    return this.pending;
  }

  async play(input: string, diceRoll?: { request: RollRequest; result: DiceRollResult }): Promise<HeadlessEvent[]> {
    if (this.pending.length && !diceRoll) {
      throw new Error('Resolve the pending roll before sending another action');
    }
    const context = diceRoll
      ? { intent: 'dice_roll', diceRoll: { formula: diceRoll.result.expression, total: diceRoll.result.total, naturalRoll: diceRoll.result.naturalRoll, results: diceRoll.result.rolls.map((roll) => roll.value), advantage: !!diceRoll.result.advantage, disadvantage: !!diceRoll.result.disadvantage } }
      : { intent: this.turnCount === 0 ? 'first_action' : 'query' };
    const game = await userDataApi.getSessionContext(this.sessionId);
    const aiContext = buildAIContext({
      sessionId: this.sessionId,
      starterCampaignId: game.starter_campaign_id || undefined,
      campaign: game.campaign,
      character: game.character,
      currentPhase: 'exploration',
      isInCombat: false,
      pendingRollsCount: this.pending.length,
    });
    let provider: 'openrouter' | 'gemini' | undefined;
    let model: string | undefined;
    const nextTurnCount = this.turnCount + 1;
    const response = await AIService.chatWithDM({
      message: input,
      context: aiContext,
      conversationHistory: this.history,
      turnCount: nextTurnCount,
      onProviderResponse: (metadata) => { provider = metadata.provider; model = metadata.model; },
    });
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
    await userDataApi.saveSessionMessages(this.sessionId, { speaker_type: 'player', message: input, context, timestamp: new Date().toISOString() });
    await userDataApi.saveSessionMessages(this.sessionId, { speaker_type: 'dm', message: text, context: { roll_requests: this.pending }, timestamp: new Date().toISOString() });
    this.history.push({ id: crypto.randomUUID(), role: 'user', content: input, timestamp: new Date() });
    this.history.push({ id: crypto.randomUUID(), role: 'assistant', content: text, timestamp: new Date() });
    this.turnCount = nextTurnCount;
    await userDataApi.updateSession(this.sessionId, { turn_count: this.turnCount });
    const events: HeadlessEvent[] = [{ type: 'narration', text, provider, model }];
    const options = extractOptions(text);
    if (options.length) events.push({ type: 'options', options });
    if (this.pending.length) events.push({ type: 'roll_request', requests: this.pending });
    const map = await this.getMap();
    if (map) {
      const tacticalMap = map as Parameters<typeof mapToAscii>[0];
      events.push({ type: 'map_state', map, ascii: mapToAscii(tacticalMap), digest: buildTacticalDigest(tacticalMap) });
    }
    return events;
  }

  roll(request = this.pending[0]): { request: RollRequest; result: DiceRollResult } {
    if (!request) throw new Error('No roll is pending');
    if (/\b(?:cha|int|wis|str|dex|con|mod|modifier)\b/i.test(request.formula)) {
      throw new Error(`Cannot auto-roll unresolved formula: ${request.formula}`);
    }
    const result = DiceEngine.roll(request.formula, { advantage: request.advantage, disadvantage: request.disadvantage, purpose: request.purpose });
    this.pending = this.pending.filter((entry) => entry !== request);
    return { request, result };
  }

  async move(entityId: string, x: number, y: number): Promise<unknown> {
    const response = await fetch(`${(import.meta.env.VITE_API_URL || 'http://localhost:8888').replace(/\/$/, '')}/v1/sessions/${encodeURIComponent(this.sessionId)}/tactical-map/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await import('@/services/auth/TokenService')).getAuthHeaders() },
      body: JSON.stringify({ entityId, x, y }),
    });
    if (!response.ok) throw new Error(`Move failed (${response.status})`);
    return response.json();
  }

  async getMap(): Promise<unknown | null> {
    const response = await fetch(`${(import.meta.env.VITE_API_URL || 'http://localhost:8888').replace(/\/$/, '')}/v1/sessions/${encodeURIComponent(this.sessionId)}/tactical-map`, { headers: (await import('@/services/auth/TokenService')).getAuthHeaders() });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Tactical map failed (${response.status})`);
    return response.json();
  }
}
