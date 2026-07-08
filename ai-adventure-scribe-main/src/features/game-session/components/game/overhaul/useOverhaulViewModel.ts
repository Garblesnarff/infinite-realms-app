import { useMemo } from 'react';

import { useCampaign } from '@/contexts/CampaignContext';
import { useCharacter } from '@/contexts/CharacterContext';
import { useCombat } from '@/contexts/CombatContext';
import { getExperienceForLevel } from '@/data/levelProgression';
import type { Character } from '@/types/character';
import { calculateAllCharacterStats } from '@/utils/character-calculations';

import type {
  AttackVM,
  CharacterSheetVM,
  CombatantVM,
  ConditionVM,
  EquipmentVM,
  GameOverhaulViewModel,
  InventoryItemVM,
  NamedModVM,
  PartyMemberVM,
} from './types';

const ABILITY_ORDER: { key: string; label: string }[] = [
  { key: 'strength', label: 'STR' },
  { key: 'dexterity', label: 'DEX' },
  { key: 'constitution', label: 'CON' },
  { key: 'intelligence', label: 'INT' },
  { key: 'wisdom', label: 'WIS' },
  { key: 'charisma', label: 'CHA' },
];

const WEAPON_HINTS = [
  'sword',
  'axe',
  'bow',
  'crossbow',
  'dagger',
  'mace',
  'hammer',
  'spear',
  'club',
  'flail',
  'glaive',
  'halberd',
  'javelin',
  'lance',
  'maul',
  'pike',
  'quarterstaff',
  'rapier',
  'scimitar',
  'sickle',
  'staff',
  'trident',
  'whip',
  'morningstar',
  'sling',
  'dart',
];

const ARMOR_HINTS = ['mail', 'armor', 'armour', 'plate', 'leather', 'shield', 'breastplate', 'cuirass'];

const fmt = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

