/* eslint-disable @typescript-eslint/no-explicit-any, max-lines */
import { FULL_CASTER_SLOTS, WARLOCK_PACT_MAGIC } from '../../../shared/spell-slot-tables.js';
import nonSrdSupplement from '../../../src/data/spells/non-srd-supplement.json';
import srdSpells from '../../../src/data/srd/spells.json';

// Server-side spell data - converted from the bundled SRD dataset.
// This provides comprehensive D&D 5E spell data without requiring database queries

export interface Spell {
  id: string;
  name: string;
  level: number;
  school: string;
  castingTime: string;
  range: string;
  duration: string;
  description: string;
  verbal: boolean;
  somatic: boolean;
  material: boolean;
  materialComponents?: string;
  concentration: boolean;
  ritual: boolean;
  damage?: boolean;
  attackSave?: string;
  damageEffect?: string;
  classes?: string[];
  attackType?: 'melee' | 'ranged';
  saveAbility?: string;
  saveSuccess?: string;
  damageType?: string;
  damageByLevel?: Record<string, string>;
  areaOfEffect?: {
    shape: 'sphere' | 'cone' | 'cube' | 'line';
    sizeFeet: number;
  };
  forcedMove?: {
    distanceFeet: number;
    direction: 'away' | 'toward';
  };
}

/**
 * The deliberately narrow player-combat spell surface for issue #2085.
 *
 * Keep this list server-owned and explicit: the combat resolver must not silently grow to
 * whatever happens to be present in the full SRD table, and an unlisted spell must be refused
 * rather than narrated as though it resolved.
 */
export const PLAYER_COMBAT_SPELL_IDS = [
  'acid-splash',
  'fire-bolt',
  'ray-of-frost',
  'chill-touch',
  'eldritch-blast',
  'sacred-flame',
  'magic-missile',
  // #2233: the premade Wizard and Sorcerer carry it as their one damaging leveled spell. A DEX
  // save for half, resolved by the same save branch as Acid Splash and spending a slot.
  'burning-hands',
  // #1185: a prepared leveled attack spell, resolved by the attack branch with a slot of its
  // own level. The lingering 2d4 at the end of the next turn has no engine support; the
  // immediate damage resolves and the rest is DM narration.
  'acid-arrow',
] as const;

const PLAYER_COMBAT_SPELL_ID_SET = new Set<string>(PLAYER_COMBAT_SPELL_IDS);

export function isPlayerCombatSpell(spell: Spell | undefined): boolean {
  return !!spell && PLAYER_COMBAT_SPELL_ID_SET.has(spell.id);
}

/**
 * Spells the combat engine resolves without dealing damage of their own (#754): they spend a
 * slot, claim their action (Hex's is a bonus action), and open a lasting effect on one target.
 * Kept separate from PLAYER_COMBAT_SPELL_IDS so the damaging combat surface stays explicit.
 */
export const PLAYER_COMBAT_CURSE_SPELL_IDS = ['hex'] as const;

const PLAYER_COMBAT_CURSE_SPELL_ID_SET = new Set<string>(PLAYER_COMBAT_CURSE_SPELL_IDS);

export function isPlayerCombatCurseSpell(spell: Spell | undefined): boolean {
  return !!spell && PLAYER_COMBAT_CURSE_SPELL_ID_SET.has(spell.id);
}

/**
 * Spells the combat engine resolves as a pure benefit on chosen creatures (#902): they spend
 * a slot, claim their action, and open a lasting effect on their targets — Bless's +1d4 is
 * applied by the roll paths for as long as the caster's concentration holds. Kept separate
 * from PLAYER_COMBAT_SPELL_IDS for the same reason as the curse list.
 */
export const PLAYER_COMBAT_BUFF_SPELL_IDS = ['bless'] as const;

const PLAYER_COMBAT_BUFF_SPELL_ID_SET = new Set<string>(PLAYER_COMBAT_BUFF_SPELL_IDS);

