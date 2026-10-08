/**
 * #2641 item 1 (run D9): from round 3 the party/tracker rows read "The Veteran 1/12" while the
 * header read "HP 5/12". The tracker follows the encounter participant (the server wire value); the
 * header reads CharacterContext, which was refetched by one route only: the socket's
 * `combat-state-updated` event. A hit that arrived by a pull (`refreshCombatState`, after the
 * End turn response) reached the encounter and never the character, and a fight that ended in the
 * same read as its last hit cleared the encounter with the header still at the old value.
 *
 * One path now: the pull raises the same event the socket does, and the one character refetch
 * (`useCharacterRefreshOnCombatUpdate`) answers it. Nothing else writes the character's HP.
 *
 * Real: CombatProvider, mapAuthoritativeCombat, CharacterProvider, the character reducer, the
 * refresh hook and the StatsBar. Stubbed: `fetch` for `/v1/combat/sessions/:id/active`, and the
 * character loader (the API edge) answering with what the server's stats row holds. The character
 * is built the way production does it: the API's raw `stats` shape through the real
 * `normalizeCharacter` and `hydrateCharacterStats`.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StatsBar } from '../StatsBar';
import { useCharacterRefreshOnCombatUpdate } from '../use-character-refresh';

import { CharacterProvider, useCharacter } from '@/contexts/CharacterContext';
import { CombatProvider, useCombat } from '@/contexts/CombatContext';
import { buildAbilityScores } from '@/services/build-ability-scores';
import { characterLoaderService } from '@/services/character-loader';
import { hydrateCharacterStats } from '@/services/hydrate-character-stats';
import { normalizeCharacter } from '@/services/user-data-payload-helpers';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/services/character-loader', () => ({
  characterLoaderService: { loadCharacterWithSpells: vi.fn() },
}));
vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer test' })),
  getAccessToken: vi.fn(() => 'test'),
}));

const SESSION_ID = 'session-d9';
const CHARACTER_ID = '4b6ec35d-45eb-427b-b8db-7299a6dd4d77';

/** The raw `GET /v1/characters/:id` shape: a premade Fighter whose stats row is `stats`. */
const rawCharacter = () => ({
  id: CHARACTER_ID,
  name: 'The Veteran',
  class: 'Fighter',
  level: 1,
  stats: {
    strength: 16,
    dexterity: 12,
    constitution: 14,
    intelligence: 10,
    wisdom: 13,
    charisma: 10,
    max_hit_points: 12,
    current_hit_points: 12,
    armor_class: 18,
  },
});

/**
 * The character the game screen holds: `loadCharacterWithSpells` runs the API's raw character
 * through `normalizeCharacter` and copies the stats row with `hydrateCharacterStats`.
 */
const loadedCharacter = (currentHp: number) => {
  const raw = normalizeCharacter(rawCharacter());
  const stats = raw.character_stats[0];
  return {
    id: raw.id,
    name: raw.name,
    level: raw.level,
    abilityScores: buildAbilityScores({
      strength: stats.strength,
      dexterity: stats.dexterity,
      constitution: stats.constitution,
      intelligence: stats.intelligence,
      wisdom: stats.wisdom,
      charisma: stats.charisma,
    }),
    character_stats: hydrateCharacterStats({ ...stats, current_hit_points: currentHp }),
  };
};

type Vital = 'standing' | 'dying' | 'stabilized';

/**
 * The `combat` envelope `/active` returns: the encounter row and participant rows with their
 * `status`, as `CombatEncounterService.getCombatState` sets them.
 */
const combatPayload = (
  hp: number,
  vital: Vital,
  encounterStatus: 'active' | 'completed' = 'active',
) => ({
  encounter: {
    id: 'enc-1',
    sessionId: SESSION_ID,
    status: encounterStatus,
    currentRound: 3,
    currentTurnOrder: 0,
    startedAt: '2026-10-06T23:40:00.000Z',
    endedAt: encounterStatus === 'completed' ? '2026-10-06T23:50:00.000Z' : null,
    pendingIntent: null,
  },
  participants: [
    {
      id: 'pc-1',
      encounterId: 'enc-1',
      characterId: CHARACTER_ID,
      name: 'The Veteran',
      participantType: 'player',
      initiative: 21,
      initiativeModifier: 1,
      turnOrder: 0,
      isActive: true,
      armorClass: 18,
      maxHp: 12,
      speed: 30,
      actionUsed: false,
      bonusActionUsed: false,
      reactionUsed: false,
      conditions: [],
      vitalState: vital,
      status: {
        participantId: 'pc-1',
        currentHp: hp,
        maxHp: 12,
        tempHp: 0,
        isConscious: hp > 0,
        deathSavesSuccesses: 0,
        deathSavesFailures: 0,
      },
    },
    {
      id: 'npc-1',
      encounterId: 'enc-1',
      characterId: null,
      name: 'The Silent Monk 1',
      participantType: 'monster',
      initiative: 6,
      initiativeModifier: 0,
      turnOrder: 1,
      isActive: true,
      armorClass: 12,
      maxHp: 9,
      speed: 30,
      conditions: [],
      vitalState: 'standing',
      status: {
        participantId: 'npc-1',
        currentHp: 9,
        maxHp: 9,
        tempHp: 0,
        isConscious: true,
        deathSavesSuccesses: 0,
        deathSavesFailures: 0,
      },
    },
  ],
});

/** What the server holds right now; `/active` and the character's stats row both read it. */
const server: { hp: number; vital: Vital; fight: 'active' | 'concluded' | 'none' } = {
  hp: 12,
  vital: 'standing',
  fight: 'active',
};

