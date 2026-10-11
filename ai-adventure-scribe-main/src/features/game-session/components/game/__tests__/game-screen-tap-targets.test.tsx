/**
 * #228: each game-screen control group uses the #2258 token classes.
 * `.ir-hit` is a 44px box. `.ir-hit-slop` keeps the painted size and extends a 44px tap.
 * `.ir-text-min` is 12px. Icons keep their own size classes.
 */
import { readFileSync } from 'node:fs';

import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DMMessageVoiceControls } from '@/components/game/voice/DMMessageVoiceControls';
import { IRModRow, IRStatTile } from '@/components/ui/ir-primitives';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChatInput } from '@/features/game-session/components/chat/ChatInput';
import { DesktopGameSidePanel } from '@/features/game-session/components/game/DesktopGameSidePanel';
import { BuildSessionStatus } from '@/features/game-session/components/game/game-content/BuildSessionStatus';
import { GamePanelControls } from '@/features/game-session/components/game/game-content/GamePanelControls';
import { TargetNumbersToggle } from '@/features/game-session/components/game/game-content/TargetNumbersToggle';
import { LeftRail } from '@/features/game-session/components/game/overhaul/LeftRail';
import { MOCK_VIEW_MODEL } from '@/features/game-session/components/game/overhaul/mockData';
import { SceneHeader } from '@/features/game-session/components/game/overhaul/SceneHeader';
import { TimelineRail } from '@/features/game-session/components/game/TimelineRail';

vi.mock('@/services/app-version', () => ({
  APP_BUILD_SHORT: 'abc12345',
}));

vi.mock('@/features/game-session/hooks/use-show-target-numbers', () => ({
  useShowTargetNumbers: () => ({ showTargetNumbers: true, setShowTargetNumbers: vi.fn() }),
}));

vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({
    messages: [
      { id: 'dm-1', sender: 'dm', text: 'The gate opens.', timestamp: '2021-01-01T00:00:00Z' },
    ],
  }),
}));

vi.mock('@/contexts/VoiceContext', () => ({
  useVoiceContext: () => ({
    currentPlayingId: null,
    isPlaying: false,
    playMessage: vi.fn(),
    pauseMessage: vi.fn(),
    volume: 1,
    isMuted: false,
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
  }),
}));

const overhaulCss = readFileSync('src/styles/ir-overhaul.css', 'utf8');

/** jsdom drops the full sheet (`@apply`) and does not compute ::before. Inject the plain rules. */
function mountTokens(): void {
  const block = (selector: string): string =>
    overhaulCss.match(new RegExp(`${selector}\\s*\\{[^}]*\\}`))?.[0] ?? '';
  const hit = overhaulCss.match(/--ir-hit-min:\s*([^;]+);/)?.[1]?.trim();
  const text = overhaulCss.match(/--ir-text-min:\s*([^;]+);/)?.[1]?.trim();
  const style = document.createElement('style');
  style.textContent = [
    `.ir-app { --ir-hit-min: ${hit}; --ir-text-min: ${text}; }`,
    block('\\.ir-app \\.ir-hit'),
    block('\\.ir-app \\.ir-text-min'),
    block('\\.ir-app \\.ir-panel-h'),
  ].join('\n');
  document.head.appendChild(style);
}

function inApp(ui: React.ReactElement): ReturnType<typeof render> {
  return render(
    <div className="ir-app">
      <TooltipProvider>{ui}</TooltipProvider>
    </div>,
  );
}

/**
 * jsdom does not resolve custom properties, so the computed box is the token
 * name. The stylesheet source is what pins that token to 44px.
 */
function expectHit(el: Element): void {
  expect(el).toHaveClass('ir-hit');
  const style = getComputedStyle(el);
  expect(style.minWidth).toBe('var(--ir-hit-min)');
  expect(style.minHeight).toBe('var(--ir-hit-min)');
  expect(overhaulCss).toMatch(/--ir-hit-min:\s*44px;/);
}

/** Same unresolved-variable limit as expectHit. The source pins the token to 12px. */
function expectTextFloor(el: Element): void {
  expect(getComputedStyle(el).fontSize).toBe('var(--ir-text-min)');
  expect(overhaulCss).toMatch(/--ir-text-min:\s*12px;/);
}

/** The tap extension is the ::before in the stylesheet. jsdom does not measure it. */
function expectSlop(el: Element): void {
  expect(el).toHaveClass('ir-hit-slop');
  expect(overhaulCss).toMatch(
    /\.ir-app \.ir-hit-slop::before\s*\{[^}]*width:\s*var\(--ir-hit-min\);\s*height:\s*var\(--ir-hit-min\);/,
  );
  expect(overhaulCss).toMatch(/--ir-hit-min:\s*44px;/);
  expect(getComputedStyle(el).minWidth).not.toBe('44px');
  expect(getComputedStyle(el).minHeight).not.toBe('44px');
}

