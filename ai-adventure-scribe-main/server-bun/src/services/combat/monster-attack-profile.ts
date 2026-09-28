/* eslint-disable max-lines -- the three rungs of one ladder (catalog parsing, CR derivation,
   precedence) plus the published CR table they share. Splitting them would put the table in
   one file and its only two readers in others, which is how the normalization rule drifted
   into private copies before it was consolidated into monster-key.ts. */
/**
 * What a monster attacks with.
 *
 * Until now, nothing. A structured combat start creates participants carrying neither a
 * `characterId` nor an `npcId`, so `getEquippedWeaponProfile` found no equipped weapon rows
 * and fell through to `UNARMED_STRIKE` — 1d1 bludgeoning — while
 * `getParticipantAbilityProfile` returned `scores: {}`, making every ability modifier +0.
 * The result, visible in every harness run once `COMBAT_ATTACK_RESOLVED` existed to show it:
 * a CR 10 Stone Golem with 178 HP swinging at +2 for exactly 1 point of damage. The stat
 * ladder had been taught to read HP and AC and was never taught to read attacks.
 *
 * Three sources, in the order the ladder already uses for HP and AC:
 *
 *   authored  — a bible that spells out `Attack Bonus:` and `Damage:` for its creature
 *   catalog   — the SRD entry's own `actions` array, which has been sitting unread
 *   derived   — an attack budget inferred from HP via the DMG's CR table
 *
 * with the generic default kept beneath all three. Derivation exists because campaign bibles
 * describe capabilities as prose ("Rising Dough", "Echolocation") and author no numbers at
 * all: without it, every campaign creature — the ones the product is actually built around —
 * keeps fighting at 1 damage no matter how much HP its author gave it.
 *
 * Each rung records itself. A creature fighting on derived numbers is making an *inference*
 * about its author's intent, and that is a materially different claim from reading a printed
 * stat block; a log that flattened the two would hide exactly the thing worth auditing.
 *
 * @module server/services/combat/monster-attack-profile
 */

import type { DamageType } from '../../types/combat.js';

/** Where a monster's attack numbers came from. Ordered by precedence, strongest first. */
export type AttackProfileSource = 'authored' | 'catalog' | 'derived' | 'generic' | 'scene' | 'role';

/** One attack a monster can make. Damage is split so the engine can crit the dice alone. */
export interface MonsterAttack {
  name: string;
  /** Flat to-hit bonus. Already includes ability and proficiency; never recomputed. */
  attackBonus: number;
  /** Dice only, in `NdN` form — the engine's roller rejects an embedded `+N`. */
  damageDice: string;
  /** The flat addend the SRD folds into `3d8+6`, carried separately so crits are correct. */
  damageBonus: number;
  damageType: DamageType;
  /** Reach for melee, normal range for ranged. Feet. */
  normalRange: number;
  longRange?: number;
  ranged: boolean;
}

export interface MonsterAttackProfile {
  source: AttackProfileSource;
  attacks: MonsterAttack[];
  /**
   * Attacks the monster has that this engine cannot resolve, kept as names only so the
   * telemetry can say what a creature is *not* using. Silence here would read as a creature
   * with no such abilities rather than one whose abilities were dropped.
   */
  unsupported?: string[];
  /** Present only on `derived`: the inference, so a log reader can check the arithmetic. */
  derivation?: { fromMaxHp: number; challengeRating: string; damagePerRound: number };
  /** Present only on `catalog`/`authored` when the source declares a Multiattack. */
  multiattack?: { desc: string; expressible: false };
  /**
   * Present once the profile has been fitted to the party actually present. Every source
   * above is priced for four adventurers; see `party-scaling.ts`. Its absence on a stored
   * profile means the row predates party scaling, not that the factor was 1.
   */
  partyScaling?: {
    partySize: number;
    baseline: number;
    factor: number;
    rawMaxHp: number;
    scaledMaxHp: number;
    rawAttacks: string[];
  };
}

