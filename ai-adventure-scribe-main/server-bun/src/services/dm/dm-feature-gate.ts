/**
 * The server refuses a class feature or a spell the player's character does not have (#2718).
 *
 * Before this, only the prompt gated it, so the ruling depended on the model: a level-1 Fighter's
 * Action Surge (a level-2 feature) went through silently, and a Rogue with no spellcasting cast
 * Detect Thoughts against a save the DM invented. The reply is checked here, after generation and
 * before it is persisted or returned, against one allowlist built from the character:
 *
 * - features: `class_features_library` for the character's class, cumulative to their level
 *   (`ClassFeaturesService`), extended by any `character_features` rows granted to them;
 * - spells: what the character can cast now (`castableSpells`, #217), and a spell the catalog
 *   does not hold ("Witch Bolt") is checked too, when a caster names it as a spell (`spellsNamed`).
 *
 * Only the player's own claim triggers it: a spell after a cast verb or a feature after a use verb,
 * in `player_input` or in the purpose of a roll the player makes for their own action. Never the
 * narration, and never a save — an NPC casting Detect Thoughts on the player is the DM's to narrate. On a mismatch the
 * reply becomes one standard refusal line and nothing else the client acts on: no effect applies
 * and nothing is spent. A check that cannot run fails open.
 */

import { castableSpells, castsSpells, spellKey, spellsNamed } from './castable-spells.js';
import { parseLlmEnvelope } from './dm-response-schema.js';
import { getSpellByName } from '../../data/spellData.js';
import { logger } from '../../lib/logger.js';

import type { characters } from '../../../../db/schema/index';
import type { LLMResponse } from '../llm-provider-service.js';

// Database imports stay inside the functions, as in dm-reply-persistence.ts: /v1/llm/generate
// imports this module, and its route contract tests load without an application database.

/** The one line a refused claim gets. */
export function featureRefusalLine(characterName: string, claim: string): string {
  return `${characterName} can't use ${claim}: it isn't on their character sheet.`;
}

/** "Action Surge (two uses)" and "Destroy Undead (CR 1)" are the same feature to a player. */
const baseFeatureName = (name: string): string => name.replace(/\s*\(.*\)\s*$/, '').trim();

/**
 * What a sentence claims: the name after a verb. A spell is claimed only by casting it ("I cast
 * Detect Thoughts on him"); a feature only by using it ("I use Action Surge and swing again").
 * "Use" never names a spell — "I use my shield to block" is not the Shield spell — and a name
 * with no verb in front is prose: "a stroke of luck", "Investigation to find traps".
 */
const phraseAfter = (
  verbs: string,
  before = '(?:my\\s+|the\\s+spell\\s+|the\\s+|a\\s+|an\\s+)?',
): RegExp =>
  new RegExp(
    `\\b(?:${verbs})\\s+${before}(.+?)(?=\\s+(?:on|at|upon|toward|towards|into|against|to|and|then|while|again|with|in|as)\\b|[.,!?;:]|$)`,
    'gi',
  );
const CAST_PHRASE = phraseAfter('cast|casts|casting');
/**
 * A spell the catalog does not hold is claimed only in the player's own words, named straight
 * after the verb: "I cast Witch Bolt". "I cast the Amulet of Kings into the fire" is an object,
 * and a model's roll purpose ("Casting Net Attack") is not the player's claim.
 */
const NAMED_CAST_PHRASE = phraseAfter(
  'cast|casts|casting',
  '(?:the\\s+spell\\s+)?(?!(?:my|the|a|an|his|her|their|our|your|some)\\s)',
);
const USE_PHRASE = phraseAfter(
  'use|uses|using|activate|activates|activating|invoke|invokes|invoking',
);

const phrasesAfter = (pattern: RegExp, text: string): string[] =>
  [...text.matchAll(pattern)].map((match) => (match[1] ?? '').trim()).filter(Boolean);

