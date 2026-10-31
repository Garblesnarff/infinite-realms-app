/**
 * #1225: how many uses a limited class feature has, by the 2014 PHB.
 *
 * The library (`class_features_library`) carries a `uses_count` per row, but the generated SRD
 * seed (`supabase/migrations/20261009_seed_srd_class_features.sql`) could only read a count from
 * a "(N uses)" name suffix, so most limited features landed with `uses_count` NULL — and the
 * spend path read "no count" as unlimited. Counts that depend on level or on an ability score
 * cannot live in one library row at all (#1187 found per-tier rows for Action Surge instead).
 *
 * This table is the engine's answer, shared by the server (spend + rest refill) and the seed
 * generator (`scripts/generate-class-features-seed.ts`, for the fixed counts):
 *
 * - `count`: the feature's uses per rest, computed from the class level and ability modifiers,
 *   and the rest that refills it (`rechargeAt`): the rest refill reads it here, never from the
 *   row's stored `uses_per_rest`, so a wrongly tagged row cannot refill early.
 *   Rows of one feature that the seeds split by tier (Channel Divinity 1/2/3 per rest,
 *   Indomitable, Bardic Inspiration's die, Wild Shape's CR) share a `family`, so a sheet that
 *   holds several tiers still has ONE count. `'unlimited'` is the rule's own answer at that level
 *   (Rage and Wild Shape at 20); `null` means it cannot be computed (no ability scores), and the
 *   spend refuses rather than guess.
 * - `pool`: a feature another service owns (Lay on Hands HP and Divine Sense, #712).
 * - `spends`: no uses of its own; it spends another resource. Classified by the family it spends,
 *   not by its rest tag (Turn Undead, Flurry of Blows, Divine Smite... carry no rest in the seed).
 *   With a `route`, the spend takes `cost` from that counted family (Turn Undead takes one
 *   Channel Divinity use; Flurry of Blows takes 1 ki). Without one (the cost varies by option, or
 *   the resource is a spell slot), the generic spend refuses it with that reason.
 * - `not_counted`: tagged with a rest in the seeds, but the PHB gives it no per-rest count
 *   (Song of Rest is used during a short rest; Relentless Rage's DC rises instead).
 *
 * A limited feature (seeded with a rest) that is in none of these and has no library count is
 * refused by the spend: the engine fails closed rather than inventing unlimited uses.
 */

export type AbilityName =
  | 'strength'
  | 'dexterity'
  | 'constitution'
  | 'intelligence'
  | 'wisdom'
  | 'charisma';

export interface LimitedFeatureContext {
  /** Levels in the feature's own class (multiclass-aware at the call site). */
  classLevel: number;
  /** Ability modifiers, when the character's scores are known. */
  abilityModifiers: Partial<Record<AbilityName, number>> | null;
}

export type UsesAt = (ctx: LimitedFeatureContext) => number | 'unlimited' | null;

export type RestKind = 'short_rest' | 'long_rest';

export type LimitedFeatureRule =
  | {
      kind: 'count';
      family: string;
      usesAt: UsesAt;
      /** The rest that refills it, by the PHB. */
      rechargeAt: (ctx: LimitedFeatureContext) => RestKind;
    }
  | { kind: 'pool' }
  | {
      kind: 'spends';
      /** What it spends, as the player reads it ("Channel Divinity", "ki points"). */
      pool: string;
      /** The counted family it draws from and how much, or null when the spend refuses it. */
      route: { family: string; cost: number } | null;
    }
  | { kind: 'not_counted' };

const shortRest = (): RestKind => 'short_rest';
const longRest = (): RestKind => 'long_rest';

const fixed =
  (uses: number): UsesAt =>
  () =>
    uses;

/** max(1, the ability's modifier): the PHB's "a number of times equal to your X modifier (minimum of once)". */
const abilityMinOne =
  (ability: AbilityName): UsesAt =>
  (ctx) => {
    const mod = ctx.abilityModifiers?.[ability];
    return typeof mod === 'number' ? Math.max(1, mod) : null;
  };

