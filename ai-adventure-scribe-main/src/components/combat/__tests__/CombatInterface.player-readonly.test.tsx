/**
 * #2257: the player view of the combat tracker shows turn order, HP and the log, and nothing in
 * it starts an action or changes state. These tests render the real tracker parts (only the
 * data hooks are stubbed) so a control added to any of them shows up here.
 */
import { fireEvent, render, screen, within, type RenderResult } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CombatInterface from '../CombatInterface';

import type { SpellCastHandlerRef } from '@/features/game-session/components/game/spell-cast-handler';

import { TooltipProvider } from '@/components/ui/tooltip';
import { wizard as wizardClass } from '@/data/classes/wizard';
import { buildSpellsViewModel } from '@/features/game-session/components/game/overhaul/spell-view-model';
import { useCombatActions } from '@/hooks/use-combat-actions';
import { calculateAllCharacterStats } from '@/utils/character-calculations';
import { convertCharacterDetailsToCharacter } from '@/utils/character-converter';

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: casterCharacter }, dispatch: vi.fn() }),
}));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));
vi.mock('@/features/game-session/components/game/overhaul/useOverhaulViewModel', () => ({
  useOverhaulViewModel: () => ({ character: casterSheet }),
}));

vi.mock('@/hooks/use-combat-actions', () => ({ useCombatActions: vi.fn() }));

const combatState = vi.hoisted(() => ({ activeEncounter: null as unknown }));
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({
    state: { activeEncounter: combatState.activeEncounter, isInCombat: true },
  }),
}));
vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({ getAssetImageUrl: () => null }),
}));

// Real character converter and sheet spell mapper; the picker receives the same full VM
// that RightSheetLive reads from useOverhaulViewModel in a game session.
const casterCharacter = {
  ...convertCharacterDetailsToCharacter({
    id: 'char-1',
    name: 'The Apprentice',
    level: 1,
    character_stats: [
      { intelligence: 16, strength: 10, dexterity: 12, constitution: 10, wisdom: 10, charisma: 10 },
    ],
  }),
  class: wizardClass,
  cantrips: ['chill-touch'],
  knownSpells: ['magic-missile'],
  preparedSpells: ['magic-missile'],
};
const casterSheet = {
  name: casterCharacter.name,
  subtitle: 'Human · Wizard',
  level: 1,
  xpCurrent: 0,
  xpMax: 300,
  hpCurrent: 7,
  hpMax: 7,
  ac: 12,
  initiative: '+1',
  speed: 30,
  abilityScores: [],
  savingThrows: [],
  skills: [],
  attacks: [],
  conditions: [],
  equipment: [],
  inventory: [],
  ...buildSpellsViewModel(casterCharacter, calculateAllCharacterStats(casterCharacter)),
};

const REMOVED_CONTROLS =
  /End Combat|Next Turn|Apply damage|Apply healing|Grapple|Shove|Two-Weapon|Cast Spell|Ready Action|Dash|Dodge|Help|Hide$|Roll Initiative|Initiative$/i;

const participant = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  conditions: [],
  deathSaves: { successes: 0, failures: 0, isStable: false },
  temporaryHitPoints: 0,
  armorClass: 12,
  actionTaken: false,
  bonusActionTaken: false,
  reactionTaken: false,
  ...overrides,
});

const apprentice = (hp: number): Record<string, unknown> =>
  participant({
    id: 'pc',
    name: 'The Apprentice',
    participantType: 'player',
    characterId: 'char-1',
    initiative: 6,
    currentHitPoints: hp,
    maxHitPoints: 7,
  });

const goblin = (hp: number, max = 12): Record<string, unknown> =>
  participant({
    id: 'gob',
    name: 'Goblin Boss',
    participantType: 'monster',
    initiative: 15,
    currentHitPoints: hp,
    maxHitPoints: max,
    monsterData: {
      challengeRating: '1',
      attacks: [{ name: 'Scimitar', damageRoll: '1d6', attackBonus: 4, damageType: 'slashing' }],
    },
  });