type RollRequestLike = { type?: unknown; purpose?: unknown };
type CharacterRow = typeof characters.$inferSelect;

/** The player's own claims: their input, and the purposes of rolls for their own action. */
function claimTexts(playerInput: string | undefined, envelope: Record<string, unknown>): string[] {
  const rolls = Array.isArray(envelope.roll_requests)
    ? (envelope.roll_requests as RollRequestLike[])
    : [];
  return [
    typeof playerInput === 'string' ? playerInput : '',
    // A save resists someone else's effect; it is never the player's own feature or spell.
    ...rolls
      .filter((roll) => roll && roll.type !== 'save' && typeof roll.purpose === 'string')
      .map((roll) => String(roll.purpose)),
  ];
}

interface LibraryFeature {
  id: string;
  className: string;
  featureName: string;
  levelAcquired: number;
  usageType: string | null;
}

/** Read on a turn that claims a feature, never otherwise (a "use" verb is rare). */
async function loadLibrary(): Promise<LibraryFeature[]> {
  const { ClassFeaturesService } = await import('../class-features-service.js');
  return (await ClassFeaturesService.getFeaturesLibrary()) as LibraryFeature[];
}

/** The session's character, only when the session and the character are this user's. */
async function ownedSessionCharacter(
  sessionId: string,
  userId: string,
): Promise<CharacterRow | null> {
  const { db } = await import('../../../../db/client');
  const { and, eq, or } = await import('drizzle-orm');
  const { campaigns, characters, gameSessions } = await import('../../../../db/schema/index');
  const [row] = await db
    .select({ character: characters })
    .from(gameSessions)
    .innerJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
    .innerJoin(characters, eq(gameSessions.characterId, characters.id))
    .where(
      and(
        eq(gameSessions.id, sessionId),
        eq(campaigns.userId, userId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
      ),
    )
    .limit(1);
  return row?.character ?? null;
}

export interface FeatureGateInput {
  result: LLMResponse;
  userId: string;
  sessionId: string | undefined;
  playerInput: string | undefined;
  /** In combat the engine already refuses a spell not on the sheet; only features are checked. */
  inCombat?: boolean;
  /** `combatEntry.player.characterId`: client-supplied, so it is logged, never trusted. */
  clientCharacterId?: string | null;
}

/**
 * Fails open: the generation is already paid for, so a check that cannot run logs and lets the
 * reply through rather than costing the player their turn.
 */
export async function refuseFeaturesCharacterLacks(input: FeatureGateInput): Promise<LLMResponse> {
  try {
    return await checkClaims(input);
  } catch (error) {
    logger.warn({ msg: 'DM_FEATURE_CHECK_FAILED', sessionId: input.sessionId, error });
    return input.result;
  }
}

async function checkClaims(input: FeatureGateInput): Promise<LLMResponse> {
  const { result, userId, sessionId } = input;
  if (result.error || !sessionId) return result;
  const envelope = parseLlmEnvelope(result.text);
  if (!envelope) return result;

  // No cast or use verb, no claim, and no database work.
  const texts = claimTexts(input.playerInput, envelope);
  const castPhrases = texts.flatMap((text) => phrasesAfter(CAST_PHRASE, text));
  const usePhrases = texts.flatMap((text) => phrasesAfter(USE_PHRASE, text));
  if (!castPhrases.length && !usePhrases.length) return result;

  const named = input.inCombat ? [] : spellsNamed(input.playerInput ?? '', NAMED_CAST_PHRASE);
  let claimedSpells = input.inCombat
    ? []
    : [
        ...new Set([
          ...(castPhrases
            .map((phrase) => getSpellByName(phrase)?.name)
            .filter(Boolean) as string[]),
          ...named.map((spell) => spell.name),
        ]),
      ];
  const library = usePhrases.length ? await loadLibrary() : [];
  if (usePhrases.length && !library.length) {
    // An unseeded library makes every class uncovered; say so rather than refuse nothing quietly.
    logger.info({ msg: 'DM_FEATURE_CHECK_UNCOVERED', sessionId, reason: 'library_empty' });
  }
  // Only a feature a character uses can be claimed; a passive one is never "used".
  const usable = [
    ...new Set(
      library
        .filter((feature) => feature.usageType && feature.usageType !== 'passive')
        .map((feature) => baseFeatureName(feature.featureName)),
    ),
  ];
  const claimedFeatures = usable.filter((name) =>
    usePhrases.some((phrase) => phrase.toLowerCase() === name.toLowerCase()),
  );
  if (!claimedFeatures.length && !claimedSpells.length) return result;

  const character = await ownedSessionCharacter(sessionId, userId);
  if (!character) {
    logger.warn({
      msg: 'DM_FEATURE_CHECK_SKIPPED',
      sessionId,
      reason: 'no_owned_session_character',
      clientCharacterIdOffered: Boolean(input.clientCharacterId),
      claimedFeatures,
      claimedSpells,
    });
    return result;
  }
  // Only `characters.class` is read below; for a multiclass character that could refuse a feature
  // their other class grants, and a false refusal is worse than a missed one.
  if (Array.isArray(character.classLevels) && character.classLevels.length > 1) {
    logger.info({ msg: 'DM_FEATURE_CHECK_SKIPPED', sessionId, reason: 'multiclass' });
    return result;
  }

  const className = (character.class ?? '').toLowerCase();
  const classRows = library.filter((feature) => feature.className.toLowerCase() === className);
  let refusedFeatures: string[] = [];
  if (claimedFeatures.length && !classRows.length) {
    // A class the library does not cover gets no feature refusal: nothing says what it has.
    logger.info({ msg: 'DM_FEATURE_CHECK_UNCOVERED', sessionId, className: character.class });
  } else if (claimedFeatures.length) {
    const { ClassFeaturesService } = await import('../class-features-service.js');
    const grantedIds = new Set(
      (await ClassFeaturesService.getCharacterFeatures(character.id, userId)).map(
        (row) => row.featureId,
      ),
    );
    const allowed = new Set(
      [
        ...classRows.filter((feature) => feature.levelAcquired <= character.level),
        ...library.filter((feature) => grantedIds.has(feature.id)),
      ].map((feature) => baseFeatureName(feature.featureName).toLowerCase()),
    );
    refusedFeatures = claimedFeatures.filter((name) => !allowed.has(name.toLowerCase()));
  }

  if (!castsSpells(character)) {
    // A name the catalog does not hold is a spell only from a caster: "Fishing Line" is a line.
    const offCatalog = named.filter((spell) => spell.offCatalog).map((spell) => spell.name);
    claimedSpells = claimedSpells.filter((name) => !offCatalog.includes(name));
  }
  let refusedSpells: string[] = [];
  if (claimedSpells.length) {
    const castable = new Set((await castableSpells(character)).map(spellKey));
    refusedSpells = claimedSpells.filter((name) => !castable.has(spellKey(name)));
  }

  const refused = [...refusedFeatures, ...refusedSpells];
  if (!refused.length) return result;

  logger.warn({
    msg: 'DM_FEATURE_REFUSED',
    sessionId,
    characterId: character.id,
    className: character.class,
    level: character.level,
    refusedFeatures,
    refusedSpells,
  });
  // Every field the client acts on is emptied: no roll, no combat action, no map or handout
  // change, no combat start (the entry gate's pending handoff included). The refusal line is the
  // whole turn.
  const { combat_entry_pending: _pending, combat_exits: _exits, ...rest } = envelope;
  return {
    ...result,
    text: JSON.stringify({
      ...rest,
      text: featureRefusalLine(character.name, refused[0] ?? ''),
      options: [],
      narration_segments: [],
      roll_requests: [],
      combat_actions: [],
      combatants: [],
      map_actions: [],
      handout_actions: [],
      scene_spec: null,
      combat_transition: 'none',
    }),
  };
}