const byLevel =
  (steps: Array<[minLevel: number, uses: number | 'unlimited']>): UsesAt =>
  (ctx) => {
    let uses: number | 'unlimited' = 0;
    for (const [minLevel, value] of steps) if (ctx.classLevel >= minLevel) uses = value;
    return uses;
  };

/** Rage: 2 at 1st, 3 at 3rd, 4 at 6th, 5 at 12th, 6 at 17th, unlimited at 20th (PHB p.48). */
export const rageUsesAt = byLevel([
  [1, 2],
  [3, 3],
  [6, 4],
  [12, 5],
  [17, 6],
  [20, 'unlimited'],
]);
/** Cleric Channel Divinity: 1 at 2nd, 2 at 6th, 3 at 18th (PHB p.58). */
export const clericChannelDivinityUsesAt = byLevel([
  [2, 1],
  [6, 2],
  [18, 3],
]);
/** Indomitable: 1 at 9th, 2 at 13th, 3 at 17th (PHB p.72). */
export const indomitableUsesAt = byLevel([
  [9, 1],
  [13, 2],
  [17, 3],
]);
/**
 * Action Surge: 1, 2 at 17th (PHB p.72). Mirrors `actionSurgeUsesAt` in
 * server-bun/src/services/combat/fighter-features-service.ts (#1187), which the fighter service
 * spends through; a unit test pins that the two agree at every level.
 */
export const actionSurgeUsesAt = byLevel([
  [2, 1],
  [17, 2],
]);
/** Battle Master superiority dice: 4 at 3rd, 5 at 7th, 6 at 15th (PHB p.73). */
export const superiorityDiceAt = byLevel([
  [3, 4],
  [7, 5],
  [15, 6],
]);
/** Wild Shape: twice per short rest; unlimited at 20th (Archdruid, PHB p.67). */
export const wildShapeUsesAt = byLevel([
  [2, 2],
  [20, 'unlimited'],
]);
/** Ki points and sorcery points equal the class level (PHB p.78, p.101). */
const classLevelPool: UsesAt = (ctx) => (ctx.classLevel >= 2 ? ctx.classLevel : 0);

