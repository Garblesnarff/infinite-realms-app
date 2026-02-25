/* eslint-disable max-lines */
/* eslint-disable import/order */
import OpenAI from 'openai';
import { randomBytes } from 'crypto';
import { and, eq, asc, desc } from 'drizzle-orm';

import { db } from '../../../db/client';
import { dialogueHistory, gameSessions, campaigns, characters } from '../../../db/schema/index';
import { logger } from '../lib/logger.js';

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

// ─── FalAI queue response shapes ────────────────────────────────────────────

interface FalQueueResponse {
  response_url: string;
  request_id?: string;
}

interface FalStatusResponse {
  status: string;
  images?: Array<{ url: string }>;
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

  private async fetchSessionData(sessionId: string): Promise<SessionData> {
    // Fetch the game session with joined campaign + character in one query.
    // Note: FK columns (campaignId, characterId) are nullable, so leftJoin is used.
    // Drizzle requires nullable FK column first in eq() to get the right type.
    const sessionRows = await db
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
      .where(eq(gameSessions.id, sessionId))
      .limit(1);

    const session = sessionRows[0];

    // ⚡ Bolt: Optimized DM message fetching by replacing the full-session scan with targeted
    // parallel queries for the first and last moments. This reduces O(N) data transfer and
    // memory pressure to O(1) by only fetching the 6 messages actually used for the summary.
    const [firstMessages, lastMessages] = await Promise.all([
      db
        .select({
          message: dialogueHistory.message,
          createdAt: dialogueHistory.createdAt,
        })
        .from(dialogueHistory)
        .where(
          and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'dm'))
        )
        .orderBy(asc(dialogueHistory.createdAt))
        .limit(3),
      db
        .select({
          message: dialogueHistory.message,
          createdAt: dialogueHistory.createdAt,
        })
        .from(dialogueHistory)
        .where(
          and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'dm'))
        )
        .orderBy(desc(dialogueHistory.createdAt))
        .limit(3),
    ]);

    // Combine and re-sort to ensure chronological order for the AI prompt
    const combined = [...firstMessages, ...lastMessages].sort((a, b) => {
      const timeA = a.createdAt?.getTime() || 0;
      const timeB = b.createdAt?.getTime() || 0;
      return timeA - timeB;
    });

    const seen = new Set<string>();
    const keyMoments: string[] = [];
    for (const row of combined) {
      if (!seen.has(row.message)) {
        seen.add(row.message);
        keyMoments.push(row.message.slice(0, 300));
      }
    }

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

  async generateProChronicle(sessionId: string): Promise<ProChronicleContent> {
    const data = await this.fetchSessionData(sessionId);
    const client = this.getClient();

    const sessionLabel = data.sessionNumber ? `Session ${data.sessionNumber}` : 'Latest Session';

    const prompt = `You are the chronicler of "Infinite Realms," an AI-powered solo fantasy RPG.

Write a vivid fantasy prose chronicle chapter for the following game session. The chronicle is written in the third person, past tense, as if recounting a legend.

SESSION DETAILS:
- Campaign: ${data.campaignName}
- Session: ${sessionLabel}
- Hero: ${data.characterName} (${data.characterRace} ${data.characterClass})
- Scene: ${data.sceneDescription ? data.sceneDescription.slice(0, 400) : 'An adventure unfolds in the realm'}

KEY MOMENTS FROM THE SESSION (DM narration):
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

    const response = await client.chat.completions.create({
      model: 'moonshotai/kimi-k2-0905',
      max_tokens: 2000,
      temperature: 0.9,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.choices[0]?.message?.content || '';
    return this.parseProResponse(text, data);
  }

  // ── Free chronicle ─────────────────────────────────────────────────────────

  async generateFreeChronicle(sessionId: string): Promise<FreeChronicleContent> {
    const data = await this.fetchSessionData(sessionId);
    const client = this.getClient();

    const sessionLabel = data.sessionNumber ? `Session ${data.sessionNumber}` : 'Latest Session';

    const prompt = `You are the chronicler of "Infinite Realms," an AI-powered solo fantasy RPG.

Write a brief plain prose summary (~100 words) of the following game session.

SESSION DETAILS:
- Campaign: ${data.campaignName}
- Session: ${sessionLabel}
- Hero: ${data.characterName} (${data.characterRace} ${data.characterClass})
- Scene: ${data.sceneDescription ? data.sceneDescription.slice(0, 400) : 'An adventure unfolds in the realm'}

KEY MOMENTS FROM THE SESSION (DM narration):
${data.keyDialogue.length > 0 ? data.keyDialogue.map((d, i) => `${i + 1}. ${d}`).join('\n') : '(No recorded dialogue — write a fitting summary from the session details above)'}

INSTRUCTIONS:
- Write ~100 words of plain prose for "summaryText" — clear, engaging, third-person past tense
- Write a "previouslyOn" recap of 1-2 sentences starting with: "Previously, on your adventure in ${data.campaignName},"

Respond ONLY as JSON with exactly these fields:
{
  "summaryText": "...",
  "previouslyOn": "..."
}`;

    const response = await client.chat.completions.create({
      model: 'moonshotai/kimi-k2-0905',
      max_tokens: 600,
      temperature: 0.8,
      messages: [{ role: 'user', content: prompt }],
    });

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