export function isPlayerCombatBuffSpell(spell: Spell | undefined): boolean {
  return !!spell && PLAYER_COMBAT_BUFF_SPELL_ID_SET.has(spell.id);
}

/**
 * Utility spells the combat engine can cast without an attack, save, or damage (#715).
 * Dancing Lights is the reported case: a cantrip whose whole mechanical footprint is
 * the action it spends and the concentration it starts. The DM narrates the lights.
 * Kept as an explicit list, like the curse and buff lists, so Haste, Fly, and Light
 * stay refused until the engine can record what they actually do.
 */
export const PLAYER_COMBAT_UTILITY_SPELL_IDS = ['dancing-lights'] as const;

const PLAYER_COMBAT_UTILITY_SPELL_ID_SET = new Set<string>(PLAYER_COMBAT_UTILITY_SPELL_IDS);

export function isPlayerCombatUtilitySpell(spell: Spell | undefined): boolean {
  return !!spell && PLAYER_COMBAT_UTILITY_SPELL_ID_SET.has(spell.id);
}

/**
 * A spell the combat engine can acknowledge as cast on the caster themself (#902): range
 * Self, concentration, and nothing for the engine to resolve against another creature —
 * no damage, attack roll, saving throw, or area (Detect Magic is the reported case). Such
 * a cast needs no target named: the caster is the target, the slot is spent, the action
 * claimed, and the concentration row — the one ledger the engine keeps for a lasting
 * effect — tracks the spell's life while the DM narrates what it reveals or grants.
 *
 * The concentration requirement is the boundary. A non-concentration Self spell's effect
 * is either instant or tracked by state this cast does not write (False Life's and Armor
 * of Agathys' temporary hit points, Misty Step's movement), so acknowledging it would
 * spend the slot and action on an effect nothing records. Those stay refused, with the
 * honest "describe it to the DM" message. A Self-range spell WITH an effect the engine
 * resolves (Burning Hands' cone, Arms of Hadar's burst) is not a self cast either; it
 * keeps the area path. The exact admitted set is pinned by
 * spell-self-cast-gate.vitest.ts, so a catalog addition forces a conscious verdict.
 */
export function isSelfCastSpell(spell: Spell | undefined): boolean {
  if (!spell) return false;
  return (
    /^self\b/i.test(spell.range.trim()) &&
    spell.concentration === true &&
    !spell.damage &&
    (!spell.damageByLevel || Object.keys(spell.damageByLevel).length === 0) &&
    !spell.attackType &&
    !spell.saveAbility &&
    !spell.areaOfEffect
  );
}

const sourceSpells = [
  ...(srdSpells as unknown as any[]),
  ...(nonSrdSupplement as unknown as any[]),
];

// Canonical SRD catalog, including spell levels 0-9, plus explicit non-SRD supplements.
export const allSpells: Spell[] = sourceSpells.map((spell) => ({
  id: spell.id,
  name: spell.name,
  level: spell.level,
  school: spell.school,
  castingTime: spell.casting_time,
  range: spell.range_text,
  duration: spell.duration,
  description: spell.description,
  verbal: spell.components_verbal,
  somatic: spell.components_somatic,
  material: spell.components_material,
  materialComponents: spell.material_components,
  concentration: spell.concentration,
  ritual: spell.ritual,
  damage: Boolean(spell.damage),
  damageEffect: spell.damage,
  classes: spell.classes,
  attackType: spell.attack_type as 'melee' | 'ranged' | undefined,
  saveAbility: spell.save_ability,
  saveSuccess: spell.save_success,
  damageType: spell.damage_type,
  damageByLevel: spell.damage_by_level,
  areaOfEffect: spell.area_of_effect
    ? { shape: spell.area_of_effect.shape, sizeFeet: spell.area_of_effect.size_feet }
    : undefined,
  forcedMove: spell.forced_move
    ? {
        distanceFeet: spell.forced_move.distance_feet,
        direction: spell.forced_move.direction,
      }
    : undefined,
}));