const RULES: Record<string, LimitedFeatureRule> = {
  // Barbarian
  'barbarian|rage': {
    kind: 'count',
    family: 'barbarian-rage',
    usesAt: rageUsesAt,
    rechargeAt: longRest,
  },
  'barbarian|relentless rage': { kind: 'not_counted' },
  // Bard: Bardic Inspiration's die grows by tier; the count is CHA, and Font of Inspiration
  // (5th) moves its recharge to a short rest.
  ...Object.fromEntries(
    [
      'bardic inspiration',
      'bardic inspiration (d6)',
      'bardic inspiration (d8)',
      'bardic inspiration (d10)',
      'bardic inspiration (d12)',
    ].map((name) => [
      `bard|${name}`,
      {
        kind: 'count',
        family: 'bard-bardic-inspiration',
        usesAt: abilityMinOne('charisma'),
        rechargeAt: (ctx: LimitedFeatureContext) =>
          ctx.classLevel >= 5 ? 'short_rest' : 'long_rest',
      } satisfies LimitedFeatureRule,
    ]),
  ),
  'bard|font of inspiration': { kind: 'not_counted' },
  ...Object.fromEntries(
    [
      'song of rest',
      'song of rest (d6)',
      'song of rest (d8)',
      'song of rest (d10)',
      'song of rest (d12)',
    ].map((name) => [`bard|${name}`, { kind: 'not_counted' } satisfies LimitedFeatureRule]),
  ),
  // Cleric
  ...Object.fromEntries(
    [
      'channel divinity',
      'channel divinity (1/rest)',
      'channel divinity (2/rest)',
      'channel divinity (3/rest)',
    ].map((name) => [
      `cleric|${name}`,
      {
        kind: 'count',
        family: 'cleric-channel-divinity',
        usesAt: clericChannelDivinityUsesAt,
        rechargeAt: shortRest,
      } satisfies LimitedFeatureRule,
    ]),
  ),
  // Each Channel Divinity option spends one use of the class's Channel Divinity (PHB p.58).
  ...Object.fromEntries(
    [
      'channel divinity: turn undead',
      'channel divinity: preserve life',
      'channel divinity: guided strike',
      "channel divinity: war god's blessing",
    ].map((name) => [
      `cleric|${name}`,
      {
        kind: 'spends',
        pool: 'Channel Divinity',
        route: { family: 'cleric-channel-divinity', cost: 1 },
      } satisfies LimitedFeatureRule,
    ]),
  ),
  'cleric|divine intervention': {
    kind: 'count',
    family: 'cleric-divine-intervention',
    usesAt: fixed(1),
    rechargeAt: longRest,
  },
  'cleric|war priest': {
    kind: 'count',
    family: 'cleric-war-priest',
    usesAt: abilityMinOne('wisdom'),
    rechargeAt: longRest,
  },
  // Druid
  ...Object.fromEntries(
    [
      'wild shape',
      'wild shape (cr 1/4 or below, no flying or swim speed)',
      'wild shape (cr 1/2 or below, no flying speed)',
      'wild shape (cr 1 or below)',
    ].map((name) => [
      `druid|${name}`,
      {
        kind: 'count',
        family: 'druid-wild-shape',
        usesAt: wildShapeUsesAt,
        rechargeAt: shortRest,
      } satisfies LimitedFeatureRule,
    ]),
  ),
  'druid|natural recovery': {
    kind: 'count',
    family: 'druid-natural-recovery',
    usesAt: fixed(1),
    rechargeAt: longRest,
  },
  // Fighter (Second Wind and Action Surge are also spent by fighter-features-service)
  'fighter|second wind': {
    kind: 'count',
    family: 'fighter-second-wind',
    usesAt: fixed(1),
    rechargeAt: shortRest,
  },
  ...Object.fromEntries(
    [
      'action surge',
      'action surge (1 use)',
      'action surge (2 uses)',
      'action surge (two uses)',
    ].map((name) => [
      `fighter|${name}`,
      {
        kind: 'count',
        family: 'fighter-action-surge',
        usesAt: actionSurgeUsesAt,
        rechargeAt: shortRest,
      } satisfies LimitedFeatureRule,
    ]),
  ),
  ...Object.fromEntries(
    [
      'indomitable',
      'indomitable (1 use)',
      'indomitable (2 uses)',
      'indomitable (3 uses)',
      'indomitable (two uses)',
      'indomitable (three uses)',
    ].map((name) => [
      `fighter|${name}`,
      {
        kind: 'count',
        family: 'fighter-indomitable',
        usesAt: indomitableUsesAt,
        rechargeAt: longRest,
      } satisfies LimitedFeatureRule,
    ]),
  ),
  'fighter|combat superiority': {
    kind: 'count',
    family: 'fighter-superiority-dice',
    usesAt: superiorityDiceAt,
    rechargeAt: shortRest,
  },
  // Monk
  'monk|ki': { kind: 'count', family: 'monk-ki', usesAt: classLevelPool, rechargeAt: shortRest },
  // Ki features spend ki points (PHB p.78-79, p.80 Quivering Palm).
  ...Object.fromEntries(
    (
      [
        ['flurry of blows', 1],
        ['patient defense', 1],
        ['step of the wind', 1],
        ['stunning strike', 1],
        ['empty body', 4],
        ['quivering palm', 3],
      ] as const
    ).map(([name, cost]) => [
      `monk|${name}`,
      {
        kind: 'spends',
        pool: 'ki points',
        route: { family: 'monk-ki', cost },
      } satisfies LimitedFeatureRule,
    ]),
  ),
  'monk|wholeness of body': {
    kind: 'count',
    family: 'monk-wholeness-of-body',
    usesAt: fixed(1),
    rechargeAt: longRest,
  },
  'monk|tranquility': { kind: 'not_counted' },
  // Paladin
  'paladin|lay on hands': { kind: 'pool' },
  'paladin|divine sense': { kind: 'pool' },
  'paladin|channel divinity': {
    kind: 'count',
    family: 'paladin-channel-divinity',
    usesAt: fixed(1),
    rechargeAt: shortRest,
  },
  ...Object.fromEntries(
    ['channel divinity: sacred weapon', 'channel divinity: turn the unholy'].map((name) => [
      `paladin|${name}`,
      {
        kind: 'spends',
        pool: 'Channel Divinity',
        route: { family: 'paladin-channel-divinity', cost: 1 },
      } satisfies LimitedFeatureRule,
    ]),
  ),
  // Divine Smite expends a spell slot of the paladin's choice (PHB p.85); the slot is spent where
  // spell slots are, not here.
  'paladin|divine smite': { kind: 'spends', pool: 'a spell slot', route: null },
  'paladin|cleansing touch': {
    kind: 'count',
    family: 'paladin-cleansing-touch',
    usesAt: abilityMinOne('charisma'),
    rechargeAt: longRest,
  },
  // Rogue
  'rogue|stroke of luck': {
    kind: 'count',
    family: 'rogue-stroke-of-luck',
    usesAt: fixed(1),
    rechargeAt: shortRest,
  },
  // Sorcerer
  'sorcerer|font of magic': {
    kind: 'count',
    family: 'sorcerer-sorcery-points',
    usesAt: classLevelPool,
    rechargeAt: longRest,
  },
  // Both cost a number of sorcery points that depends on the slot or the option (PHB p.101-102),
  // which the use request does not carry: refused with the reason, never free.
  'sorcerer|flexible casting: creating spell slots': {
    kind: 'spends',
    pool: 'sorcery points (Font of Magic)',
    route: null,
  },
  'sorcerer|metamagic': { kind: 'spends', pool: 'sorcery points (Font of Magic)', route: null },
  // Converting a slot into points expends the slot (PHB p.101).
  'sorcerer|flexible casting: converting spell slot': {
    kind: 'spends',
    pool: 'a spell slot',
    route: null,
  },
  // Draconic Presence: an action and 5 sorcery points (PHB p.103).
  'sorcerer|draconic presence': {
    kind: 'spends',
    pool: 'sorcery points',
    route: { family: 'sorcerer-sorcery-points', cost: 5 },
  },
  'sorcerer|sorcerous restoration': { kind: 'not_counted' },
  // Warlock
  'warlock|eldritch master': {
    kind: 'count',
    family: 'warlock-eldritch-master',
    usesAt: fixed(1),
    rechargeAt: longRest,
  },
  ...Object.fromEntries(
    ['6th', '7th', '8th', '9th'].map((tier) => [
      `warlock|mystic arcanum (${tier} level)`,
      {
        kind: 'count',
        family: `warlock-mystic-arcanum-${tier}`,
        usesAt: fixed(1),
        rechargeAt: longRest,
      } satisfies LimitedFeatureRule,
    ]),
  ),
  // Wizard
  // Arcane Recovery: "once per day when you finish a short rest" (PHB p.115) -- the use is
  // regained on a long rest, though it is taken at the end of a short one.
  'wizard|arcane recovery': {
    kind: 'count',
    family: 'wizard-arcane-recovery',
    usesAt: fixed(1),
    rechargeAt: longRest,
  },
  ...Object.fromEntries(
    ['signature spell', 'signature spells'].map((name) => [
      `wizard|${name}`,
      {
        kind: 'count',
        family: 'wizard-signature-spells',
        usesAt: fixed(2),
        rechargeAt: shortRest,
      } satisfies LimitedFeatureRule,
    ]),
  ),
  'wizard|overchannel': { kind: 'not_counted' },
};

