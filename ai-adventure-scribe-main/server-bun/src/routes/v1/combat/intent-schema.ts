/**
 * The combat-intent contract, and the sentence the route says when a body fails it.
 *
 * Kept beside the route rather than inside it because the rejection report is derived from
 * these schemas — it reads their own `required` lists and `type` literals — and that only
 * stays true if the two live together.
 */
import { getSchemaValidator, t } from 'elysia';

const participantId = t.String({ minLength: 1, maxLength: 255 });
const expectedVersion = t.Number({ minimum: 0 });

// Intents that mutate the encounter carry an optimistic-concurrency token; `move` and
// `end_turn` do not, in either dialect.
const unversionedIntentVariants = [
  t.Object({ type: t.Literal('move'), actorId: participantId, x: t.Number(), y: t.Number() }),
  t.Object({ type: t.Literal('end_turn'), actorId: participantId }),
];

const attackFields = {
  type: t.Literal('attack'),
  actorId: participantId,
  targetId: participantId,
  weaponId: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  advantage: t.Optional(t.Boolean()),
  disadvantage: t.Optional(t.Boolean()),
  // The player's own attack die. Bounded to a real d20 face here as well as in the service:
  // a body carrying `d20: 40` is a malformed payload, not a lucky roll.
  d20: t.Optional(t.Number({ minimum: 1, maximum: 20 })),
};

const spellFields = {
  type: t.Literal('spell'),
  actorId: participantId,
  targetIds: t.Array(participantId, { minItems: 1, maxItems: 100 }),
  spellId: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  spellName: t.String({ minLength: 1, maxLength: 255 }),
  slotLevel: t.Optional(t.Union([t.Number({ minimum: 1, maximum: 9 }), t.Null()])),
  // Like weapon attacks, spell-attack popups may supply the player's kept natural d20. Save
  // spells ignore this field; the resolver still owns save rolls, DCs, damage, and HP writes.
  d20: t.Optional(t.Number({ minimum: 1, maximum: 20 })),
};

const defensiveFields = {
  type: t.Union([
    t.Literal('dash'),
    t.Literal('dodge'),
    t.Literal('disengage'),
    // #2580: the player's own exits. Carried on the same machinery as the DM's `combat_exits`,
    // so a fight the player abandons reaches the same conclusion the guard already accepts.
    t.Literal('flee'),
    t.Literal('yield'),
  ]),
  actorId: participantId,
};

/**
 * Player dialect: `expectedVersion` is REQUIRED. Optimistic concurrency exists to arbitrate
 * racing player clients — two browsers on the same encounter — and a player intent that does
 * not say which version it read is a lost-update waiting to happen.
 */
/**
 * The mid-combat ability check (#2420).
 *
 * A check costs the action like an attack, so it carries `expectedVersion` in the player
 * dialect for the same reason the attack variant does. `d20` is the player's kept die when the
 * roll dialog rolled it, bounded to a real d20 face exactly as the attack die is — a body
 * carrying `d20: 40` is a malformed payload, not a lucky roll. Absent means the engine rolls it.
 *
 * `shoveOutcome` is the SRD's "either knock the target prone or push it 5 feet" choice the player
 * makes in the confirm; absent means prone, the default the rules name first.
 */
const checkFields = {
  type: t.Literal('check'),
  actorId: participantId,
  /** Absent for a hide, which is measured against everyone in the room. */
  targetId: t.Optional(participantId),
  /** Which check the player declared. */
  checkKind: t.Union([
    t.Literal('shove'),
    t.Literal('grapple'),
    t.Literal('escape'),
    t.Literal('hide'),
    t.Literal('parley'),
  ]),
  /** Which Charisma skill a parley used; ignored by the other three kinds. */
  parleySkill: t.Optional(t.Union([t.Literal('persuade'), t.Literal('intimidate')])),
  shoveOutcome: t.Optional(t.Union([t.Literal('prone'), t.Literal('push')])),
  d20: t.Optional(t.Number({ minimum: 1, maximum: 20 })),
};

const playerCombatIntentSchema = t.Union([
  ...unversionedIntentVariants,
  t.Object({ ...attackFields, expectedVersion }),
  t.Object({ ...spellFields, expectedVersion }),
  t.Object({ ...checkFields, expectedVersion }),
  t.Object({ ...defensiveFields, expectedVersion }),
]);

/**
 * DM dialect: the same variants, with `expectedVersion` demoted to optional. A DM-sourced
 * intent has no racing peer — the server dispatch IS the authoritative sequencer — so when the
 * field is absent the handler reads the encounter's current version instead of rejecting.
 *
 * Deliberately a separate variant rather than making the field optional on one shared schema:
 * a player client that forgets its version must still be told so.
 */
const dmCombatIntentSchema = t.Union([
  ...unversionedIntentVariants,
  t.Object({ ...attackFields, expectedVersion: t.Optional(expectedVersion) }),
  t.Object({ ...spellFields, expectedVersion: t.Optional(expectedVersion) }),
  t.Object({ ...checkFields, expectedVersion: t.Optional(expectedVersion) }),
  t.Object({ ...defensiveFields, expectedVersion: t.Optional(expectedVersion) }),
]);