type Api = {
  /** The pull: `refreshCombatState()`, as the turn pipeline calls it after the End turn response. */
  pull: () => Promise<unknown>;
  encounterHp: () => number | undefined;
  inCombat: () => boolean;
  playerState: () => { isUnconscious?: boolean; isStable?: boolean } | undefined;
};

const Harness = ({ onReady }: { onReady: (api: Api) => void }) => {
  const { dispatch } = useCharacter();
  const combat = useCombat();
  React.useEffect(() => {
    dispatch({ type: 'SET_CHARACTER', payload: loadedCharacter(12) as never });
  }, [dispatch]);
  // The same refetch GameContent mounts (via useGameData); nothing else writes the character.
  useCharacterRefreshOnCombatUpdate(CHARACTER_ID, 'user-1', dispatch);
  const player = () =>
    combat.state.activeEncounter?.participants.find((p) => p.participantType === 'player');
  onReady({
    pull: () => combat.refreshCombatState(),
    encounterHp: () => player()?.currentHitPoints,
    inCombat: () => Boolean(combat.state.activeEncounter),
    playerState: () =>
      player() && { isUnconscious: player()?.isUnconscious, isStable: player()?.isStable },
  });
  return <StatsBar />;
};

const mount = (): (() => Api) => {
  let api!: Api;
  render(
    <CharacterProvider>
      <CombatProvider sessionId={SESSION_ID}>
        <Harness onReady={(next) => (api = next)} />
      </CombatProvider>
    </CharacterProvider>,
  );
  return () => api;
};

/** One pull, with the server at `hp`, then the refetch it raises has had time to answer. */
const pullAt = async (api: () => Api, hp: number, vital: Vital = 'standing'): Promise<void> => {
  server.hp = hp;
  server.vital = vital;
  await act(async () => {
    await api().pull();
  });
};

beforeEach(() => {
  server.hp = 12;
  server.vital = 'standing';
  server.fight = 'active';
  vi.mocked(characterLoaderService.loadCharacterWithSpells).mockImplementation(
    async () => loadedCharacter(server.hp) as never,
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (!String(url).includes('/active')) throw new Error(`unexpected fetch: ${url}`);
      if (server.fight === 'none') return { ok: false, status: 404, json: async () => ({}) };
      const status = server.fight === 'concluded' ? 'completed' : 'active';
      return {
        ok: true,
        status: 200,
        json: async () => ({ combat: combatPayload(server.hp, server.vital, status) }),
      };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the header HP follows the server through the pull path (#2641)', () => {
  it('shows each hit that arrives by a pull, with no socket event', async () => {
    const api = mount();
    await waitFor(() => expect(screen.getByText('12/12')).toBeInTheDocument());

    await pullAt(api, 5);
    expect(api().encounterHp()).toBe(5);
    await waitFor(() => expect(screen.getByText('5/12')).toBeInTheDocument());

    await pullAt(api, 1);
    expect(api().encounterHp()).toBe(1);
    await waitFor(() => expect(screen.getByText('1/12')).toBeInTheDocument());
    expect(screen.queryByText('5/12')).not.toBeInTheDocument();
  });

  it('keeps the last hit when it lands in the pull that ends the fight', async () => {
    const api = mount();
    await waitFor(() => expect(screen.getByText('12/12')).toBeInTheDocument());
    await pullAt(api, 5);
    await waitFor(() => expect(screen.getByText('5/12')).toBeInTheDocument());

    // 5 -> 2, and the fight is over in the same read: the participant never shows the 2.
    server.fight = 'concluded';
    await pullAt(api, 2);
    expect(api().inCombat()).toBe(false);
    await waitFor(() => expect(screen.getByText('2/12')).toBeInTheDocument());

    // The encounter is gone and the header stays on the server's value.
    server.fight = 'none';
    await pullAt(api, 2);
    expect(api().inCombat()).toBe(false);
    expect(screen.getByText('2/12')).toBeInTheDocument();
  });

  it('follows the player to 0, then stable, then a heal', async () => {
    const api = mount();
    await waitFor(() => expect(screen.getByText('12/12')).toBeInTheDocument());

    await pullAt(api, 0, 'dying');
    expect(api().playerState()).toMatchObject({ isUnconscious: true, isStable: false });
    await waitFor(() => expect(screen.getByText('0/12')).toBeInTheDocument());

    await pullAt(api, 0, 'stabilized');
    expect(api().playerState()).toMatchObject({ isUnconscious: true, isStable: true });
    expect(screen.getByText('0/12')).toBeInTheDocument();

    await pullAt(api, 4, 'standing');
    expect(api().playerState()).toMatchObject({ isUnconscious: false, isStable: false });
    await waitFor(() => expect(screen.getByText('4/12')).toBeInTheDocument());
    expect(screen.queryByText('0/12')).not.toBeInTheDocument();
  });

  it('does not refetch the character on a pull that moved nobody', async () => {
    const api = mount();
    await waitFor(() => expect(screen.getByText('12/12')).toBeInTheDocument());
    await pullAt(api, 5);
    await waitFor(() => expect(screen.getByText('5/12')).toBeInTheDocument());
    const refetches = vi.mocked(characterLoaderService.loadCharacterWithSpells).mock.calls.length;

    await pullAt(api, 5);
    await pullAt(api, 5);

    expect(vi.mocked(characterLoaderService.loadCharacterWithSpells).mock.calls.length).toBe(
      refetches,
    );
  });

  it('keeps the rest of the stats row', async () => {
    const api = mount();
    await waitFor(() => expect(screen.getByText('12/12')).toBeInTheDocument());
    await pullAt(api, 7);
    await waitFor(() => expect(screen.getByText('7/12')).toBeInTheDocument());
    // AC comes from the same stats row.
    expect(screen.getByText('18')).toBeInTheDocument();
  });
});