/**
 * The DMG's "Monster Statistics by Challenge Rating" table (DMG p.274).
 *
 * Read in the direction the table is normally read backwards: a creature's hit points place
 * it in a CR band, and that band carries the attack bonus and damage-per-round the designers
 * budgeted for it. That is precisely the inference a DM makes by eye when a bible says "90 HP"
 * and nothing else, so it is the right instrument here — and, being published, it is one a
 * reader can check rather than a constant someone chose.
 *
 * Two honest caveats, both verified against this repo's own 334-entry catalog:
 *
 *   1. The table is a *design* guide. Real monsters deviate: published CR is the average of
 *      defensive and offensive CR, so a monster can sit well below the HP band for its final
 *      CR and make it up in damage. Deriving CR from HP alone therefore tends to *under*-rate
 *      published creatures (the SRD's CR 10 monsters have a median 178 HP against the table's
 *      206-220 band).
 *   2. Under-rating is the correct direction to err. An authored creature given more damage
 *      than its author intended kills a player character on numbers nobody wrote down.
 *
 * `hpMax` is the inclusive top of each band; the first row whose `hpMax` is not exceeded wins.
 */
const CR_TABLE: ReadonlyArray<{
  cr: string;
  hpMax: number;
  attackBonus: number;
  damagePerRound: number;
}> = [
  // damagePerRound is the midpoint of the table's range, rounded down.
  { cr: '0', hpMax: 6, attackBonus: 3, damagePerRound: 0 },
  { cr: '1/8', hpMax: 35, attackBonus: 3, damagePerRound: 2 },
  { cr: '1/4', hpMax: 49, attackBonus: 3, damagePerRound: 4 },
  { cr: '1/2', hpMax: 70, attackBonus: 3, damagePerRound: 7 },
  { cr: '1', hpMax: 85, attackBonus: 3, damagePerRound: 11 },
  { cr: '2', hpMax: 100, attackBonus: 3, damagePerRound: 17 },
  { cr: '3', hpMax: 115, attackBonus: 4, damagePerRound: 23 },
  { cr: '4', hpMax: 130, attackBonus: 5, damagePerRound: 29 },
  { cr: '5', hpMax: 145, attackBonus: 6, damagePerRound: 35 },
  { cr: '6', hpMax: 160, attackBonus: 6, damagePerRound: 41 },
  { cr: '7', hpMax: 175, attackBonus: 6, damagePerRound: 47 },
  { cr: '8', hpMax: 190, attackBonus: 7, damagePerRound: 53 },
  { cr: '9', hpMax: 205, attackBonus: 7, damagePerRound: 59 },
  { cr: '10', hpMax: 220, attackBonus: 7, damagePerRound: 65 },
  { cr: '11', hpMax: 235, attackBonus: 8, damagePerRound: 71 },
  { cr: '12', hpMax: 250, attackBonus: 8, damagePerRound: 77 },
  { cr: '13', hpMax: 265, attackBonus: 8, damagePerRound: 83 },
  { cr: '14', hpMax: 280, attackBonus: 8, damagePerRound: 89 },
  { cr: '15', hpMax: 295, attackBonus: 8, damagePerRound: 95 },
  { cr: '16', hpMax: 310, attackBonus: 9, damagePerRound: 101 },
  { cr: '17', hpMax: 325, attackBonus: 10, damagePerRound: 107 },
  { cr: '18', hpMax: 340, attackBonus: 10, damagePerRound: 113 },
  { cr: '19', hpMax: 355, attackBonus: 10, damagePerRound: 119 },
  { cr: '20', hpMax: 400, attackBonus: 10, damagePerRound: 131 },
  { cr: '21', hpMax: 445, attackBonus: 11, damagePerRound: 149 },
  { cr: '22', hpMax: 490, attackBonus: 11, damagePerRound: 167 },
  { cr: '23', hpMax: 535, attackBonus: 11, damagePerRound: 185 },
  { cr: '24', hpMax: 580, attackBonus: 12, damagePerRound: 203 },
  { cr: '25', hpMax: 625, attackBonus: 12, damagePerRound: 221 },
  { cr: '26', hpMax: 670, attackBonus: 12, damagePerRound: 239 },
  { cr: '27', hpMax: 715, attackBonus: 13, damagePerRound: 257 },
  { cr: '28', hpMax: 760, attackBonus: 13, damagePerRound: 275 },
  { cr: '29', hpMax: 805, attackBonus: 13, damagePerRound: 293 },
  { cr: '30', hpMax: Number.POSITIVE_INFINITY, attackBonus: 14, damagePerRound: 311 },
];