const key = (className: string, featureName: string): string =>
  `${className.trim().toLowerCase()}|${featureName.replace(/[‘’]/g, "'").trim().toLowerCase()}`;

/** The count rule of a family (the pool a `spends` route draws on). */
export function familyCountRule(
  family: string,
): Extract<LimitedFeatureRule, { kind: 'count' }> | null {
  for (const rule of Object.values(RULES)) {
    if (rule.kind === 'count' && rule.family === family) return rule;
  }
  return null;
}

/** The engine's rule for a class feature, or null when it has none. */
export function limitedFeatureRule(
  className: string | null | undefined,
  featureName: string | null | undefined,
): LimitedFeatureRule | null {
  if (typeof className !== 'string' || typeof featureName !== 'string') return null;
  return RULES[key(className, featureName)] ?? null;
}

/**
 * The fixed PHB count for a feature whose count never changes with level or ability, or null.
 * The seed generator writes it into `uses_count`; level- and ability-keyed counts stay NULL there
 * and come from `limitedFeatureRule` at run time.
 */
export function fixedFeatureUses(className: string, featureName: string): number | null {
  const rule = limitedFeatureRule(className, featureName);
  if (!rule || rule.kind !== 'count') return null;
  // A count is fixed when it is the same number at every level with no ability input.
  const values = new Set<number | 'unlimited' | null>();
  for (let classLevel = 1; classLevel <= 20; classLevel++) {
    values.add(rule.usesAt({ classLevel, abilityModifiers: null }));
  }
  if (values.size !== 1) {
    // Tier rows of a level-keyed family still get the count of their own tier from the name.
    return tierCountFromName(featureName);
  }
  const [only] = [...values];
  return typeof only === 'number' ? only : null;
}