// Helper functions
export function getClassSpells(className: string): { cantrips: Spell[]; spells: Spell[] } {
  const classKey = className.toLowerCase();
  const available = allSpells.filter((spell) => spell.classes?.includes(classKey));

  return {
    cantrips: available.filter((spell) => spell.level === 0),
    spells: available.filter((spell) => spell.level > 0),
  };
}

export function getSpellById(id: string): Spell | undefined {
  return allSpells.find((spell) => spell.id === id);
}

export function getSpellByName(name: string): Spell | undefined {
  const normalized = name.trim().toLowerCase();
  return allSpells.find((spell) => spell.name.toLowerCase() === normalized);
}

const slugifySpellRef = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * The one lookup every combat path uses to turn a spell reference into a catalog spell.
 *
 * References arrive in several spellings — the sheet's slug (`chill-touch`), a model's
 * `chill_touch` or `Chill Touch`, or a display name beside an id the catalog has never seen
 * (#2233: a premade's own cantrip came back "unknown spell" because a non-slug id short-circuited
 * the name). The id is tried first, then the name, each exact and then as a slug, so a present
 * but unmatched id never hides a name that does match.
 */
export function resolveCatalogSpell(
  spellId?: string | null,
  spellName?: string | null,
): Spell | undefined {
  for (const ref of [spellId, spellName]) {
    if (typeof ref !== 'string' || !ref.trim()) continue;
    const slug = slugifySpellRef(ref);
    const spell =
      getSpellById(ref.trim()) ??
      getSpellByName(ref) ??
      allSpells.find(
        (candidate) => candidate.id === slug || slugifySpellRef(candidate.name) === slug,
      );
    if (spell) return spell;
  }
  return undefined;
}

/**
 * The catalog spell a piece of prose names, when it names exactly one player combat spell.
 *
 * Used by the dialect translators so a sentence like "Chill Touch spell attack vs the elemental"
 * is read as the spell it names rather than as a weapon attack with no weapon (#2233).
 */
export function findPlayerCombatSpellInText(text: string): Spell | undefined {
  const normalized = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const named = PLAYER_COMBAT_SPELL_IDS.map((id) => getSpellById(id)).filter(
    (spell): spell is Spell =>
      !!spell && normalized.includes(` ${spell.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `),
  );
  return named.length === 1 ? named[0] : undefined;
}

export type PlayerCombatSpellVerdict =
  | { castable: true; spell: Spell }
  | {
      castable: false;
      spell?: Spell;
      reason:
        | 'unknown_spell'
        | 'unsupported_spell'
        | 'missing_spell_slot_level'
        | 'unsupported_spell_resolution';
      /** The refusal as the player reads it: what happened and what to do instead. */
      message: string;
    };

/**
 * Whether the combat engine can resolve a spell reference, and if not, why in words the player
 * can act on. `resolveSpellAttack` refuses with exactly these messages, and the premade walk
 * (#2233) holds every premade's spell list to them.
 */