/** Exported so tests and the audit script read the same table the engine does. */
export const crBandForHitPoints = (maxHp: number): (typeof CR_TABLE)[number] =>
  CR_TABLE.find((band) => maxHp <= band.hpMax) ?? CR_TABLE[CR_TABLE.length - 1];

const DAMAGE_TYPES = new Set<DamageType>([
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
]);

const asDamageType = (value: unknown, fallback: DamageType): DamageType => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return DAMAGE_TYPES.has(normalized as DamageType) ? (normalized as DamageType) : fallback;
};

/**
 * Splits the SRD's `3d8+6` into the dice the engine can roll and the addend it must add once.
 *
 * This split is load-bearing rather than cosmetic. `rollDamageDice` accepts `NdN` only and
 * throws a ValidationError on anything else, so passing `3d8+6` through unchanged would turn
 * every golem swing into a failed attack. It also has to be a split rather than a strip: a
 * critical hit doubles the dice and adds the modifier once, so folding the +6 into the dice
 * would double it on every crit.
 */
export function splitDamageDice(
  expression: string | undefined | null,
): { dice: string; bonus: number } | null {
  const raw = String(expression ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  if (!raw) return null;
  const dice = /^(\d+d\d+)([+-]\d+)?$/.exec(raw);
  if (dice) return { dice: dice[1], bonus: dice[2] ? Number(dice[2]) : 0 };
  // A few entries carry a flat number with no dice ("1 piercing damage"). `1d1` is that
  // number expressed as something the roller accepts, not an approximation of it.
  const flat = /^(\d+)$/.exec(raw);
  if (flat) return { dice: '1d1', bonus: Number(flat[1]) - 1 };
  return null;
}

/** Reach/range live only in the prose. `Melee Weapon Attack: +10 to hit, reach 5 ft., ...` */
const readGeometry = (
  desc: string,
): { normalRange: number; longRange?: number; ranged: boolean } => {
  const range = /range\s+(\d+)\s*\/\s*(\d+)\s*ft/i.exec(desc);
  if (range) return { normalRange: Number(range[1]), longRange: Number(range[2]), ranged: true };
  const single = /range\s+(\d+)\s*ft/i.exec(desc);
  if (single) return { normalRange: Number(single[1]), ranged: true };
  const reach = /reach\s+(\d+)\s*ft/i.exec(desc);
  if (reach) return { normalRange: Number(reach[1]), ranged: false };
  // 4 of the catalog's 527 weapon attacks state neither. The declared attack kind is still
  // in the prose, so the default follows it rather than assuming melee for a bow.
  const isRanged = /ranged\s+(?:weapon|spell)\s+attack/i.test(desc);
  return { normalRange: isRanged ? 30 : 5, ranged: isRanged };
};

/** The catalog shape this module reads. Deliberately narrow — see srd-monster-resolution. */
export interface SrdActionEntry {
  name?: string;
  desc?: string;
  attack_bonus?: number;
  multiattack_type?: string;
  usage?: { type?: string };
  dc?: { dc_value?: number };
  damage?: Array<{ damage_dice?: string; damage_type?: { index?: string; name?: string } }>;
}

export interface SrdActionParse {
  attacks: MonsterAttack[];
  /** Names of actions this engine cannot resolve, with why, for logging. */
  unsupported: string[];
  multiattackDesc?: string;
}

/**
 * Classifies an SRD `actions` array into what the attack pipeline can resolve and what it
 * cannot. Measured across all 334 catalog entries (841 action objects):
 *
 *   148  Multiattack       — carries `multiattack_type`, never an `attack_bonus`. It is a
 *                            directive about how many attacks to make, not an attack. The
 *                            `multiattack_type` flag and a `/^multiattack/i` name agree on
 *                            all 148 with zero disagreements, so the structural flag is used.
 *   527  weapon attacks    — `attack_bonus` + a `damage` array. These are resolvable, and
 *                            notably NONE of them carries a `usage` block, so the recharge
 *                            question does not arise for the attack set at all: every
 *                            resolvable attack in the catalog is at-will.
 *    80  save-based        — a `dc` and no `attack_bonus` (breath weapons, gaze attacks).
 *                            Excluded, not approximated. The pipeline resolves d20 + bonus
 *                            against AC; there is no saving-throw path for a monster action,
 *                            and rendering a DC 18 cone as a weapon swing would report a
 *                            number nobody wrote and hide the missing feature.
 *     7  attack, no damage — `attack_bonus` with a rider instead of dice (Web restrains,
 *                            Spit Poison blinds). Excluded: no damage dice to roll.
 *    79  utility           — neither. Change Shape, Etherealness, Roar.
 *
 * One action (the kraken's Tentacle) carries BOTH a `dc` and an `attack_bonus`: it is a real
 * weapon attack with a grapple rider. It is taken as an attack and the rider is dropped,
 * which is reported rather than silently lost.
 */
export function parseSrdActions(actions: readonly SrdActionEntry[] | undefined): SrdActionParse {
  const attacks: MonsterAttack[] = [];
  const unsupported: string[] = [];
  let multiattackDesc: string | undefined;

  for (const action of actions ?? []) {
    const name = String(action.name ?? '').trim();
    if (!name) continue;

    if (action.multiattack_type !== undefined) {
      multiattackDesc = String(action.desc ?? '').trim() || undefined;
      continue;
    }

    const primary = (action.damage ?? []).find((component) => component.damage_dice);
    if (action.attack_bonus === undefined || !primary) {
      // Everything the engine cannot swing is named, with the reason, so a monster that
      // "does nothing" in a log can be told apart from one whose only trick was dropped.
      const reason =
        action.attack_bonus !== undefined
          ? 'no damage dice'
          : action.dc !== undefined
            ? 'saving-throw ability'
            : 'not an attack';
      unsupported.push(`${name} (${reason})`);
      continue;
    }

    const split = splitDamageDice(primary.damage_dice);
    if (!split) {
      unsupported.push(`${name} (unreadable damage dice)`);
      continue;
    }

    const desc = String(action.desc ?? '');
    const geometry = readGeometry(desc);
    const extras = (action.damage ?? []).filter(
      (component) => component !== primary && component.damage_dice,
    );
    if (extras.length) {
      // 67 catalog attacks add a second damage type ("plus 7 (2d6) fire damage"). The
      // pipeline resolves one damage type per attack, against one resistance check, so the
      // rider is dropped rather than summed into the primary type — summing would both
      // inflate the primary and let a fire rider through a fire immunity.
      unsupported.push(
        `${name} rider: ${extras
          .map((component) => `${component.damage_dice} ${component.damage_type?.index ?? '?'}`)
          .join(' + ')}`,
      );
    }

    attacks.push({
      name,
      attackBonus: action.attack_bonus,
      damageDice: split.dice,
      damageBonus: split.bonus,
      damageType: asDamageType(
        primary.damage_type?.index ?? primary.damage_type?.name,
        geometry.ranged ? 'piercing' : 'bludgeoning',
      ),
      normalRange: geometry.normalRange,
      ...(geometry.longRange === undefined ? {} : { longRange: geometry.longRange }),
      ranged: geometry.ranged,
    });
  }

  return {
    attacks,
    unsupported,
    ...(multiattackDesc === undefined ? {} : { multiattackDesc }),
  };
}

/**
 * Turns a CR damage-per-round budget into one attack.
 *
 * The budget is a whole round's output, which the DMG expects a monster to split across
 * however many attacks its Multiattack grants. This engine resolves one attack per action —
 * `claimTurnAction` claims a single `action_used` boolean, and a second attack on the same
 * turn is refused with "Action already used this turn" — so the whole budget goes into that
 * one attack. Splitting it would leave the creature hitting for a fraction of what its HP
 * implies, which is the bug being fixed rather than a smaller version of it.
 *
 * This does create a real and deliberate asymmetry with the catalog rung, which is recorded
 * here rather than left to be discovered: a catalog creature whose stat block says "makes two
 * slams" lands only one of them, so it fights at roughly half its designed output, while a
 * derived creature of the same CR lands its full round budget in a single blow. The
 * alternative — dividing the derived budget by an assumed attack count — would make derived
 * creatures underperform to match a shortfall in the engine, which is encoding the bug rather
 * than working around it. When the turn model learns Multiattack, both rungs change together
 * and this comment is the note explaining what to change.
 *
 * Dice rather than a flat number so the damage varies like everything else at the table, and
 * so a critical hit has dice to double. The shape is chosen to average close to the budget:
 * a d6-based pool sized to the budget, with the remainder as a flat bonus.
 */
export function deriveAttackFromHitPoints(maxHp: number, name = 'Attack'): MonsterAttack {
  const band = crBandForHitPoints(maxHp);
  const budget = Math.max(1, band.damagePerRound);
  // Average of NdN dice is N*(sides+1)/2; for d6 that is 3.5 per die.
  const diceCount = Math.max(1, Math.round(budget / 3.5));
  const bonus = Math.max(0, budget - Math.round(diceCount * 3.5));
  return {
    name,
    attackBonus: band.attackBonus,
    damageDice: `${diceCount}d6`,
    damageBonus: bonus,
    damageType: 'bludgeoning',
    normalRange: 5,
    ranged: false,
  };
}

/** The authored tier: a bible that spelled the numbers out. */
export interface AuthoredAttackFields {
  attackBonus?: number;
  damageDice?: string;
  damageType?: string;
  /** From `Attack (Name):`. Absent means the swing is the generic word `strike`. */
  attackName?: string;
  /** Remainder of the Attack line. Geometry is read from this; empty stays melee 5 ft. */
  attackText?: string;
}

/**
 * Applies the precedence the brief and the existing stat ladder share:
 *
 *   authored -> catalog -> derived -> generic
 *
 * `generic` is returned only when there is nothing to work from at all — no authored attack,
 * no catalog entry, and no resolved HP. A creature that resolved *somewhere* always gets at
 * least a derived attack, because its HP is evidence about what its author intended even when
 * no attack line was written.
 */
export function resolveMonsterAttackProfile(input: {
  authored?: AuthoredAttackFields | null;
  catalog?: SrdActionParse | null;
  maxHp?: number | null;
  /** Kept for callers. The swing is no longer named after the creature (#2306). */
  monsterName?: string | null;
}): MonsterAttackProfile {
  const { authored, catalog, maxHp } = input;

  if (authored?.attackBonus !== undefined && authored.damageDice) {
    const split = splitDamageDice(authored.damageDice);
    if (split) {
      // Same geometry reader as the catalog rung. No reach/range prose stays melee 5 ft.
      const geometry = readGeometry(authored.attackText ?? '');
      // No authored Attack (Name). Never "<Monster> attack" (#2306).
      const fallbackName = 'strike';
      return {
        source: 'authored',
        attacks: [
          {
            name: authored.attackName?.trim() || fallbackName,
            attackBonus: authored.attackBonus,
            damageDice: split.dice,
            damageBonus: split.bonus,
            damageType: asDamageType(authored.damageType, 'bludgeoning'),
            normalRange: geometry.normalRange,
            ...(geometry.longRange === undefined ? {} : { longRange: geometry.longRange }),
            ranged: geometry.ranged,
          },
        ],
      };
    }
  }

  if (catalog?.attacks.length) {
    return {
      source: 'catalog',
      attacks: catalog.attacks,
      ...(catalog.unsupported.length ? { unsupported: catalog.unsupported } : {}),
      ...(catalog.multiattackDesc
        ? { multiattack: { desc: catalog.multiattackDesc, expressible: false as const } }
        : {}),
    };
  }

  if (typeof maxHp === 'number' && maxHp > 0) {
    const band = crBandForHitPoints(maxHp);
    return {
      source: 'derived',
      attacks: [deriveAttackFromHitPoints(maxHp, 'strike')],
      derivation: {
        fromMaxHp: maxHp,
        challengeRating: band.cr,
        damagePerRound: band.damagePerRound,
      },
      ...(catalog?.unsupported.length ? { unsupported: catalog.unsupported } : {}),
    };
  }

  return { source: 'generic', attacks: [] };
}
