import type { DMHandoutAction } from './dm-response-schema.js';
import type { AssertFactInput } from '../narrative/narrative-ledger-core.js';

export type AuthoredHandout = {
  key: string;
  title: string;
  giver: string;
  body: string;
};

export type JournalHandoutEntry = {
  id: string;
  sessionId: string;
  sessionNumber: number | null;
  recipient: string | null;
  mode: 'authored' | 'improvised';
  key: string | null;
  title: string;
  body: string | null;
  giver: string;
  assetPath: string | null;
  createdAt: string;
};

export type HandoutRefusal = {
  reason: 'unknown_handout_key' | 'invalid_handout_action';
  action: DMHandoutAction;
  availableKeys?: string[];
};

export type HandoutActionDependencies = {
  findAuthored: (key: string) => Promise<AuthoredHandout | null>;
  listAuthoredKeys: () => Promise<string[]>;
  persist: (entry: Omit<JournalHandoutEntry, 'id' | 'createdAt'>) => Promise<JournalHandoutEntry>;
  recordFact: (entry: JournalHandoutEntry) => Promise<void>;
  broadcast: (entry: JournalHandoutEntry) => void;
  assetCampaignId: string;
  sessionId: string;
  sessionNumber: number | null;
  recipient: string | null;
};

/**
 * Build the engine-owned possession assertion for a delivered handout. The pre-Phase-1 ledger
 * has no character subject type yet, so the single-player party subject is keyed by the linked
 * character's canonical name until the entity re-key lands.
 */
export function buildHandoutPossessionFact(
  entry: JournalHandoutEntry,
  recipientName: string,
  sessionId: string,
  campaignId?: string,
): AssertFactInput {
  return {
    sessionId,
    campaignId,
    subjectType: 'party',
    subjectName: recipientName,
    predicate: 'possesses',
    value: {
      name: entry.title,
      description: entry.body ?? '',
    },
    knownBy: ['dm', 'player'],
    source: 'engine',
  };
}

export type CorrectiveHandoutReprompt = (
  refusal: HandoutRefusal,
) => Promise<DMHandoutAction | null>;

const isValidImprovised = (action: DMHandoutAction): boolean =>
  action.mode === 'improvised' && action.key === null && typeof action.body === 'string';

const toAssetPath = (campaignId: string, key: string): string =>
  `campaigns/${campaignId}/handouts/${key}.png`;

/**
 * Apply one authoritative, campaign-instance journal delivery per handout intent.
 * A malformed or missing canon key gets exactly one model correction; a second
 * failure is returned to the caller and is never persisted or broadcast.
 */
export async function applyDmHandoutActions(
  actions: DMHandoutAction[],
  dependencies: HandoutActionDependencies,
  correctiveReprompt?: CorrectiveHandoutReprompt,
): Promise<{ entries: JournalHandoutEntry[]; degraded: HandoutRefusal[] }> {
  const entries: JournalHandoutEntry[] = [];
  const degraded: HandoutRefusal[] = [];
  let retried = false;

  const resolve = async (
    action: DMHandoutAction,
  ): Promise<JournalHandoutEntry | HandoutRefusal> => {
    if (isValidImprovised(action)) {
      return dependencies.persist({
        sessionId: dependencies.sessionId,
        sessionNumber: dependencies.sessionNumber,
        recipient: dependencies.recipient,
        mode: 'improvised',
        key: null,
        title: action.title,
        body: action.body,
        giver: action.giver,
        assetPath: null,
      });
    }

    if (action.mode !== 'authored' || !action.key || action.body !== null) {
      return { reason: 'invalid_handout_action', action };
    }
    const authored = await dependencies.findAuthored(action.key);
    if (!authored) {
      return {
        reason: 'unknown_handout_key',
        action,
        availableKeys: await dependencies.listAuthoredKeys(),
      };
    }
    return dependencies.persist({
      sessionId: dependencies.sessionId,
      sessionNumber: dependencies.sessionNumber,
      recipient: dependencies.recipient,
      mode: 'authored',
      key: authored.key,
      title: action.title || authored.title,
      body: authored.body,
      giver: action.giver || authored.giver,
      assetPath: toAssetPath(dependencies.assetCampaignId, authored.key),
    });
  };

  for (const action of actions) {
    let result = await resolve(action);
    if ('reason' in result && !retried && correctiveReprompt) {
      retried = true;
      const correction = await correctiveReprompt(result);
      if (correction) result = await resolve(correction);
    }
    if ('reason' in result) {
      degraded.push(result);
      continue;
    }
    await dependencies.recordFact(result);
    dependencies.broadcast(result);
    entries.push(result);
  }
  return { entries, degraded };
}