export function assessPlayerCombatSpell(
  spellId?: string | null,
  spellName?: string | null,
  slotLevel?: number | null,
): PlayerCombatSpellVerdict {
  const spell = resolveCatalogSpell(spellId, spellName);
  if (!spell) {
    const label = spellName || spellId || 'that spell';
    return {
      castable: false,
      reason: 'unknown_spell',
      message: `Spell refused: unknown spell "${label}" — it is not in the spell catalog; cast a spell from your sheet by its name`,
    };
  }
  if (isPlayerCombatCurseSpell(spell)) {
    if (spell.level >= 1 && (slotLevel === undefined || slotLevel === null)) {
      return {
        castable: false,
        spell,
        reason: 'missing_spell_slot_level',
        message: `Spell refused: ${spell.name} needs a spell slot level — say which slot to spend (level ${spell.level} or higher)`,
      };
    }
    return { castable: true, spell };
  }
  if (
    isPlayerCombatBuffSpell(spell) ||
    isSelfCastSpell(spell) ||
    isPlayerCombatUtilitySpell(spell)
  ) {
    if (spell.level >= 1 && (slotLevel === undefined || slotLevel === null)) {
      return {
        castable: false,
        spell,
        reason: 'missing_spell_slot_level',
        message: `Spell refused: ${spell.name} needs a spell slot level — say which slot to spend (level ${spell.level} or higher)`,
      };
    }
    return { castable: true, spell };
  }
  if (!isPlayerCombatSpell(spell)) {
    return {
      castable: false,
      spell,
      reason: 'unsupported_spell',
      message: `Spell refused: ${spell.name} has no attack roll or damage the combat engine resolves — describe what you do with it and the DM will narrate it, or cast a damaging spell`,
    };
  }
  if (spell.level >= 1 && (slotLevel === undefined || slotLevel === null)) {
    return {
      castable: false,
      spell,
      reason: 'missing_spell_slot_level',
      message: `Spell refused: ${spell.name} needs a spell slot level — say which slot to spend (level ${spell.level} or higher)`,
    };
  }
  if (!spell.damage || (!spell.attackType && !spell.saveAbility && spell.id !== 'magic-missile')) {
    return {
      castable: false,
      spell,
      reason: 'unsupported_spell_resolution',
      message: `Spell refused: ${spell.name} has no supported combat resolution — describe it to the DM instead`,
    };
  }
  return { castable: true, spell };
}

/** True when prose describes casting a spell rather than swinging a weapon. */
export function describesSpellcasting(text: string): boolean {
  return /\b(?:cast(?:s|ing)?|spell|cantrip|incantation)\b/i.test(text);
}

export function getSpellsByLevel(level: number): Spell[] {
  return allSpells.filter((spell) => spell.level === level);
}

export function getSpellsBySchool(school: string): Spell[] {
  return allSpells.filter((spell) => spell.school === school);
}

// Spell progression data for D&D 5E classes
// Spell progression data for D&D 5E classes
// #617: spell_slots_N derive from shared/spell-slot-tables.ts (epic #616).
// Cantrips/spells-known stay here — they are not slot tables.
const fullCasterRow = (character_level: number, extra: Record<string, number | string>) => {
  const slots = FULL_CASTER_SLOTS[character_level] ?? [0, 0, 0, 0, 0, 0, 0, 0, 0];
  return {
    character_level,
    ...extra,
    spell_slots_1: slots[0],
    spell_slots_2: slots[1],
    spell_slots_3: slots[2],
    spell_slots_4: slots[3],
    spell_slots_5: slots[4],
    spell_slots_6: slots[5],
    spell_slots_7: slots[6],
    spell_slots_8: slots[7],
    spell_slots_9: slots[8],
  };
};

const warlockRow = (character_level: number, extra: Record<string, number | string>) => {
  const pact = WARLOCK_PACT_MAGIC[character_level];
  // Pact slots sit at the pact slot-level column (e.g. Warlock 5 -> spell_slots_3).
  const row: Record<string, number | string> = {
    character_level,
    ...extra,
    spell_slots_1: 0,
    spell_slots_2: 0,
    spell_slots_3: 0,
    spell_slots_4: 0,
    spell_slots_5: 0,
    spell_slots_6: 0,
    spell_slots_7: 0,
    spell_slots_8: 0,
    spell_slots_9: 0,
  };
  if (pact) {
    row[`spell_slots_${pact.level}`] = pact.slots;
  }
  return row;
};