/** "(2/rest)", "(3 uses)", "(two uses)": the count a tier row's own name states. */
function tierCountFromName(featureName: string): number | null {
  const words: Record<string, number> = { one: 1, two: 2, three: 3 };
  const match = /\((\d+|one|two|three)\s*(?:\/\s*rest|uses?)\)\s*$/i.exec(featureName);
  if (!match) return null;
  const raw = match[1].toLowerCase();
  return words[raw] ?? Number(raw);
}

/**
 * #1233: the features whose cost varies with the use. Their `limitedFeatureRule` stays
 * `route: null` (a bare use, with no option or slot level, is refused, never free), and the
 * use request resolves the spend here, from the `slotLevel` / `option` it carries. Pure
 * functions only: this module is imported by the client-side seed generator.
 */

/** Sorcery-point cost of each Metamagic option (PHB p.102). Twinned costs the spell level. */
export const METAMAGIC_COSTS: Record<string, number> = {
  careful: 1,
  distant: 1,
  empowered: 1,
  extended: 1,
  heightened: 3,
  quickened: 2,
  subtle: 1,
};

/** Display name of each Metamagic option, for the spend message. */
export const METAMAGIC_OPTION_LABELS: Record<string, string> = {
  careful: 'Careful Spell',
  distant: 'Distant Spell',
  empowered: 'Empowered Spell',
  extended: 'Extended Spell',
  heightened: 'Heightened Spell',
  quickened: 'Quickened Spell',
  subtle: 'Subtle Spell',
  twinned: 'Twinned Spell',
};

/** Sorcery-point cost of creating a spell slot of each level (PHB p.101); level 6+ is refused. */
export const FLEXIBLE_CASTING_CREATE_COSTS: Record<number, number> = {
  1: 2,
  2: 3,
  3: 5,
  4: 6,
  5: 7,
};

/** A variable-cost spend the use request resolves to, or a refusal naming what is missing. */
export type VariableSpendRoute =
  | { kind: 'slot'; slotLevel: number }
  | { kind: 'points'; family: string; cost: number; label: string }
  | { kind: 'createSlot'; family: string; slotLevel: number; cost: number }
  | { kind: 'convertSlot'; slotLevel: number }
  | { kind: 'refuse'; reason: string };

/** The variable inputs a use request carries: the slot level to spend, and the option to apply. */
export interface VariableSpendInput {
  slotLevel?: number;
  option?: string;
}

