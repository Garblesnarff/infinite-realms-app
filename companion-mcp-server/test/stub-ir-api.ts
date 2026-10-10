/**
 * Stub of the Infinite Realms companion API for the #215 step-1 proving test.
 *
 * This wires the REAL route definitions
 * (ai-adventure-scribe-main/server-bun/src/routes/v1/companion-routes.ts)
 * into an Elysia app, injecting only the seams the routes declare:
 * auth, session-ownership verification, and the service layer. The injected
 * service is in-memory but returns the full shapes production sends
 * (CompanionPublicRow, PartyRosterMember, ActiveCompanion, RedactedScene,
 * DialogueHistory row, CompanionRollResult) — see
 * server-bun/src/services/session/companion-service.ts.
 *
 * No database, no network beyond localhost. The bearer token is a fixed
 * local-only string; it is compared, never logged.
 *
 * Note: this file deliberately does not import Elysia itself. The route
 * module brings its own copy, and Elysia's `.use()` rejects plugin
 * instances from a different copy via `instanceof`; the auth seam is
 * therefore a function plugin, which Elysia calls with its own app.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createCompanionRoutes } from '../../ai-adventure-scribe-main/server-bun/src/routes/v1/companion-routes.js';
import { BusinessLogicError, NotFoundError } from '../../ai-adventure-scribe-main/server-bun/src/lib/errors.js';
import type {
  ActiveCompanion,
  CompanionRollRequest,
  CompanionRollResult,
  PartyRosterMember,
  RedactedScene,
} from '../../ai-adventure-scribe-main/server-bun/src/services/session/companion-service.js';
import { MAX_SESSION_COMPANIONS } from '../../ai-adventure-scribe-main/shared/companion-constants.js';

export const DEMO_TOKEN = 'demo-token-for-local-proving-only';
const SESSION_ID = 'session-1';
const USER_ID = 'user-1';

process.env.COMPANIONS_ENABLED = 'true';

interface CharacterDef {
  name: string;
  class: string;
  race: string;
  level: number;
  currentHp: number;
  maxHp: number;
  armorClass: number;
}

const characters: Record<string, CharacterDef> = {
  'character-1': {
    name: 'Kael',
    class: 'Fighter',
    race: 'Human',
    level: 5,
    currentHp: 42,
    maxHp: 44,
    armorClass: 17,
  },
  'character-2': {
    name: 'Mira',
    class: 'Cleric',
    race: 'Elf',
    level: 5,
    currentHp: 31,
    maxHp: 33,
    armorClass: 15,
  },
  'character-3': {
    name: 'Bram',
    class: 'Rogue',
    race: 'Halfling',
    level: 4,
    currentHp: 28,
    maxHp: 30,
    armorClass: 14,
  },
  'character-4': {
    name: 'Sera',
    class: 'Wizard',
    race: 'Gnome',
    level: 4,
    currentHp: 22,
    maxHp: 24,
    armorClass: 12,
  },
};

interface StubCompanionRow {
  id: string;
  sessionId: string;
  characterId: string;
  controller: string;
  status: string;
  createdAt: Date;
}

const companions = new Map<string, StubCompanionRow>();

const dialogue: Array<{
  speaker_type: string | null;
  speaker_name: string | null;
  text: string;
}> = [{ speaker_type: 'dm', speaker_name: null, text: 'The tavern door swings open.' }];

let messageSeq = 0;

// Same projection as the real mapCompanion in companion-service.ts.
const mapCompanion = (companion: StubCompanionRow) => ({
  id: companion.id,
  session_id: companion.sessionId,
  character_id: companion.characterId,
  controller: companion.controller,
  status: companion.status,
  created_at: companion.createdAt,
});

function rosterFor(characterId: string): PartyRosterMember {
  const character = characters[characterId];
  return {
    name: character.name,
    class: character.class,
    race: character.race,
    level: character.level,
    current_hp: character.currentHp,
    max_hp: character.maxHp,
    conditions: [],
    armor_class: character.armorClass,
  };
}

const service = {
  join: async (sessionId: string, characterId: string): Promise<StubCompanionRow> => {
    const existing = [...companions.values()].find(
      (row) => row.sessionId === sessionId && row.characterId === characterId,
    );
    if (existing) return existing;
    // Same cap as the real CompanionService.join (companion-service.ts).
    const activeOthers = [...companions.values()].filter(
      (row) =>
        row.sessionId === sessionId &&
        row.status === 'active' &&
        row.characterId !== characterId,
    );
    if (activeOthers.length >= MAX_SESSION_COMPANIONS) {
      throw new BusinessLogicError('A session can have at most two active companions', {
        limit: MAX_SESSION_COMPANIONS,
      });
    }
    const row: StubCompanionRow = {
      id: `companion-${companions.size + 1}`,
      sessionId,
      characterId,
      controller: 'webmcp',
      status: 'active',
      createdAt: new Date('2026-10-09T12:00:00.000Z'),
    };
    companions.set(row.id, row);
    return row;
  },
  party: async (): Promise<PartyRosterMember[]> => [
    rosterFor('character-1'),
    ...[...companions.values()]
      .filter((row) => row.status === 'active')
      .map((row) => rosterFor(row.characterId)),
  ],
  activeCompanions: async (): Promise<ActiveCompanion[]> =>
    [...companions.values()]
      .filter((row) => row.status === 'active')
      .map((row) => ({
        id: row.id,
        characterId: row.characterId,
        name: characters[row.characterId].name,
        class: characters[row.characterId].class,
        level: characters[row.characterId].level,
        portraitUrl: null,
        controller: row.controller,
      })),
  leave: async (_sessionId: string, companionId: string): Promise<StubCompanionRow> => {
    const row = companions.get(companionId);
    // The real route only honors `instanceof AppError` (mapAppRouteError), so
    // the stub must throw the real NotFoundError to get production's 404.
    if (!row) throw new NotFoundError('Companion', companionId);
    row.status = 'left';
    return row;
  },
  scene: async (): Promise<RedactedScene> => ({
    campaign: {
      name: 'The Sunken Spires',
      description: 'A drowned wizard tower off the Sword Coast.',
    },
    session: {
      current_scene_description: 'Rain hammers the tavern shutters.',
      summary: 'The party seeks the drowned tower.',
    },
    party: [rosterFor('character-1')],
    dialogue_history: [...dialogue],
    combat: null,
  }),
  say: async (
    sessionId: string,
    companionId: string,
    text: string,
  ): Promise<{ id: string; sessionId: string; speakerType: string; message: string }> => {
    const row = companions.get(companionId);
    const name = row ? characters[row.characterId].name : 'Companion';
    dialogue.push({ speaker_type: 'companion', speaker_name: name, text });
    messageSeq += 1;
    return { id: `message-${messageSeq}`, sessionId, speakerType: 'companion', message: text };
  },
  roll: async (
    _sessionId: string,
    companionId: string,
    request: CompanionRollRequest,
  ): Promise<CompanionRollResult> => {
    const row = companions.get(companionId);
    const name = row ? characters[row.characterId].name : 'Companion';
    const result: CompanionRollResult = {
      d20: 14,
      modifier: 5,
      total: 19,
      breakdown: ['1d20', 'CHA +3', 'Prof +2'],
    };
    // Same transcript format as buildCompanionRollTranscript (companion-service.ts).
    const reason = request.reason ? ` — ${request.reason}` : '';
    dialogue.push({
      speaker_type: null,
      speaker_name: null,
      text: `⚙️ Engine: ${name} rolled ${request.name} (${request.kind}): d20 ${result.d20} ${result.modifier >= 0 ? '+' : ''}${result.modifier} = ${result.total} [${result.breakdown.slice(1).join(', ')}]${reason}`,
    });
    return result;
  },
};

// Mirrors the real requireAuth contract: 401 + { error, code } without a
// token, `user` in context with one. A function plugin (not an Elysia
// instance) so the route module's own Elysia copy is the only one loaded.
const stubAuth = (app: any) => {
  app.onBeforeHandle(({ request, set }: any) => {
    if (request.headers.get('authorization') !== `Bearer ${DEMO_TOKEN}`) {
      set.status = 401;
      return { error: 'Unauthorized', code: 'unauthorized' };
    }
  });
  return app.resolve(() => ({
    user: { userId: USER_ID, email: 'demo@example.test', plan: 'free' },
  }));
};

async function verifyOwnership(sessionId: string | undefined, userId: string) {
  return sessionId === SESSION_ID && userId === USER_ID
    ? { success: true as const }
    : { success: false as const, error: { status: 404, message: 'Session not found' } };
}

export interface RunningStubApi {
  url: string;
  close: () => Promise<void>;
}

export async function startStubIrApi(): Promise<RunningStubApi> {
  const app = createCompanionRoutes({
    auth: stubAuth as never,
    verifyOwnership,
    service: service as never,
    mapCompanion,
  });
  app.listen(0);
  const port = app.server?.port;
  if (!port) throw new Error('Stub IR API failed to listen');
  return {
    url: `http://localhost:${port}`,
    close: async () => {
      await app.stop();
    },
  };
}
