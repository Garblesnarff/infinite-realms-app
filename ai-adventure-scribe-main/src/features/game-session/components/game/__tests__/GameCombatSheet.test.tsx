/**
 * #2257: the campaign owner is every player in a solo campaign, so the sheet must not turn the
 * owner flag into game-master controls outside dev builds, and it feeds the log from the chat.
 */
import { render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GameCombatSheet } from '../game-content/GameCombatSheet';

import type { ChatMessage } from '@/types/game';

import { TooltipProvider } from '@/components/ui/tooltip';
import { useCombatActions } from '@/hooks/use-combat-actions';

vi.mock('@/hooks/use-combat-actions', () => ({ useCombatActions: vi.fn() }));

const mocks = vi.hoisted(() => ({ encounter: null as unknown, messages: [] as unknown[] }));
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({ state: { activeEncounter: mocks.encounter, isInCombat: true } }),
}));
vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({ getAssetImageUrl: () => null }),
}));
vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({ messages: mocks.messages }),
}));

const base = {
  conditions: [],
  deathSaves: { successes: 0, failures: 0, isStable: false },
  temporaryHitPoints: 0,
  armorClass: 12,
};
const pc = {
  ...base,
  id: 'pc',
  name: 'The Apprentice',
  participantType: 'player',
  characterId: 'c1',
  initiative: 6,
  currentHitPoints: 7,
  maxHitPoints: 7,
};
const gob = {
  ...base,
  id: 'gob',
  name: 'Goblin Boss',
  participantType: 'monster',
  initiative: 15,
  currentHitPoints: 12,
  maxHitPoints: 12,
};

const GM_CONTROLS = /End current combat|Next Turn|Apply damage|Apply healing|Grapple|Cast Spell/i;

function renderSheet(isDM: boolean, showTracker = true): void {
  const encounter = {
    id: 'e',
    currentRound: 2,
    currentTurnParticipantId: 'gob',
    actions: [],
    participants: [gob, pc],
  };
  mocks.encounter = encounter;
  vi.mocked(useCombatActions).mockReturnValue({
    state: { showCombatLog: false },
    activeEncounter: encounter,
    isInCombat: true,
    playerParticipants: [pc],
    enemyParticipants: [gob],
    isPlayersTurn: false,
    selectedEnemy: null,
    setSelectedEnemy: vi.fn(),
    showCombatMode: true,
    actionValidation: null,
    reactionOpportunities: [],
    setReactionOpportunities: vi.fn(),
    localShowInitiativeTracker: true,
    setLocalShowInitiativeTracker: vi.fn(),
  } as never);
  render(
    <TooltipProvider>
      <GameCombatSheet showTracker={showTracker} setShowTracker={vi.fn()} isDM={isDM} />
    </TooltipProvider>,
  );
}

const controls = (): string[] =>
  screen
    .queryAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '')
    .filter((name) => GM_CONTROLS.test(name));

describe('GameCombatSheet (#2257)', () => {
  beforeEach(() => {
    mocks.messages = [];
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('gives the campaign owner no game-master controls in a production build', () => {
    vi.stubEnv('DEV', false);
    renderSheet(true);
    expect(controls()).toEqual([]);
    expect(screen.queryAllByLabelText(/Apply damage|Apply healing/i)).toHaveLength(0);
  });

  it('keeps them for the owner in a dev build, for debugging', () => {
    vi.stubEnv('DEV', true);
    renderSheet(true);
    expect(controls().length).toBeGreaterThan(0);
  });

  it('never gives them to a non-owner, dev build or not', () => {
    vi.stubEnv('DEV', true);
    renderSheet(false);
    expect(controls()).toEqual([]);
  });

  it('is full width below sm so it is not cut off at 390 px', () => {
    vi.stubEnv('DEV', false);
    renderSheet(false);
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('w-full');
    expect(dialog.className).toContain('sm:w-[420px]');
    expect(dialog.className).toContain('sm:max-w-[480px]');
  });

  it('fills the log from the engine lines in the chat', () => {
    vi.stubEnv('DEV', false);
    mocks.messages = [
      {
        sender: 'dm',
        text: '⚙️ Engine: Goblin Boss attacks: HIT for 3.\nYou stagger.',
        context: { combatEncounterId: 'e' },
      },
      { sender: 'player', text: 'I swing back' },
      {
        sender: 'dm',
        text: '⚙️ Engine: The Apprentice attacks: MISS.\nThe blade whistles by.',
        context: { combatEncounterId: 'e' },
      },
    ] satisfies ChatMessage[];
    renderSheet(false);
    const entries = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(entries).toEqual(['The Apprentice attacks: MISS.', 'Goblin Boss attacks: HIT for 3.']);
    expect(screen.queryByText('Nothing has happened yet.')).toBeNull();
  });

  it('shows only engine lines from the live encounter', () => {
    vi.stubEnv('DEV', false);
    mocks.messages = [
      {
        sender: 'dm',
        text: '⚙️ Engine: Earlier Goblin attacks: HIT for 2.',
        context: { combatEncounterId: 'earlier-encounter' },
      },
      {
        sender: 'dm',
        text: '⚙️ Engine: Live Goblin attacks: MISS.',
        context: { combatEncounterId: 'e' },
      },
    ] satisfies ChatMessage[];
    renderSheet(false);
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Live Goblin attacks: MISS.',
    ]);
    expect(screen.queryByText('Earlier Goblin attacks: HIT for 2.')).toBeNull();
  });

  it('shows an untagged engine line in the live encounter (restored history, seating card)', () => {
    vi.stubEnv('DEV', false);
    mocks.messages = [
      {
        sender: 'dm',
        text: '⚙️ Engine: The seating card resolves.',
        // No context: restored history and the seating card carry no
        // encounter tag, but they belong to the live encounter.
      },
      {
        sender: 'dm',
        text: '⚙️ Engine: Live Goblin attacks: MISS.',
        context: { combatEncounterId: 'e' },
      },
    ] satisfies ChatMessage[];
    renderSheet(false);
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Live Goblin attacks: MISS.',
      'The seating card resolves.',
    ]);
  });

  it('says nothing has happened when the chat has no engine lines', () => {
    vi.stubEnv('DEV', false);
    mocks.messages = [{ sender: 'dm', text: 'Roll for initiative.' }] satisfies ChatMessage[];
    renderSheet(false);
    expect(screen.getByText('Nothing has happened yet.')).toBeInTheDocument();
  });
});