export const spellProgression = {
  Bard: [
    fullCasterRow(1, { cantrips_known: 2, spells_known: 4 }),
    fullCasterRow(2, { cantrips_known: 2, spells_known: 5 }),
    fullCasterRow(3, { cantrips_known: 2, spells_known: 6 }),
    fullCasterRow(4, { cantrips_known: 3, spells_known: 7 }),
    fullCasterRow(5, { cantrips_known: 3, spells_known: 8 }),
  ],
  Druid: [
    fullCasterRow(1, { cantrips_known: 2, spells_prepared_formula: '1 + Wis modifier' }),
    fullCasterRow(2, { cantrips_known: 2, spells_prepared_formula: '2 + Wis modifier' }),
    fullCasterRow(3, { cantrips_known: 2, spells_prepared_formula: '3 + Wis modifier' }),
    fullCasterRow(4, { cantrips_known: 3, spells_prepared_formula: '4 + Wis modifier' }),
    fullCasterRow(5, { cantrips_known: 3, spells_prepared_formula: '5 + Wis modifier' }),
  ],
  Cleric: [
    fullCasterRow(1, { cantrips_known: 3, spells_prepared_formula: '1 + Wis modifier' }),
    fullCasterRow(2, { cantrips_known: 3, spells_prepared_formula: '2 + Wis modifier' }),
    fullCasterRow(3, { cantrips_known: 3, spells_prepared_formula: '3 + Wis modifier' }),
    fullCasterRow(4, { cantrips_known: 4, spells_prepared_formula: '4 + Wis modifier' }),
    fullCasterRow(5, { cantrips_known: 4, spells_prepared_formula: '5 + Wis modifier' }),
  ],
  Sorcerer: [
    fullCasterRow(1, { cantrips_known: 4, spells_known: 2 }),
    fullCasterRow(2, { cantrips_known: 4, spells_known: 3 }),
    fullCasterRow(3, { cantrips_known: 4, spells_known: 4 }),
    fullCasterRow(4, { cantrips_known: 5, spells_known: 5 }),
    fullCasterRow(5, { cantrips_known: 5, spells_known: 6 }),
  ],
  Warlock: [
    warlockRow(1, { cantrips_known: 2, spells_known: 1 }),
    warlockRow(2, { cantrips_known: 2, spells_known: 2 }),
    warlockRow(3, { cantrips_known: 2, spells_known: 3 }),
    warlockRow(4, { cantrips_known: 3, spells_known: 4 }),
    warlockRow(5, { cantrips_known: 3, spells_known: 5 }),
  ],
  Wizard: [
    fullCasterRow(1, { cantrips_known: 3, spells_prepared_formula: '1 + Int modifier' }),
    fullCasterRow(2, { cantrips_known: 3, spells_prepared_formula: '2 + Int modifier' }),
    fullCasterRow(3, { cantrips_known: 3, spells_prepared_formula: '3 + Int modifier' }),
    fullCasterRow(4, { cantrips_known: 4, spells_prepared_formula: '4 + Int modifier' }),
    fullCasterRow(5, { cantrips_known: 4, spells_prepared_formula: '5 + Int modifier' }),
  ],
};

// Spellcasting classes data for D&D 5E
export const spellcastingClasses = [
  {
    id: 'bard',
    name: 'Bard',
    spellcasting_ability: 'Charisma',
    caster_type: 'full',
    spell_slots_start_level: 1,
  },
  {
    id: 'cleric',
    name: 'Cleric',
    spellcasting_ability: 'Wisdom',
    caster_type: 'full',
    spell_slots_start_level: 1,
  },
  {
    id: 'druid',
    name: 'Druid',
    spellcasting_ability: 'Wisdom',
    caster_type: 'full',
    spell_slots_start_level: 1,
  },
  {
    id: 'sorcerer',
    name: 'Sorcerer',
    spellcasting_ability: 'Charisma',
    caster_type: 'full',
    spell_slots_start_level: 1,
  },
  {
    id: 'warlock',
    name: 'Warlock',
    spellcasting_ability: 'Charisma',
    caster_type: 'pact',
    spell_slots_start_level: 1,
  },
  {
    id: 'wizard',
    name: 'Wizard',
    spellcasting_ability: 'Intelligence',
    caster_type: 'full',
    spell_slots_start_level: 1,
  },
  {
    id: 'paladin',
    name: 'Paladin',
    spellcasting_ability: 'Charisma',
    caster_type: 'half',
    spell_slots_start_level: 2,
  },
  {
    id: 'ranger',
    name: 'Ranger',
    spellcasting_ability: 'Wisdom',
    caster_type: 'half',
    spell_slots_start_level: 2,
  },
];
