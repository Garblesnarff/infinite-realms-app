import { fireEvent, render, screen, type RenderResult } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CombatEntryConfirmation } from '../CombatEntryConfirmation';

import type { PendingCombatEntryConfirmation } from '@/hooks/combat/use-combat-entry-confirmation-host';
import type { CombatEntryConfirmationSpec } from '@/services/combat/combat-entry-confirmation-bridge';

import logger from '@/lib/logger';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const spec = (
  overrides: Partial<CombatEntryConfirmationSpec> = {},
): CombatEntryConfirmationSpec => {
  const base: CombatEntryConfirmationSpec = {
    actorLabel: 'Vance',
    combatantLabels: ['Vance'],
    initiativeRoll: null,
    initiativeModifier: 0,
  };
  return { ...base, ...overrides };
};

const renderCard = (confirmation: PendingCombatEntryConfirmation): RenderResult =>
  render(<CombatEntryConfirmation confirmation={confirmation} />);

describe('CombatEntryConfirmation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers Start the fight and Do something else for the entry prompt', () => {
    const confirm = vi.fn();
    const decline = vi.fn();
    const confirmation = { spec: spec(), confirm, decline };

    renderCard(confirmation);

    const overlay = screen.getByTestId('combat-entry-confirmation-overlay');
    const card = overlay.firstElementChild;
    // The card sits in the RollTray slot in the message flow, not on top of it:
    // its ancestor is the RollTray slot element and its own box is neither
    // fixed, absolute, nor sticky.
    expect(overlay.parentElement?.getAttribute('data-testid')).toBe('roll-tray');
    expect(card?.className).not.toMatch(/(^|\s)(fixed|absolute|sticky)(\s|$)/);
    expect(card?.className).toContain('bg-card');
    expect(card?.className).toContain('border-infinite-gold');
    expect(card?.className).toContain('shadow-2xl');

    expect(screen.getByText('A fight is starting')).toBeTruthy();
    expect(screen.getByText('Fight the Vance?')).toBeTruthy();
    expect(
      screen.getByText(
        'If you go ahead, everyone rolls initiative, then turns go in order. You can still talk or do something else instead.',
      ),
    ).toBeTruthy();

    const start = screen.getByRole('button', { name: 'Start the fight' });
    const other = screen.getByRole('button', { name: 'Do something else' });
    expect(start.getAttribute('data-action')).toBe('confirm');
    expect(other.getAttribute('data-action')).toBe('decline');

    fireEvent.click(start);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(undefined);
    fireEvent.click(other);
    expect(decline).toHaveBeenCalledTimes(1);
  });

  it('names the declared target and the rest in the title (#86)', () => {
    const confirmation = {
      spec: spec({
        declaredTargets: ['Professor Emil Darkwater'],
        otherCombatants: ['Captain Sarah Reeves'],
      }),
      confirm: vi.fn(),
      decline: vi.fn(),
    };

    renderCard(confirmation);

    expect(screen.getByText('Fight the Professor Emil Darkwater and 1 more?')).toBeTruthy();
    expect(screen.getByText('Also joining the fight: Captain Sarah Reeves.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start the fight' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Do something else' })).toBeTruthy();
  });

  it('titles an attack by the weapon verb (#86)', () => {
    const confirmation = {
      spec: spec({
        attackSource: 'weapon',
        declaredTargets: ['Vitruvian Spider'],
      }),
      confirm: vi.fn(),
      decline: vi.fn(),
    };

    renderCard(confirmation);

    expect(screen.getByText('Attack the Vitruvian Spider?')).toBeTruthy();
  });

  it('titles a spell by its name (#86)', () => {
    const confirmation = {
      spec: spec({
        attackSource: 'spell',
        spellName: 'Chill Touch',
        declaredTargets: ['Flavor-Elemental'],
      }),
      confirm: vi.fn(),
      decline: vi.fn(),
    };

    renderCard(confirmation);

    expect(screen.getByText('Cast Chill Touch at the Flavor-Elemental?')).toBeTruthy();
  });

  it('titles two enemies with "and 1 more" (#86)', () => {
    const confirmation = {
      spec: spec({
        attackSource: 'weapon',
        declaredTargets: ['Faceless Stalker'],
        otherCombatants: ['Gloom Hound'],
      }),
      confirm: vi.fn(),
      decline: vi.fn(),
    };

    renderCard(confirmation);

    expect(screen.getByText('Attack the Faceless Stalker and 1 more?')).toBeTruthy();
  });

  it.each([
    { labels: ['Chitinous Hunter'], expected: 'Fight the Chitinous Hunter?' },
    { labels: [], expected: 'Fight the opposing side?' },
  ])(
    'titles $labels without inventing a target name (#2532)',
    ({ labels, expected }: { labels: string[]; expected: string }) => {
      const confirmation = {
        spec: spec({ combatantLabels: labels }),
        confirm: vi.fn(),
        decline: vi.fn(),
      };

      renderCard(confirmation);

      expect(screen.getByText(expected)).toBeTruthy();
    },
  );

  it('names the rest of a fallback roster on the second line (#86)', () => {
    // The title names only the first roster member plus "and N more", so
    // the rest must appear somewhere — here they join on the second line.
    const confirmation = {
      spec: spec({
        combatantLabels: ['Professor Emil Darkwater', 'Captain Sarah Reeves'],
      }),
      confirm: vi.fn(),
      decline: vi.fn(),
    };

    renderCard(confirmation);

    expect(screen.getByText('Fight the Professor Emil Darkwater and 1 more?')).toBeTruthy();
    expect(screen.getByText('Also joining the fight: Captain Sarah Reeves.')).toBeTruthy();
  });

  it('quotes the player\u2019s own words above the entry prompt (#877)', () => {
    const confirmation = {
      spec: spec({
        declaredTargets: ['Silk Woman'],
        otherCombatants: ['Silk Man'],
        playerMessage: 'I attack Silk Woman with my longbow',
      }),
      confirm: vi.fn(),
      decline: vi.fn(),
    };

    renderCard(confirmation);

    expect(screen.getByText('Fight the Silk Woman and 1 more?')).toBeTruthy();
    expect(screen.getByText(/I attack Silk Woman with my longbow/)).toBeTruthy();
    expect(screen.getByText('Also joining the fight: Silk Man.')).toBeTruthy();
  });

  it('focuses Start the fight and declines on Escape (#86)', () => {
    const confirm = vi.fn();
    const decline = vi.fn();
    const confirmation = { spec: spec(), confirm, decline };

    renderCard(confirmation);

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Start the fight' }));

    fireEvent.keyDown(document, { key: 'Enter' });
    expect(decline).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(decline).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not yank focus back to Start the fight when the parent re-renders (#86)', () => {
    // The host returns a fresh confirmation object on every render, so a
    // focus effect depending on it would re-fire on every re-render and
    // steal focus from "Do something else". The effect depends on the
    // stable spec instead: a fresh confirmation object with the same spec
    // must leave focus where the player put it.
    const confirm = vi.fn();
    const decline = vi.fn();
    const specValue = spec();
    const { rerender } = renderCard({ spec: specValue, confirm, decline });

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Start the fight' }));
    screen.getByRole('button', { name: 'Do something else' }).focus();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Do something else' }));

    rerender(<CombatEntryConfirmation confirmation={{ spec: specValue, confirm, decline }} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Do something else' }));
  });

  it('titles a nameless spell without dropping the verb (#86)', () => {
    const confirmation = {
      spec: spec({
        attackSource: 'spell',
        declaredTargets: ['Vance'],
      }),
      confirm: vi.fn(),
      decline: vi.fn(),
    };

    renderCard(confirmation);

    expect(screen.getByText('Cast a spell at the Vance?')).toBeTruthy();
  });

  it('does not decline on an Escape another handler already consumed (#86)', () => {
    // ChatInput closes dice suggestions with preventDefault while the
    // composer stays live under #400; that Escape must not also decline
    // the entry card.
    const confirm = vi.fn();
    const decline = vi.fn();
    renderCard({ spec: spec(), confirm, decline });

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    event.preventDefault();
    document.dispatchEvent(event);

    expect(decline).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('shows no bracketed button words on the entry or choice cards (#86)', () => {
    const entry = {
      spec: spec({ declaredTargets: ['Vance'] }),
      confirm: vi.fn(),
      decline: vi.fn(),
    };
    const { unmount } = renderCard(entry);
    expect(document.body.textContent).not.toContain('[Strike]');
    expect(document.body.textContent).not.toContain('[Do something else]');
    unmount();

    const choice = {
      spec: spec({
        combatantLabels: ['Guard'],
        targetChoices: ['Guard'],
        spellLabel: 'Fire Bolt',
        activeCombat: true,
      }),
      confirm: vi.fn(),
      decline: vi.fn(),
    };
    renderCard(choice);
    expect(document.body.textContent).not.toContain('[Strike]');
    expect(document.body.textContent).not.toContain('[Do something else]');
  });

  it('offers one button per target choice plus Do something else (#2341)', () => {
    const confirm = vi.fn();
    const decline = vi.fn();
    const confirmation = {
      spec: spec({
        combatantLabels: ['Professor Darkwater', 'Guard'],
        targetChoices: ['Professor Darkwater', 'Guard'],
      }),
      confirm,
      decline,
    };

    renderCard(confirmation);

    expect(screen.getByText('Combat is about to begin')).toBeTruthy();
    expect(screen.getByText(/Who is your attack for\?/)).toBeTruthy();
    expect(screen.getByText(/Your initiative is rolled after you choose\./)).toBeTruthy();
    const choice = screen.getByRole('button', { name: 'Strike Professor Darkwater' });
    expect(choice.getAttribute('data-action')).toBe('confirm');
    expect(choice.getAttribute('data-target')).toBe('Professor Darkwater');
    fireEvent.click(choice);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('Professor Darkwater');
    fireEvent.click(screen.getByRole('button', { name: 'Do something else' }));
    expect(decline).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('names the spell on the choice card for an active-combat cast (#1009)', () => {
    const confirmation = {
      spec: spec({
        combatantLabels: ['Guard'],
        targetChoices: ['Guard'],
        spellLabel: 'Fire Bolt',
        activeCombat: true,
      }),
      confirm: vi.fn(),
      decline: vi.fn(),
    };

    renderCard(confirmation);

    expect(screen.getByText('Choose a spell target')).toBeTruthy();
    expect(screen.getByText('Who is Fire Bolt for?')).toBeTruthy();
    expect(screen.queryByText(/Your initiative is rolled after you choose\./)).not.toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cast at Guard' })).toBeTruthy();
  });

  it('does not quote the player\u2019s words on the choice card (#877)', () => {
    const confirmation = {
      spec: spec({
        combatantLabels: ['Guard'],
        targetChoices: ['Guard'],
        playerMessage: 'I cast Fire Bolt at the guard',
        spellLabel: 'Fire Bolt',
        activeCombat: true,
      }),
      confirm: vi.fn(),
      decline: vi.fn(),
    };

    renderCard(confirmation);

    expect(screen.queryByText(/I cast Fire Bolt at the guard/)).not.toBeTruthy();
  });

  it('copies the label arrays before logging so the log prints names, not [Circular] (#2445)', () => {
    // One shared array as both labels and choices: the logger prints a
    // value it has already seen as "[Circular]", so the component must
    // hand it copies — the identity assertions below are the whole point
    // of this test, and they fail if the spread copies are removed.
    const shared = ['Guard'];
    const specValue = spec({
      combatantLabels: shared,
      targetChoices: shared,
      spellLabel: 'Fire Bolt',
      activeCombat: true,
    });
    const confirmation = { spec: specValue, confirm: vi.fn(), decline: vi.fn() };

    renderCard(confirmation);

    expect(logger.info).toHaveBeenCalledWith(
      '[CombatEntry] confirmation popup mounted',
      expect.objectContaining({
        combatantLabels: ['Guard'],
        declaredTargets: [],
        otherCombatants: [],
        targetChoices: ['Guard'],
      }),
    );
    const logged = vi.mocked(logger.info).mock.calls[0][1] as {
      combatantLabels: string[];
      targetChoices: string[];
    };
    expect(logged.combatantLabels).not.toBe(shared);
    expect(logged.targetChoices).not.toBe(shared);
    expect(logged.combatantLabels).not.toBe(logged.targetChoices);
  });
});