/** Turn a slug/itemId like "potion-of-healing" into "Potion Of Healing". */
const prettify = (id: string): string =>
  (id || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || 'Item';

const abilityMod = (score?: number): number => Math.floor(((score ?? 10) - 10) / 2);

function buildCharacterSheet(character: Character | null): CharacterSheetVM {
  const empty: CharacterSheetVM = {
    name: 'No Character',
    subtitle: '',
    level: 1,
    xpCurrent: 0,
    xpMax: 300,
    hpCurrent: 0,
    hpMax: 0,
    ac: 10,
    initiative: '+0',
    speed: 30,
    abilityScores: ABILITY_ORDER.map((a) => ({ label: a.label, score: 10, modifier: '+0' })),
    savingThrows: [],
    skills: [],
    attacks: [],
    conditions: [],
    equipment: [],
    inventory: [],
  };
  if (!character) return empty;

  let stats: ReturnType<typeof calculateAllCharacterStats>;
  try {
    stats = calculateAllCharacterStats(character);
  } catch {
    // Never let a malformed character crash the game page — show identity only.
    return { ...empty, name: character.name ?? 'Adventurer', subtitle: [character.race?.name, character.class?.name].filter(Boolean).join(' · '), level: character.level ?? 1 };
  }
  const level = character.level ?? 1;
  const xpCurrent = character.experience ?? getExperienceForLevel(level);
  const xpMax = getExperienceForLevel(Math.min(20, level + 1)) || xpCurrent;
  const hpMax = stats.hitPoints;
  const hpCurrent = Math.min(
    hpMax,
    Math.max(0, character.hitPoints?.current ?? character.hitPoints?.maximum ?? hpMax),
  );

  const abilityScores = ABILITY_ORDER.map((a) => {
    const score = character.abilityScores?.[a.key as keyof typeof character.abilityScores]?.score ?? 10;
    return { label: a.label, score, modifier: fmt(abilityMod(score)) };
  });

  const savingThrows: NamedModVM[] = ABILITY_ORDER.map((a) => ({
    label: a.label,
    modifier: fmt(stats.savingThrowModifiers?.[a.key]?.modifier ?? abilityMod(character.abilityScores?.[a.key as keyof typeof character.abilityScores]?.score)),
  }));

  // Prefer proficient skills; fall back to a representative set so the panel isn't empty.
  const skillEntries = Object.entries(stats.skillModifiers ?? {});
  const proficient = skillEntries.filter(([, v]) => v.proficient);
  const chosen = (proficient.length ? proficient : skillEntries).slice(0, 8);
  const skills: NamedModVM[] = chosen.map(([name, v]) => ({ label: name, modifier: fmt(v.modifier) }));

  const inv = character.inventory ?? [];
  const profBonus = stats.proficiencyBonus;
  const strMod = abilityMod(character.abilityScores?.strength?.score);
  const dexMod = abilityMod(character.abilityScores?.dexterity?.score);

  const attacks: AttackVM[] = inv
    .filter((it) => WEAPON_HINTS.some((w) => it.itemId?.toLowerCase().includes(w)))
    .slice(0, 6)
    .map((it) => {
      const ranged = /bow|crossbow|sling|dart|javelin/.test(it.itemId?.toLowerCase() ?? '');
      const mod = (ranged ? dexMod : strMod) + profBonus + (it.magicBonus ?? 0);
      return {
        id: it.itemId,
        name: prettify(it.itemId),
        bonus: fmt(mod),
        damage: it.isMagic && it.magicBonus ? `+${it.magicBonus}` : '',
      };
    });

  const equipment: EquipmentVM[] = inv
    .filter((it) => it.equipped)
    .slice(0, 8)
    .map((it) => ({
      id: it.itemId,
      name: prettify(it.itemId),
      detail: ARMOR_HINTS.some((a) => it.itemId?.toLowerCase().includes(a))
        ? 'Armor'
        : WEAPON_HINTS.some((w) => it.itemId?.toLowerCase().includes(w))
          ? 'Weapon'
          : it.isMagic
            ? 'Magic item'
            : 'Equipped',
    }));

  const inventory: InventoryItemVM[] = inv
    .filter((it) => !it.equipped)
    .slice(0, 12)
    .map((it) => ({ id: it.itemId, name: prettify(it.itemId), quantity: it.quantity }));

  const conditions: ConditionVM[] = (character.conditions ?? []).map((c, i) => ({
    id: `${c.name}-${i}`,
    name: prettify(c.name),
    duration: c.duration === -1 ? '∞' : c.duration ? `${c.duration}r` : undefined,
  }));

  return {
    name: character.name ?? 'Adventurer',
    subtitle: [character.race?.name, character.class?.name].filter(Boolean).join(' · '),
    level,
    xpCurrent,
    xpMax,
    avatarUrl: character.avatar_url,
    hpCurrent,
    hpMax,
    ac: stats.armorClass,
    initiative: fmt(stats.initiative),
    speed: stats.speed,
    abilityScores,
    savingThrows,
    skills,
    attacks,
    conditions,
    equipment,
    inventory,
  };
}

/**
 * Adapts the live game contexts (campaign / character / combat) into the
 * presentational GameOverhaulViewModel consumed by the navy+gold side rails.
 */
export function useOverhaulViewModel(opts?: {
  chapterLabel?: string;
  sceneBlurb?: string;
}): GameOverhaulViewModel {
  const { state: campaignState } = useCampaign();
  const { state: characterState } = useCharacter();
  const { state: combatState } = useCombat();

  const campaign = campaignState?.campaign ?? null;
  const character = (characterState?.character ?? null) as Character | null;
  const encounter = combatState?.activeEncounter ?? null;

  return useMemo<GameOverhaulViewModel>(() => {
    const sheet = buildCharacterSheet(character);

    const combatants: CombatantVM[] = (encounter?.participants ?? [])
      .slice()
      .sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0))
      .map((p) => ({
        id: p.id,
        initiative: p.initiative ?? 0,
        name: p.name,
        isEnemy: p.participantType === 'enemy',
        isActive: encounter?.currentTurnParticipantId === p.id,
      }));

    // Party: players in the active encounter, else the player's own character.
    const players = (encounter?.participants ?? []).filter((p) => p.participantType === 'player');
    const party: PartyMemberVM[] = players.length
      ? players.map((p) => ({
          id: p.id,
          name: p.name,
          subtitle: [p.level ? `Level ${p.level}` : null, p.characterClass].filter(Boolean).join(' '),
          currentHp: p.currentHitPoints,
          maxHp: p.maxHitPoints,
          avatarUrl: p.portraitUrl,
        }))
      : character
        ? [
            {
              id: character.id ?? 'self',
              name: sheet.name,
              subtitle: [`Level ${sheet.level}`, character.class?.name].filter(Boolean).join(' '),
              currentHp: sheet.hpCurrent,
              maxHp: sheet.hpMax,
              avatarUrl: character.avatar_url,
            },
          ]
        : [];

    return {
      scene: {
        title: (campaign?.name ?? 'Adventure').toUpperCase(),
        blurb: opts?.sceneBlurb ?? '',
      },
      campaign: {
        name: campaign?.name ?? 'Adventure',
        chapter: opts?.chapterLabel ?? 'Chapter 1',
        thumbnailUrl: campaign?.background_image ?? undefined,
        objective: campaign?.description ?? 'Your adventure awaits.',
        objectiveTasks: [],
        regionLabel: campaign?.location ?? undefined,
      },
      party,
      partyMax: Math.max(party.length, 4),
      combat: {
        active: !!encounter,
        round: encounter?.currentRound ?? 1,
        combatants,
      },
      character: sheet,
    };
  }, [campaign, character, encounter, opts?.chapterLabel, opts?.sceneBlurb]);
}
