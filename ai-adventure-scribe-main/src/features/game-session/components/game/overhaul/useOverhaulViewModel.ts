import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import { MAX_SESSION_COMPANIONS } from '../../../../../../shared/companion-constants';

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
import type { Character } from '@/types/character';
import type { ChatMessage } from '@/types/game';

import { useCampaign } from '@/contexts/CampaignContext';
import { useCharacter } from '@/contexts/CharacterContext';
import { useCombat } from '@/contexts/CombatContext';
import { getExperienceForLevel } from '@/data/levelProgression';
import { getCharacterSheetHitPoints } from '@/utils/character/character-sheet-hit-points';
import { calculateAllCharacterStats } from '@/utils/character-calculations';
import {
  getSessionCompanions,
  type SessionCompanion,
  type SessionCompanionsResponse,
} from '@/webmcp/companion-api';

const SESSION_COMPANION_POLL_INTERVAL_MS = 15_000;
const EMPTY_COMPANIONS: SessionCompanion[] = [];

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

const ARMOR_HINTS = [
  'mail',
  'armor',
  'armour',
  'plate',
  'leather',
  'shield',
  'breastplate',
  'cuirass',
];

const fmt = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

/** Turn a slug/itemId like "potion-of-healing" into "Potion Of Healing". */
const prettify = (id: string): string =>
  (id || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || 'Item';

const abilityMod = (score?: number): number => Math.floor(((score ?? 10) - 10) / 2);

export interface PartyMemberSource {
  characterId: string;
  member: PartyMemberVM;
}

export interface EncounterPartyMember {
  id: string;
  characterId?: string;
  name: string;
  characterClass?: string;
  level?: number;
  currentHitPoints: number;
  maxHitPoints: number;
  portraitUrl?: string;
}

export function mergePartyMembers(
  protagonist: PartyMemberSource | null,
  companions: readonly SessionCompanion[],
  encounterPlayers: readonly EncounterPartyMember[],
): PartyMemberVM[] {
  const seenCharacterIds = new Set<string>();
  const party: PartyMemberVM[] = [];
  const encounterPlayersByCharacterId = new Map<string, EncounterPartyMember>();

  for (const participant of encounterPlayers) {
    if (participant.characterId && !encounterPlayersByCharacterId.has(participant.characterId)) {
      encounterPlayersByCharacterId.set(participant.characterId, participant);
    }
  }

  const addMember = (characterId: string, member: PartyMemberVM): void => {
    const dedupeKey = characterId || `party-member:${member.id}`;
    if (seenCharacterIds.has(dedupeKey)) return;
    seenCharacterIds.add(dedupeKey);
    party.push(member);
  };

  const liveMemberFields = (
    member: PartyMemberVM,
    participant: EncounterPartyMember,
  ): PartyMemberVM => ({
    ...member,
    name: participant.name,
    subtitle: [participant.level ? `Level ${participant.level}` : null, participant.characterClass]
      .filter(Boolean)
      .join(' '),
    currentHp: participant.currentHitPoints,
    maxHp: participant.maxHitPoints,
    avatarUrl: participant.portraitUrl ?? member.avatarUrl,
  });

  if (protagonist) {
    const encounterPlayer = encounterPlayersByCharacterId.get(protagonist.characterId);
    addMember(
      protagonist.characterId,
      encounterPlayer ? liveMemberFields(protagonist.member, encounterPlayer) : protagonist.member,
    );
  }

  for (const companion of companions) {
    const encounterPlayer = encounterPlayersByCharacterId.get(companion.characterId);
    const companionMember: PartyMemberVM = {
      id: companion.id,
      name: companion.name,
      subtitle: [`Level ${companion.level}`, companion.class].filter(Boolean).join(' '),
      currentHp: 0,
      maxHp: 0,
      avatarUrl: companion.portraitUrl ?? undefined,
    };
    addMember(
      companion.characterId,
      encounterPlayer ? liveMemberFields(companionMember, encounterPlayer) : companionMember,
    );
  }

  for (const participant of encounterPlayers) {
    addMember(participant.characterId ?? participant.id, {
      id: participant.id,
      name: participant.name,
      subtitle: [
        participant.level ? `Level ${participant.level}` : null,
        participant.characterClass,
      ]
        .filter(Boolean)
        .join(' '),
      currentHp: participant.currentHitPoints,
      maxHp: participant.maxHitPoints,
      avatarUrl: participant.portraitUrl,
    });
  }

  return party;
}

export function buildCharacterSheet(character: Character | null): CharacterSheetVM {
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
    return {
      ...empty,
      name: character.name ?? 'Adventurer',
      subtitle: [character.race?.name, character.class?.name].filter(Boolean).join(' · '),
      level: character.level ?? 1,
    };
  }
  const level = character.level ?? 1;
  const xpCurrent = character.experience ?? getExperienceForLevel(level);
  const xpMax = getExperienceForLevel(Math.min(20, level + 1)) || xpCurrent;
  const { current: hpCurrent, maximum: hpMax } = getCharacterSheetHitPoints(character);

  const abilityScores = ABILITY_ORDER.map((a) => {
    const score =
      character.abilityScores?.[a.key as keyof typeof character.abilityScores]?.score ?? 10;
    return { label: a.label, score, modifier: fmt(abilityMod(score)) };
  });

  const savingThrows: NamedModVM[] = ABILITY_ORDER.map((a) => ({
    label: a.label,
    modifier: fmt(
      stats.savingThrowModifiers?.[a.key]?.modifier ??
        abilityMod(character.abilityScores?.[a.key as keyof typeof character.abilityScores]?.score),
    ),
  }));

  // Prefer proficient skills; fall back to a representative set so the panel isn't empty.
  const skillEntries = Object.entries(stats.skillModifiers ?? {});
  const proficient = skillEntries.filter(([, v]) => v.proficient);
  const chosen = (proficient.length ? proficient : skillEntries).slice(0, 8);
  const skills: NamedModVM[] = chosen.map(([name, v]) => ({
    label: name,
    modifier: fmt(v.modifier),
  }));

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
  sessionId?: string;
  messages?: ChatMessage[];
}): GameOverhaulViewModel {
  const { state: campaignState } = useCampaign();
  const { state: characterState } = useCharacter();
  const { state: combatState } = useCombat();

  const campaign = campaignState?.campaign ?? null;
  const character = (characterState?.character ?? null) as Character | null;
  const encounter = combatState?.activeEncounter ?? null;
  const sessionId = opts?.sessionId;
  const messageRevision = opts?.messages
    ? JSON.stringify(
        opts.messages.map((message) => [
          message.id ?? null,
          message.sequenceNumber ?? null,
          message.timestamp ?? null,
          message.text,
        ]),
      )
    : undefined;
  const { data: companionData, refetch: refetchCompanions } = useQuery<SessionCompanionsResponse>({
    queryKey: ['session-companions', sessionId ?? null],
    queryFn: ({ signal }) =>
      sessionId ? getSessionCompanions(sessionId, signal) : Promise.resolve({ companions: [] }),
    enabled: Boolean(sessionId),
    retry: false,
    staleTime: 5_000,
    refetchInterval: sessionId ? SESSION_COMPANION_POLL_INTERVAL_MS : false,
    refetchOnWindowFocus: false,
  });
  const previousMessageRevision = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId || messageRevision === undefined) return;

    const currentRevision = `${sessionId}:${messageRevision}`;
    if (previousMessageRevision.current === null) {
      previousMessageRevision.current = currentRevision;
      return;
    }
    if (previousMessageRevision.current === currentRevision) return;

    previousMessageRevision.current = currentRevision;
    void refetchCompanions();
  }, [messageRevision, refetchCompanions, sessionId]);

  const activeCompanions = companionData?.companions ?? EMPTY_COMPANIONS;

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

    const protagonist = character
      ? {
          characterId: character.id ?? 'self',
          member: {
            id: character.id ?? 'self',
            name: sheet.name,
            subtitle: [`Level ${sheet.level}`, character.class?.name].filter(Boolean).join(' '),
            currentHp: sheet.hpCurrent,
            maxHp: sheet.hpMax,
            avatarUrl: character.image_url ?? character.avatar_url,
          },
        }
      : null;
    const encounterPlayers = (encounter?.participants ?? []).filter(
      (participant): participant is typeof participant & { participantType: 'player' } =>
        participant.participantType === 'player',
    );
    const party = mergePartyMembers(protagonist, activeCompanions, encounterPlayers);

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
      partyMax: 1 + MAX_SESSION_COMPANIONS,
      combat: {
        active: !!encounter,
        round: encounter?.currentRound ?? 1,
        combatants,
      },
      character: sheet,
    };
  }, [activeCompanions, campaign, character, encounter, opts?.chapterLabel, opts?.sceneBlurb]);
}