function renderFight({
  turn = 'gob',
  playerHp = 7,
  enemyHp = 12,
  round = 2,
  logLines = [] as string[],
  isDM,
  spellCastHandlerRef,
  onSpellCastStart,
}: {
  turn?: 'gob' | 'pc';
  playerHp?: number;
  enemyHp?: number;
  round?: number;
  logLines?: string[];
  isDM?: boolean;
  spellCastHandlerRef?: SpellCastHandlerRef;
  onSpellCastStart?: () => void;
} = {}): RenderResult {
  const pc = apprentice(playerHp);
  const enemy = goblin(enemyHp);
  // The engine lists the higher initiative first, so the goblin acts before the apprentice.
  const encounter = {
    id: 'enc',
    currentRound: round,
    currentTurnParticipantId: turn,
    actions: [],
    participants: [enemy, pc],
  };
  combatState.activeEncounter = encounter;
  vi.mocked(useCombatActions).mockReturnValue({
    state: { showCombatLog: false },
    activeEncounter: encounter,
    isInCombat: true,
    playerParticipants: [pc],
    enemyParticipants: [enemy],
    playerCharacterId: 'char-1',
    isPlayersTurn: turn === 'pc',
    selectedEnemy: null,
    setSelectedEnemy: vi.fn(),
    showCombatMode: true,
    isStartingCombat: false,
    actionValidation: null,
    // A pending reaction is a button that starts an action, so it must not reach a player.
    reactionOpportunities: [
      {
        id: 'opp-1',
        type: 'opportunity_attack',
        triggerParticipantId: 'gob',
        reactorParticipantId: 'pc',
        availableReactions: ['attack'],
      },
    ],
    setReactionOpportunities: vi.fn(),
    localShowInitiativeTracker: true,
    setLocalShowInitiativeTracker: vi.fn(),
    handleStartCombat: vi.fn(),
    handleEndCombat: vi.fn(),
    handleCombatAction: vi.fn(),
    handleEnemyAttack: vi.fn(),
    addEnemy: vi.fn(),
    handleEnhancedAttack: vi.fn(),
    handleRacialTraitUse: vi.fn(),
    handleClassFeature: vi.fn(),
    handleReactionOpportunity: vi.fn(),
    handleDeathSave: vi.fn(),
    handleConcentrationSave: vi.fn(),
    handleTwoWeaponAttack: vi.fn(),
    handleApplyDamage: vi.fn(),
    handleHealing: vi.fn(),
    nextTurn: vi.fn(),
    rollInitiative: vi.fn(),
    showAdvantageModal: false,
    setShowAdvantageModal: vi.fn(),
    pendingAttack: null,
    setPendingAttack: vi.fn(),
  } as never);
  return render(
    <TooltipProvider>
      <CombatInterface
        logLines={logLines}
        spellCastHandlerRef={spellCastHandlerRef}
        onSpellCastStart={onSpellCastStart}
        {...(isDM === undefined ? {} : { isDM })}
      />
    </TooltipProvider>,
  );
}

const buttonNames = (): string[] =>
  screen
    .queryAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '');