describe('game screen tap targets and text (#228)', () => {
  beforeAll(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    if (!('speechSynthesis' in window)) {
      Object.defineProperty(window, 'speechSynthesis', { value: {}, configurable: true });
    }
  });

  beforeEach(() => {
    mountTokens();
  });

  describe('header toolbar', () => {
    it('gives each toolbar button a 44px box and the build chip 12px text', () => {
      inApp(
        <MemoryRouter>
          <BuildSessionStatus sessionId="72ff7843-6e2d-41ae-9e48-5c5294a31244" />
          <GamePanelControls
            isLeftCollapsed={false}
            isRightCollapsed={false}
            showSceneBlurb
            onLeftToggle={vi.fn()}
            onRightToggle={vi.fn()}
            onSceneBlurbToggle={vi.fn()}
          />
          <TargetNumbersToggle />
        </MemoryRouter>,
      );

      for (const name of [
        'Hide Campaign',
        'Hide Character',
        'Hide Blurb',
        'Send feedback',
        'Show target numbers: On',
      ]) {
        expectHit(screen.getByRole('button', { name }));
      }
      const chip = screen.getByTestId('build-session-status');
      expectSlop(chip);
      expect(chip).toHaveClass('ir-text-min');
      expectTextFloor(chip);
    });
  });

  describe('Scene Info', () => {
    it('is a 44px control with 12px text', () => {
      inApp(<SceneHeader title="The Old Watchtower" onSceneInfo={vi.fn()} />);
      const chip = screen.getByRole('button', { name: 'Scene Info' });
      expectHit(chip);
      expect(chip).toHaveClass('ir-text-min');
      expectTextFloor(chip);
    });
  });

  describe('composer Attach, Emoji, and Dice', () => {
    it('keeps the icons and gives each button a 44px box', () => {
      inApp(<ChatInput onSendMessage={vi.fn()} isDisabled={false} />);
      for (const name of ['Attach file', 'Insert emoji', 'Quick dice roll (1d20)']) {
        const button = screen.getByRole('button', { name });
        expectHit(button);
        expect(button.querySelector('svg')?.getAttribute('class')).toMatch(/h-5/);
      }
    });
  });

  describe('panel controls', () => {
    it('keeps the 32px chrome and extends a 44px tap', () => {
      const ref = { current: document.createElement('div') };
      inApp(
        <DesktopGameSidePanel
          panelRef={ref}
          panelWidth="320px"
          dragHandleRef={ref}
          startDrag={vi.fn()}
          isInCombat={false}
          activeTab="character"
          handleTabChange={vi.fn()}
          isExpanded={false}
          setIsExpanded={vi.fn()}
          onToggle={vi.fn()}
          sessionNotesId=""
          localSessionNotes=""
          setLocalSessionNotes={vi.fn()}
          handleSaveNotes={vi.fn()}
          selectedType={null}
          setSelectedType={vi.fn()}
          memoriesLoading={false}
          sortedMemories={[]}
          journalLoading={false}
          journalEntries={[]}
        />,
      );
      for (const name of ['Character Sheet', 'Memories', 'Journal', 'Expand', 'Close Panel']) {
        const button = screen.getByRole('button', { name });
        expect(button.className).toContain('h-8');
        expectSlop(button);
        const icon = button.querySelector('svg');
        expect(icon?.getAttribute('class')).toMatch(/h-4/);
      }
    });
  });

  describe('timeline Jump to DM message dots', () => {
    it('stays a bead and extends a 44px tap', () => {
      const rootRef = { current: document.createElement('div') };
      inApp(<TimelineRail rootRef={rootRef} />);
      const dot = screen.getByRole('button', { name: 'Jump to DM message 1' });
      expect(dot).toHaveClass('timeline-dot');
      expect(dot).not.toHaveClass('ir-tts');
      expectSlop(dot);
    });
  });

  describe('TTS control', () => {
    it('is a gold control, not a timeline dot, with a 44px tap and the same icon', () => {
      inApp(<DMMessageVoiceControls messageId="msg-1" messageText="The gate opens." />);
      const play = screen.getByRole('button', { name: /play this message/i });
      expect(play).toHaveClass('ir-tts');
      expect(play).not.toHaveClass('timeline-dot');
      expect(play.className).not.toContain('rounded-full');
      expectSlop(play);
      // Button's [&_svg]:size-4 wins over the h-3 class on the icon. The icon is not enlarged.
      expect(play.querySelector('svg')?.getAttribute('class')).toMatch(/\bh-4\b/);
      expect(play.querySelector('svg')?.getAttribute('class')).not.toMatch(
        /\bh-5\b|\bh-6\b|\bh-8\b/,
      );
    });
  });

  describe('sidebar Party and Chapter, and sheet modifiers', () => {
    it('uses the 12px text floor', () => {
      inApp(
        <>
          <LeftRail
            campaign={MOCK_VIEW_MODEL.campaign}
            party={MOCK_VIEW_MODEL.party}
            partyMax={MOCK_VIEW_MODEL.partyMax}
            combat={MOCK_VIEW_MODEL.combat}
          />
          <IRStatTile label="STR" value={16} sub="+3" />
          <IRModRow label="Athletics" modifier="+5" />
        </>,
      );
      for (const text of [
        'Party',
        'Chapter 2: Whispers in the Fog',
        'Level 5 Cleric',
        'STR',
        '+3',
        'Athletics',
        '+5',
      ]) {
        expectTextFloor(screen.getByText(text));
      }
    });
  });
});
