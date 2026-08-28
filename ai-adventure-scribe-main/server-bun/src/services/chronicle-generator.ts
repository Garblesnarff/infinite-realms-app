/* eslint-disable max-lines */
/* eslint-disable import/order */
import OpenAI from 'openai';
import { randomBytes } from 'crypto';
import { and, asc, eq, exists, or } from 'drizzle-orm';

import { db } from '../../../db/client';
import {
  dialogueHistory,
  gameSessions,
  campaigns,
  characters,
  sessionChronicles,
} from '../../../db/schema/index';
import { NotFoundError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { getCircuitBreaker } from '../utils/circuit-breaker.js';

// ─── Types ──────────────────────────────────────────────────────────────────

interface SessionData {
  sessionNumber: number | null;
  campaignName: string;
  characterName: string;
  characterRace: string;
  characterClass: string;
  sceneDescription: string;
  keyDialogue: string[];
}

interface ProChronicleContent {
  chapterTitle: string;
  chronicleText: string;
  previouslyOn: string;
  illustrationPrompt: string;
}

interface FreeChronicleContent {
  summaryText: string;
  previouslyOn: string;
}

// A single dialogue_history row, as needed for transcript sampling.
export interface TranscriptTurn {
  message: string;
  speakerType: string | null;
  createdAt: Date | null;
}

interface SampleTranscriptOptions {
  charBudget?: number;
  firstN?: number;
  lastN?: number;
  middleCap?: number;
}

// ─── FalAI queue response shapes ────────────────────────────────────────────

interface FalQueueResponse {
  response_url: string;
  request_id?: string;
}

interface FalStatusResponse {
  status: string;
  images?: Array<{ url: string }>;
}

const TEXT_TIMEOUT_MS = 60_000;
const IMAGE_TIMEOUT_MS = 120_000;

// ─── Transcript sampling ────────────────────────────────────────────────────
// 🐝 Issue #1681: the old chronicle generator only saw the first 3 + last 3 DM
// messages (each truncated to 300 chars), so the "Previously On" recap missed
// most of the session and every player decision. This budget-based sampler
// pulls in both speakers and the middle of the session while staying within a
// fixed character budget so we never blow the model's context window.

// Row cap applied at the DB query level — keeps the query cheap even for very
// long sessions; sampling/truncation below decides what actually makes the cut.
export const TRANSCRIPT_ROW_LIMIT = 400;

// Overall character budget for the sampled transcript fed into the prompt.
export const TRANSCRIPT_CHAR_BUDGET = 15_000;
// Number of turns at the very start of the session kept in full.
export const TRANSCRIPT_FIRST_N = 5;
// Number of turns at the very end of the session kept in full.
export const TRANSCRIPT_LAST_N = 10;
// Per-message character cap applied to the evenly-sampled middle turns.
export const TRANSCRIPT_MIDDLE_CAP = 600;

function speakerLabel(speakerType: string | null): string {
  if (speakerType === 'player') return 'Player';
  if (speakerType === 'dm') return 'DM';
  return speakerType || 'Unknown';
}

function formatTurn(turn: TranscriptTurn, cap?: number): string {
  const text = cap != null ? turn.message.slice(0, cap) : turn.message;
  return `${speakerLabel(turn.speakerType)}: ${text}`;
}

/**
 * Build a chronologically-ordered, budget-bounded transcript sample from a
 * session's dialogue turns (both DM and player messages).
 *
 * Strategy:
 * - Keep the first `firstN` turns and last `lastN` turns in full (untruncated).
 * - Evenly sample as many of the remaining "middle" turns as fit within the
 *   remaining character budget, each capped to `middleCap` characters.
 *
 * Pure function — no I/O — so it can be unit tested directly.
 */
export function sampleTranscript(
  turns: TranscriptTurn[],
  options: SampleTranscriptOptions = {},
): string[] {
  const charBudget = options.charBudget ?? TRANSCRIPT_CHAR_BUDGET;
  const firstN = options.firstN ?? TRANSCRIPT_FIRST_N;
  const lastN = options.lastN ?? TRANSCRIPT_LAST_N;
  const middleCap = options.middleCap ?? TRANSCRIPT_MIDDLE_CAP;

  if (turns.length === 0) {
    return [];
  }

  // Defensive re-sort: callers should already provide chronological order,
  // but the sampler's first/middle/last split depends on it.
  const sorted = [...turns].sort((a, b) => {
    const timeA = a.createdAt?.getTime() ?? 0;
    const timeB = b.createdAt?.getTime() ?? 0;
    return timeA - timeB;
  });

  const total = sorted.length;
  const firstCount = Math.min(firstN, total);
  const lastCount = Math.min(lastN, Math.max(0, total - firstCount));

  // [0, firstEnd) = first turns (full text), [lastStart, total) = last turns
  // (full text), [firstEnd, lastStart) = middle turns (sampled + capped).
  const firstEnd = firstCount;
  const lastStart = Math.max(firstCount, total - lastCount);

  const selected: Array<{ index: number; text: string }> = [];
  let usedChars = 0;

  for (let i = 0; i < firstEnd; i++) {
    const text = formatTurn(sorted[i]);
    selected.push({ index: i, text });
    usedChars += text.length;
  }

  for (let i = lastStart; i < total; i++) {
    const text = formatTurn(sorted[i]);
    selected.push({ index: i, text });
    usedChars += text.length;
  }

  const middleIndices: number[] = [];
  for (let i = firstEnd; i < lastStart; i++) {
    middleIndices.push(i);
  }

  if (middleIndices.length > 0 && usedChars < charBudget) {
    const remainingBudget = charBudget - usedChars;
    // Rough per-message size estimate (capped text + "Speaker: " overhead)
    // used to decide how many middle turns we can afford to sample.
    const avgTurnSize = middleCap + 10;
    const maxMiddleCount = Math.max(0, Math.floor(remainingBudget / avgTurnSize));
    const sampleCount = Math.min(middleIndices.length, maxMiddleCount);

    if (sampleCount > 0) {
      const step = middleIndices.length / sampleCount;
      const pickedIndices = new Set<number>();
      for (let k = 0; k < sampleCount; k++) {
        const pos = Math.min(middleIndices.length - 1, Math.floor(k * step));
        pickedIndices.add(middleIndices[pos]);
      }

      for (const idx of Array.from(pickedIndices).sort((a, b) => a - b)) {
        const text = formatTurn(sorted[idx], middleCap);
        if (usedChars + text.length > charBudget) {
          break;
        }
        selected.push({ index: idx, text });
        usedChars += text.length;
      }
    }
  }

  selected.sort((a, b) => a.index - b.index);
  return selected.map((s) => s.text);
}

export async function persistChronicleFailure(
  database: Pick<typeof db, 'transaction'>,
  chronicleId: string,
  error: unknown,
): Promise<void> {
  await database.transaction(async (tx) => {
    await tx
      .update(sessionChronicles)
      .set({
        status: 'failed',
        errorMessage:
          error instanceof Error ? error.message.slice(0, 500) : 'Chronicle generation failed',
        updatedAt: new Date(),
      })
      .where(eq(sessionChronicles.id, chronicleId));
  });
}

// ─── ChronicleGenerator ─────────────────────────────────────────────────────

class ChronicleGenerator {
  private client: OpenAI | null = null;

  // Mirror blog-content-generator.ts exactly
  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error('OPENROUTER_API_KEY environment variable is not set');
      }
      this.client = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
        defaultHeaders: {
          'HTTP-Referer': process.env.SITE_URL || 'https://infiniterealms.app',
          'X-Title': 'Infinite Realms Chronicles',
        },
      });
    }
    return this.client;
  }

  // ── Data fetching ──────────────────────────────────────────────────────────

  private async fetchSessionData(sessionId: string, userId: string): Promise<SessionData> {
    // 🛡️ Sentinel: Incorporate ownership check directly into the query for defense-in-depth.
    // We join with campaigns and characters to verify the user owns the session.
    // ⚡ Bolt: Parallelize independent database queries for session data and the
    // transcript sample. The transcript query fetches BOTH dm and player
    // messages (issue #1681), bounded by TRANSCRIPT_ROW_LIMIT rows — the
    // budget-based selection in `sampleTranscript` decides what actually gets
    // used, so we don't need to fetch more than that cap.
    const [sessionRows, transcriptRows] = await Promise.all([
      db
        .select({
          sessionNumber: gameSessions.sessionNumber,
          currentSceneDescription: gameSessions.currentSceneDescription,
          campaignName: campaigns.name,
          characterName: characters.name,
          characterRace: characters.race,
          characterClass: characters.class,
        })
        .from(gameSessions)
        .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
        .leftJoin(characters, eq(gameSessions.characterId, characters.id))
        .where(
          and(
            eq(gameSessions.id, sessionId),
            or(
              eq(campaigns.userId, userId),
              eq(characters.userId, userId),
              eq(characters.ownerId, userId),
            ),
          ),
        )
        .limit(1),
      db
        .select({
          message: dialogueHistory.message,
          speakerType: dialogueHistory.speakerType,
          createdAt: dialogueHistory.createdAt,
        })
        .from(dialogueHistory)
        .where(
          and(
            eq(dialogueHistory.sessionId, sessionId),
            or(
              eq(dialogueHistory.speakerType, 'dm'),
              eq(dialogueHistory.speakerType, 'player'),
              eq(dialogueHistory.speakerType, 'companion'),
            ),
            // 🛡️ Sentinel: Defense-in-depth ownership check
            exists(
              db
                .select()
                .from(gameSessions)
                .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
                .leftJoin(characters, eq(gameSessions.characterId, characters.id))
                .where(
                  and(
                    eq(gameSessions.id, dialogueHistory.sessionId),
                    or(
                      eq(campaigns.userId, userId),
                      eq(characters.userId, userId),
                      eq(characters.ownerId, userId),
                    ),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(dialogueHistory.createdAt))
        .limit(TRANSCRIPT_ROW_LIMIT),
    ]);

    const session = sessionRows[0];

    if (!session) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Session', sessionId);
    }

    const keyMoments = sampleTranscript(transcriptRows);

    return {
      sessionNumber: session?.sessionNumber ?? null,
      campaignName: session?.campaignName ?? 'Unknown Campaign',
      characterName: session?.characterName ?? 'Unknown Hero',
      characterRace: session?.characterRace ?? 'Unknown Race',
      characterClass: session?.characterClass ?? 'Unknown Class',
      sceneDescription: session?.currentSceneDescription ?? '',
      keyDialogue: keyMoments,
    };
  }

  // ── Pro chronicle ──────────────────────────────────────────────────────────

  async generateProChronicle(sessionId: string, userId: string): Promise<ProChronicleContent> {
    const data = await this.fetchSessionData(sessionId, userId);
    const client = this.getClient();

    const sessionLabel = data.sessionNumber ? `Session ${data.sessionNumber}` : 'Latest Session';

    const prompt = `You are the chronicler of "Infinite Realms," an AI-powered solo fantasy RPG.

Write a vivid fantasy prose chronicle chapter for the following game session. The chronicle is written in the third person, past tense, as if recounting a legend.

SESSION DETAILS:
- Campaign: ${data.campaignName}
- Session: ${sessionLabel}
- Hero: ${data.characterName} (${data.characterRace} ${data.characterClass})
- Scene: ${data.sceneDescription ? data.sceneDescription.slice(0, 400) : 'An adventure unfolds in the realm'}

KEY MOMENTS FROM THE SESSION (DM narration and player actions):
${data.keyDialogue.length > 0 ? data.keyDialogue.map((d, i) => `${i + 1}. ${d}`).join('\n') : '(No recorded dialogue — conjure a fitting chronicle from the session details above)'}

INSTRUCTIONS:
- Write 400-600 words of vivid, immersive fantasy prose for "chronicleText"
- Give the chapter a dramatic, evocative "chapterTitle" (e.g. "The Fall of Blackreach Keep")
- Write a "previouslyOn" recap of ~2-3 sentences starting with: "Previously, on your adventure in ${data.campaignName},"
- Write an "illustrationPrompt" for a fantasy illustration: describe the key visual scene, art style (epic fantasy, cinematic), always end with: no text no words no letters

Respond ONLY as JSON with exactly these fields:
{
  "chapterTitle": "...",
  "chronicleText": "...",
  "previouslyOn": "...",
  "illustrationPrompt": "..."
}`;

    const response = await getCircuitBreaker('chronicle:openrouter').exec(() =>
      client.chat.completions.create(
        {
          model: 'deepseek/deepseek-chat',
          max_tokens: 2000,
          temperature: 0.9,
          messages: [{ role: 'user', content: prompt }],
        },
        { signal: AbortSignal.timeout(TEXT_TIMEOUT_MS) },
      ),
    );

    const text = response.choices[0]?.message?.content || '';
    return this.parseProResponse(text, data);
  }

  // ── Free chronicle ─────────────────────────────────────────────────────────

  async generateFreeChronicle(sessionId: string, userId: string): Promise<FreeChronicleContent> {
    const data = await this.fetchSessionData(sessionId, userId);
    const client = this.getClient();

    const sessionLabel = data.sessionNumber ? `Session ${data.sessionNumber}` : 'Latest Session';

    const prompt = `You are the chronicler of "Infinite Realms," an AI-powered solo fantasy RPG.

Write a brief plain prose summary (~100 words) of the following game session.

SESSION DETAILS:
- Campaign: ${data.campaignName}
- Session: ${sessionLabel}
- Hero: ${data.characterName} (${data.characterRace} ${data.characterClass})
- Scene: ${data.sceneDescription ? data.sceneDescription.slice(0, 400) : 'An adventure unfolds in the realm'}

KEY MOMENTS FROM THE SESSION (DM narration and player actions):
${data.keyDialogue.length > 0 ? data.keyDialogue.map((d, i) => `${i + 1}. ${d}`).join('\n') : '(No recorded dialogue — write a fitting summary from the session details above)'}

INSTRUCTIONS:
- Write ~100 words of plain prose for "summaryText" — clear, engaging, third-person past tense
- Write a "previouslyOn" recap of 1-2 sentences starting with: "Previously, on your adventure in ${data.campaignName},"

Respond ONLY as JSON with exactly these fields:
{
  "summaryText": "...",
  "previouslyOn": "..."
}`;

    const response = await getCircuitBreaker('chronicle:openrouter').exec(() =>
      client.chat.completions.create(
        {
          model: 'deepseek/deepseek-chat',
          max_tokens: 600,
          temperature: 0.8,
          messages: [{ role: 'user', content: prompt }],
        },
        { signal: AbortSignal.timeout(TEXT_TIMEOUT_MS) },
      ),
    );

    const text = response.choices[0]?.message?.content || '';
    return this.parseFreeResponse(text, data);
  }

  // ── Illustration generation ────────────────────────────────────────────────

  async generateIllustration(illustrationPrompt: string): Promise<string | null> {
    const falApiKey = process.env.FAL_API_KEY;
    if (!falApiKey) {
      logger.warn({ msg: '[ChronicleGenerator] FAL_API_KEY is not set — skipping illustration' });
      return null;
    }

    try {
      // Submit to fal.ai queue
      const submitRes = await fetch('https://queue.fal.run/fal-ai/z-image/turbo', {
        method: 'POST',
        headers: {
          Authorization: 'Key ' + falApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: illustrationPrompt,
          image_size: { width: 1200, height: 630 },
          num_images: 1,
        }),
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      });

      if (!submitRes.ok) {
        const errText = await submitRes.text();
        logger.warn({
          msg: '[ChronicleGenerator] fal.ai submit failed',
          status: submitRes.status,
          body: errText,
        });
        return null;
      }

      const q = (await submitRes.json()) as FalQueueResponse;

      if (!q.response_url) {
        logger.warn({ msg: '[ChronicleGenerator] fal.ai response_url missing', q });
        return null;
      }

      // Poll for result (up to 30 attempts × 2s = 60s)
      for (let i = 0; i < 30; i++) {
        await Bun.sleep(2000);

        const pollRes = await fetch(q.response_url, {
          headers: { Authorization: 'Key ' + falApiKey },
          signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
        });

        if (!pollRes.ok) {
          logger.warn({
            msg: '[ChronicleGenerator] fal.ai poll error',
            attempt: i + 1,
            status: pollRes.status,
          });
          continue;
        }

        const r = (await pollRes.json()) as FalStatusResponse;

        if (r.status === 'IN_QUEUE' || r.status === 'IN_PROGRESS') {
          continue;
        }

        const imageUrl = r.images?.[0]?.url;
        if (imageUrl) {
          logger.info({ msg: '[ChronicleGenerator] Illustration generated', url: imageUrl });
          return imageUrl;
        }

        // Unexpected terminal status
        logger.warn({ msg: '[ChronicleGenerator] fal.ai unexpected status', status: r.status, r });
        return null;
      }

      logger.warn({ msg: '[ChronicleGenerator] fal.ai timed out after 30 polls' });
      return null;
    } catch (err) {
      logger.warn({ msg: '[ChronicleGenerator] Illustration generation failed', error: err });
      return null;
    }
  }

  // ── Token generation ───────────────────────────────────────────────────────

  generateShareToken(): string {
    return randomBytes(16).toString('hex');
  }

  // ── JSON parse helpers ─────────────────────────────────────────────────────

  private parseProResponse(text: string, data: SessionData): ProChronicleContent {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON block found in pro chronicle response');
      }
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        chapterTitle: parsed.chapterTitle || `The Chronicle of ${data.campaignName}`,
        chronicleText: parsed.chronicleText || text,
        previouslyOn:
          parsed.previouslyOn ||
          `Previously, on your adventure in ${data.campaignName}, ${data.characterName} faced great challenges.`,
        illustrationPrompt:
          parsed.illustrationPrompt ||
          `${data.characterName} the ${data.characterRace} ${data.characterClass} in an epic fantasy scene, cinematic lighting, no text no words no letters`,
      };
    } catch (error) {
      logger.error({
        msg: '[ChronicleGenerator] Failed to parse pro chronicle response',
        error,
        text,
      });
      return {
        chapterTitle: `The Chronicle of ${data.campaignName}`,
        chronicleText:
          text ||
          `${data.characterName} ventured forth into the realm, facing trials that would be remembered for ages.`,
        previouslyOn: `Previously, on your adventure in ${data.campaignName}, ${data.characterName} faced great challenges.`,
        illustrationPrompt: `${data.characterName} the ${data.characterRace} ${data.characterClass} in an epic fantasy scene, cinematic lighting, no text no words no letters`,
      };
    }
  }

  private parseFreeResponse(text: string, data: SessionData): FreeChronicleContent {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON block found in free chronicle response');
      }
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summaryText: parsed.summaryText || text,
        previouslyOn:
          parsed.previouslyOn ||
          `Previously, on your adventure in ${data.campaignName}, ${data.characterName} faced great challenges.`,
      };
    } catch (error) {
      logger.error({
        msg: '[ChronicleGenerator] Failed to parse free chronicle response',
        error,
        text,
      });
      return {
        summaryText:
          text ||
          `${data.characterName} continued their journey through ${data.campaignName}, overcoming obstacles and pressing onward.`,
        previouslyOn: `Previously, on your adventure in ${data.campaignName}, ${data.characterName} faced great challenges.`,
      };
    }
  }
}

// ── Singleton export ─────────────────────────────────────────────────────────

export const chronicleGenerator = new ChronicleGenerator();