describe('CombatInterface player view (#2257)', () => {
  beforeEach(() => {
    vi.mocked(useCombatActions).mockReset();
  });

  it('has none of the removed controls in the DOM, on your turn or the enemy turn', () => {
    for (const turn of ['pc', 'gob'] as const) {
      const { unmount } = renderFight({ turn });
      for (const name of buttonNames()) expect(name).not.toMatch(REMOVED_CONTROLS);
      expect(screen.queryByRole('button', { name: /End Combat|Next Turn/i })).toBeNull();
      expect(screen.queryByLabelText(/Apply damage|Apply healing/i)).toBeNull();
      // No damage or healing inputs, no attack buttons on the enemy card.
      expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
      expect(screen.queryByText('Scimitar')).toBeNull();
      expect(screen.queryByText('Reaction Opportunities')).toBeNull();
      unmount();
    }
  });

  it('leaves the tracker show/hide toggle as its only button', () => {
    renderFight();
    expect(buttonNames()).toEqual(['Hide initiative tracker']);
  });

  it('titles the panel "Turn order · Round n"', () => {
    renderFight({ round: 2 });
    expect(screen.getByText('Turn order · Round 2')).toBeInTheDocument();
  });

  it('names the engine turn pointer: enemy turn first, then "Your turn"', () => {
    const { unmount } = renderFight({ turn: 'gob' });
    expect(screen.getByText("Goblin Boss's turn")).toBeInTheDocument();
    expect(screen.queryByText('Your turn')).toBeNull();
    unmount();

    renderFight({ turn: 'pc' });
    expect(screen.getByText('Your turn')).toBeInTheDocument();
    expect(screen.queryByText("The Apprentice's Turn")).toBeNull();
  });

  it('highlights the participant the engine points at, not the one listed last', () => {
    renderFight({ turn: 'gob' });
    const rows = screen.getAllByTestId('participant-row');
    expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual(['true', null]);
    expect(within(rows[0]).getByText('Goblin Boss')).toBeInTheDocument();
  });

  it('shows the player HP as "5 / 7" text with a 6 px bar, warn colour when hurt', () => {
    renderFight({ playerHp: 3 });
    expect(screen.getByText('3 / 7')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'The Apprentice health: 3 / 7 HP' });
    expect(bar.className).toContain('h-1.5');
    expect(bar.firstElementChild?.className).toContain('bg-amber-500');
  });

  it('shows a player at 0 HP as "0 / 7"', () => {
    renderFight({ playerHp: 0 });
    expect(screen.getByText('0 / 7')).toBeInTheDocument();
  });

  it.each([
    [12, 'Healthy'],
    [8, 'Hurt'],
    [5, 'Bloodied'],
    [0, 'Down'],
  ])('shows an enemy at %i/12 as the tier %s and never as a number', (hp, tier) => {
    renderFight({ enemyHp: hp });
    const card = screen.getByText('Goblin Boss', { selector: 'h3, div' }).closest('.w-full');
    expect(within(card as HTMLElement).getByText(tier, { exact: false })).toBeInTheDocument();

    const enemyRow = screen
      .getAllByTestId('participant-row')
      .find((row) => within(row).queryByText('Goblin Boss'));
    expect(enemyRow).toBeDefined();
    expect(within(enemyRow as HTMLElement).getByText(tier)).toBeInTheDocument();

    const enemyText = `${(card as HTMLElement).textContent} ${enemyRow?.textContent}`;
    expect(enemyText).not.toMatch(new RegExp(`\\b${hp}\\s*/\\s*12\\b`));
    expect(enemyText).not.toMatch(/\bHP\b.*\d/);
    // The player's own numbers stay; the enemy's must not appear anywhere in the tracker.
    expect(document.body.textContent).not.toMatch(new RegExp(`(^|\\D)${hp}\\s*/\\s*12(\\D|$)`));
  });

  it('shows the empty log copy, then the lines it is given latest first', () => {
    const { unmount } = renderFight();
    expect(screen.getByText('Combat log')).toBeInTheDocument();
    expect(screen.getByText('Nothing has happened yet.')).toBeInTheDocument();
    expect(screen.queryByText(/will appear here/i)).toBeNull();
    unmount();

    renderFight({
      logLines: [
        '⚙️ Engine: Goblin Boss attacks: HIT for 4.',
        '⚙️ Engine: The Apprentice attacks: MISS.',
      ],
    });
    const items = within(screen.getByRole('list', { name: 'Combat log entries' })).getAllByRole(
      'listitem',
    );
    expect(items.map((item) => item.textContent)).toEqual([
      'Goblin Boss attacks: HIT for 4.',
      'The Apprentice attacks: MISS.',
    ]);
  });

  it('keeps the game-master controls behind isDM', () => {
    const castHandler = vi.fn(() => new Promise<void>(() => {}));
    const closeTracker = vi.fn();
    renderFight({
      turn: 'pc',
      isDM: true,
      spellCastHandlerRef: { current: castHandler },
      onSpellCastStart: closeTracker,
    });
    expect(
      screen.getByRole('button', { name: /End current combat encounter/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next Turn/i })).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Apply damage to/i).length).toBeGreaterThan(0);
    const cast = screen.getByRole('button', { name: 'Cast Spell' });
    expect(cast).toBeInTheDocument();
    fireEvent.click(cast);
    expect(screen.getByRole('dialog')).toHaveTextContent('Cast Spell — your character');
    fireEvent.click(screen.getByRole('button', { name: 'Cast Chill Touch' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(closeTracker).toHaveBeenCalledOnce();
    expect(castHandler).toHaveBeenCalledWith(
      'I cast Chill Touch [spell_id=chill-touch, spell_level=cantrip].',
      { intent: 'spell_cast', spellId: 'chill-touch', spellLevel: 0 },
    );
    expect(
      vi.mocked(useCombatActions).mock.results.at(-1)?.value.handleCombatAction,
    ).not.toHaveBeenCalled();
  });
});