const SLOT_LEVEL_HINT = 'slotLevel 1-9';
const METAMAGIC_OPTION_HINT =
  'an option: careful, distant, empowered, extended, heightened, quickened, subtle, or twinned:<spell level>';

function invalidSlotLevel(featureName: string): VariableSpendRoute {
  return {
    kind: 'refuse',
    reason: `${featureName} spends a spell slot: send the slot level to spend (${SLOT_LEVEL_HINT}).`,
  };
}

function invalidOption(featureName: string, hint: string): VariableSpendRoute {
  return {
    kind: 'refuse',
    reason: `${featureName} needs ${hint}.`,
  };
}

/** The slot level an option names ("3"), or null when it names no level 1-9. */
function optionSlotLevel(option: string): number | null {
  const match = /^([1-9])$/.exec(option.trim());
  return match ? Number(match[1]) : null;
}

/**
 * Resolves a variable-cost feature's spend from the use request's inputs, or null when the
 * feature has no variable-cost rule (the caller falls back to its fixed route / refusal).
 * A missing or invalid input refuses with the reason, never spends.
 */
export function variableSpendRoute(
  className: string,
  featureName: string,
  input: VariableSpendInput,
): VariableSpendRoute | null {
  const key = `${className.toLowerCase()}|${featureName.toLowerCase()}`;
  if (key === 'paladin|divine smite') {
    const slotLevel = input.slotLevel;
    if (
      typeof slotLevel !== 'number' ||
      !Number.isInteger(slotLevel) ||
      slotLevel < 1 ||
      slotLevel > 9
    ) {
      return invalidSlotLevel(featureName);
    }
    return { kind: 'slot', slotLevel };
  }
  if (key === 'sorcerer|metamagic') {
    const option = input.option?.trim().toLowerCase();
    if (!option) return invalidOption(featureName, METAMAGIC_OPTION_HINT);
    const twinned = /^twinned:([1-9])$/.exec(option);
    if (twinned) {
      return {
        kind: 'points',
        family: 'sorcerer-sorcery-points',
        cost: Number(twinned[1]),
        label: 'Twinned Spell',
      };
    }
    const cost = METAMAGIC_COSTS[option];
    if (cost === undefined) return invalidOption(featureName, METAMAGIC_OPTION_HINT);
    return {
      kind: 'points',
      family: 'sorcerer-sorcery-points',
      cost,
      label: METAMAGIC_OPTION_LABELS[option],
    };
  }
  if (key === 'sorcerer|flexible casting: creating spell slots') {
    const slotLevel = input.option ? optionSlotLevel(input.option) : null;
    if (slotLevel === null) {
      return invalidOption(featureName, 'the slot level to create, as option "1" to "5"');
    }
    const cost = FLEXIBLE_CASTING_CREATE_COSTS[slotLevel];
    if (cost === undefined) {
      return {
        kind: 'refuse',
        reason: `${featureName} cannot create a slot above 5th level: send option "1" to "5".`,
      };
    }
    return { kind: 'createSlot', family: 'sorcerer-sorcery-points', slotLevel, cost };
  }
  if (key === 'sorcerer|flexible casting: converting spell slot') {
    const slotLevel = input.option ? optionSlotLevel(input.option) : null;
    if (slotLevel === null) {
      return invalidOption(featureName, 'the slot level to convert, as option "1" to "9"');
    }
    return { kind: 'convertSlot', slotLevel };
  }
  return null;
}

/** Divine Smite damage in d8s: 2d8, +1d8 per slot level above 1st, capped at 5d8 (PHB p.85). */
export function divineSmiteDice(slotLevel: number): number {
  return Math.min(2 + Math.max(0, slotLevel - 1), 5);
}

/**
 * The engine line for a Smite: the base dice, with the undead/fiend bonus stated
 * conditionally — the use request carries no target, so the DM applies it.
 */
export function divineSmiteLine(slotLevel: number): string {
  const dice = divineSmiteDice(slotLevel);
  return `Divine Smite: +${dice}d8 radiant damage (${dice + 1}d8 against undead or fiends).`;
}