/**
 * Where the action came from (#2305). `source` names the dialect the body speaks and is `dm` for
 * every client-submitted intent, the player's own casts included, so it cannot answer "who
 * initiated this". `origin` can: the first four are this turn's player input; `dm` and `repair`
 * are producers that must never act for the player.
 */
export const COMBAT_ACTION_ORIGINS = [
  'typed',
  'sheet_cast',
  'action_bar',
  'dice_roll',
  'dm',
  'repair',
] as const;
export type CombatActionOrigin = (typeof COMBAT_ACTION_ORIGINS)[number];
const originField = t.Optional(t.Union(COMBAT_ACTION_ORIGINS.map((origin) => t.Literal(origin))));

/** The contract. Which dialect applies is decided by `source`, and by nothing else. */
const combatIntentRequestSchema = t.Union([
  t.Object({
    source: t.Literal('dm'),
    // Keep the existing route-level error response for a missing intent.
    intent: t.Optional(dmCombatIntentSchema),
    dmStartedAt: t.Optional(t.Number({ minimum: 0 })),
    phase: t.Optional(t.Union([t.Literal('propose'), t.Literal('commit')])),
    origin: originField,
  }),
  t.Object({
    source: t.Optional(t.Literal('player')),
    intent: t.Optional(playerCombatIntentSchema),
    dmStartedAt: t.Optional(t.Number({ minimum: 0 })),
    phase: t.Optional(t.Union([t.Literal('propose'), t.Literal('commit')])),
    origin: originField,
  }),
]);

/**
 * The envelope Elysia is allowed to reject on its own — deliberately permissive, so that a
 * body which merely fails the *intent* contract reaches the handler and gets an answer that
 * names what was wrong. Combat start does the same thing for the same reason: the framework's
 * catch-all cannot describe a domain payload, and this route paid for that in run 10.
 */
export const combatIntentEnvelopeSchema = t.Object({
  intent: t.Optional(t.Unknown()),
  source: t.Optional(t.Unknown()),
  dmStartedAt: t.Optional(t.Unknown()),
  phase: t.Optional(t.Unknown()),
  origin: t.Optional(t.Unknown()),
});

export const combatIntentRequestValidator = getSchemaValidator(combatIntentRequestSchema, {});

/**
 * The shape of a `t.Object` variant as TypeBox emits it. Read rather than restated: the whole
 * point of this report is that it cannot drift away from the schema it describes.
 */
type IntentVariantSchema = {
  required?: readonly string[];
  properties: Record<string, { const?: unknown; anyOf?: ReadonlyArray<{ const?: unknown }> }>;
};

const variantsOf = (union: { anyOf: readonly unknown[] }) =>
  union.anyOf as readonly IntentVariantSchema[];

/** True when this variant's `type` literal (or literal union, for the defensive actions) admits `type`. */
function variantAccepts(variant: IntentVariantSchema, type: string): boolean {
  const discriminator = variant.properties?.type;
  if (!discriminator) return false;
  if (discriminator.anyOf) return discriminator.anyOf.some((option) => option.const === type);
  return discriminator.const === type;
}

export type IntentRejection = {
  error: string;
  stage: 'intent_schema';
  dialect: 'dm' | 'player';
  variant: string | null;
  missing: string[];
  detail: string;
};

/**
 * Turns a body that failed the intent union into a sentence that names what was wrong.
 *
 * Run 10 died three times on a body the server could describe precisely and instead answered
 * with `Internal Server Error`: the DM constructed a `type:"attack"` intent without
 * `expectedVersion`, the whole union failed inside the framework, and the pipeline's catch-all
 * — which has no idea what a combat intent is — claimed a server bug. Combat start learned
 * this lesson in its staged errors; this route missed that wave.
 */
export function describeIntentRejection(body: unknown): IntentRejection {
  const envelope = (body ?? {}) as { intent?: unknown; source?: unknown };
  const dialect: 'dm' | 'player' = envelope.source === 'dm' ? 'dm' : 'player';
  const union = dialect === 'dm' ? dmCombatIntentSchema : playerCombatIntentSchema;
  const base = { error: 'Invalid combat intent', stage: 'intent_schema' as const, dialect };

  if (!envelope.intent || typeof envelope.intent !== 'object') {
    return {
      ...base,
      variant: null,
      missing: ['intent'],
      detail: 'no typed combat intent was supplied',
    };
  }

  const intent = envelope.intent as Record<string, unknown>;
  const type = typeof intent.type === 'string' ? intent.type : '';
  const variant = variantsOf(union).find((candidate) => variantAccepts(candidate, type));
  if (!variant) {
    const known = variantsOf(union)
      .flatMap((candidate) => {
        const discriminator = candidate.properties.type;
        return discriminator.anyOf
          ? discriminator.anyOf.map((option) => String(option.const))
          : [String(discriminator.const)];
      })
      .join(', ');
    return {
      ...base,
      variant: null,
      missing: [],
      detail: `intent.type ${JSON.stringify(type)} matches no ${dialect} variant (known: ${known})`,
    };
  }

  const missing = (variant.required ?? []).filter((field) => intent[field] === undefined);
  return {
    ...base,
    variant: type,
    missing,
    detail: missing.length
      ? `the ${dialect} "${type}" variant requires ${missing.join(', ')}`
      : `the ${dialect} "${type}" variant rejected the supplied fields`,
  };
}
