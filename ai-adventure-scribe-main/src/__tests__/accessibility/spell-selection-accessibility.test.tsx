import { screen, waitFor, fireEvent } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

import {
  renderSpellSelection,
  buildWizardCharacter,
  buildClericCharacter,
  buildFighterCharacter,
} from '@/__tests__/helpers/spell-selection-test-setup';

/**
 * Spell Selection Accessibility Tests
 *
 * These tests render the REAL SpellSelection component
 * (`src/components/character-creation/steps/SpellSelection.tsx`) — not a
 * test-local reimplementation. Only the network transport is stubbed:
 * `spellApi.getClassSpells` is backed by the real SRD spell catalog
 * (`src/data/spells/api`), and `saveCharacterSpells` stays pending without
 * touching the network. Characters use the real class catalog
 * (`src/data/classes/*`).
 *
 * Assertion inventory vs the previous test-local copy (AccessibleSpellSelection):
 * every assertion below either runs against the real component, or is named as
 * dropped with a reason in the "Documented differences" tests.
 */

// Stub only the transport: spell fetching returns the REAL catalog data,
// character saves stay pending without a network round-trip.
const { getClassSpellsMock, saveCharacterSpellsMock } = vi.hoisted(() => ({
  getClassSpellsMock: vi.fn(),
  saveCharacterSpellsMock: vi.fn(),
}));

vi.mock('@/services/spellApi', () => ({
  spellApi: { getClassSpells: getClassSpellsMock },
}));

vi.mock('@/services/characterSpellApi', () => ({
  characterSpellService: { saveCharacterSpells: saveCharacterSpellsMock },
}));

/** The spell card (role="checkbox") for the named spell. */
function spellCard(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { name });
  const card = heading.closest('[role="checkbox"]');
  if (!card) {
    throw new Error(`no spell card found for "${name}"`);
  }
  return card as HTMLElement;
}

/** Wait until the real component has loaded the wizard cantrip list. */
async function waitForCantrips(): Promise<void> {
  await screen.findByRole('heading', { name: 'Mage Hand' });
}

describe('Spell Selection Accessibility Tests', () => {
  beforeAll(() => {
    // jsdom does not implement scrollIntoView; the real component calls it via
    // useAutoScroll after a valid selection.
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(async () => {
    getClassSpellsMock.mockReset();
    saveCharacterSpellsMock.mockReset();
    // Leave saves pending: the real component re-saves on every character
    // change while the selection is valid, and the context reducer mints a new
    // character object per dispatch, so a resolving save would spin forever.
    saveCharacterSpellsMock.mockImplementation(() => new Promise(() => {}));
    // Back the stubbed transport with the REAL spell catalog.
    const { getClassSpells } = await import('@/data/spells/api');
    getClassSpellsMock.mockImplementation((className: string) =>
      Promise.resolve(getClassSpells(className)),
    );
  });

  describe('Keyboard Interaction', () => {
    it('should support Enter and Space for selection', async () => {
      const user = userEvent.setup();
      renderSpellSelection(buildWizardCharacter('Accessible Wizard'));

      await waitForCantrips();

      const card = spellCard('Mage Hand');
      card.focus();
      expect(card).toHaveFocus();

      // Enter should select
      await user.keyboard('{Enter}');
      expect(card).toHaveAttribute('aria-checked', 'true');

      // Space should deselect
      await user.keyboard(' ');
      expect(card).toHaveAttribute('aria-checked', 'false');
    });

    it('should make every spell card keyboard-focusable', async () => {
      renderSpellSelection(buildWizardCharacter('Keyboard Wizard'));

      await waitForCantrips();

      // The real component exposes each spell as a checkbox card in the tab
      // order (no roving tabindex); every card must be reachable by keyboard.
      const cards = screen.getAllByRole('checkbox');
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        expect(card).toHaveAttribute('tabindex', '0');
      }
    });
  });

  describe('Screen Reader Compatibility', () => {
    it('should have proper ARIA labels and roles', async () => {
      renderSpellSelection(buildWizardCharacter('Screen Reader Wizard'));

      await waitForCantrips();

      // Search control is labelled
      expect(screen.getByLabelText('Search spells')).toBeInTheDocument();

      // Tab interface exposes real tab roles
      expect(screen.getByRole('tab', { name: /Cantrips/ })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /1st Level/ })).toBeInTheDocument();

      // Spell options expose checkbox semantics with a checked state
      const cards = screen.getAllByRole('checkbox');
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        expect(card).toHaveAttribute('aria-checked');
      }
    });

    it('should label the school filter controls', async () => {
      const user = userEvent.setup();
      renderSpellSelection(buildWizardCharacter('Filter Wizard'));

      await waitForCantrips();

      await user.click(screen.getByRole('button', { name: /Filters/ }));

      // Each school checkbox carries an accessible label in the real panel
      expect(await screen.findByLabelText('Filter by Evocation')).toBeInTheDocument();
      expect(screen.getByLabelText('Filter by Conjuration')).toBeInTheDocument();
    });

    it('should expose selection state via aria-checked', async () => {
      const user = userEvent.setup();
      renderSpellSelection(buildWizardCharacter('Announcing Wizard'));

      await waitForCantrips();

      // The real component has no live region; selection state is exposed
      // through aria-checked on each spell card.
      const card = spellCard('Mage Hand');
      expect(card).toHaveAttribute('aria-checked', 'false');

      await user.click(card);
      expect(card).toHaveAttribute('aria-checked', 'true');

      await user.click(card);
      expect(card).toHaveAttribute('aria-checked', 'false');
    });

    it('should announce errors via role="alert"', async () => {
      renderSpellSelection(buildWizardCharacter('Error Wizard'));

      await waitForCantrips();

      // An incomplete selection is invalid per the real validator; the
      // destructive Alert (implicit aria-live="assertive" via role="alert")
      // is the real announcement mechanism.
      await waitFor(() => {
        const alert = screen.getByText(/Expected 3 cantrips \(3 class \+ 0 racial\), but got 0/);
        expect(alert.closest('[role="alert"]')).not.toBeNull();
      });
    });
  });

  describe('Focus Management', () => {
    it('should keep every spell card in the tab order', async () => {
      renderSpellSelection(buildWizardCharacter('Focus Wizard'));

      await waitForCantrips();

      // The real SpellCard renders tabIndex={0} for every selectable card
      // (tabIndex={-1} only once the selection limit disables the rest).
      const cards = screen.getAllByRole('checkbox');
      for (const card of cards) {
        expect(card).toHaveAttribute('tabindex', '0');
      }
    });

    it('should restore focus after interactions', async () => {
      const user = userEvent.setup();
      renderSpellSelection(buildWizardCharacter('Focus Restore Wizard'));

      await waitForCantrips();

      const card = spellCard('Mage Hand');

      // Focus and select
      card.focus();
      expect(card).toHaveFocus();

      await user.keyboard('{Enter}');

      // Focus should remain on the same element after selection
      expect(card).toHaveFocus();
    });

    it('should provide keyboard-focusable cards', async () => {
      renderSpellSelection(buildWizardCharacter('Focus Indicator Wizard'));

      await waitForCantrips();

      const card = spellCard('Mage Hand');
      card.focus();

      expect(card).toHaveFocus();
      expect(card).toHaveAttribute('tabindex', '0');
    });
  });

  describe('Error Accessibility', () => {
    it('should surface validation errors in an alert', async () => {
      renderSpellSelection(buildWizardCharacter('Error Association Wizard'));

      await waitForCantrips();

      // The real validator reports the incomplete selection; the message is
      // specific and actionable.
      await waitFor(() => {
        expect(
          screen.getByText(/Expected 3 cantrips \(3 class \+ 0 racial\), but got 0/),
        ).toBeInTheDocument();
      });
      expect(screen.getByText(/Expected 6 spells known, but got 0/)).toBeInTheDocument();
    });

    it('should clear the alert once the selection is valid', async () => {
      const user = userEvent.setup();
      renderSpellSelection(buildWizardCharacter('Error Clear Wizard'));

      await waitForCantrips();

      await waitFor(() => {
        expect(screen.getByText(/Expected 3 cantrips/)).toBeInTheDocument();
      });

      // Select a fully valid set: 3 cantrips + 6 first-level spells.
      // Each 1st-level pick goes through the production search. The search
      // term is set BEFORE opening the tab so the 191-card catalog is never
      // mounted unfiltered (that path took ~16s against the 20s CI timeout).
      for (const name of ['Mage Hand', 'Prestidigitation', 'Light']) {
        await user.click(spellCard(name));
      }
      const search = screen.getByLabelText('Search spells');
      const spells = [
        'Magic Missile',
        'Shield',
        'Detect Magic',
        'Burning Hands',
        'Sleep',
        'Charm Person',
      ];
      fireEvent.change(search, { target: { value: spells[0].toLowerCase() } });
      await user.click(screen.getByRole('tab', { name: /1st Level/ }));
      await user.click(await screen.findByRole('heading', { name: spells[0] }));
      for (const name of spells.slice(1)) {
        fireEvent.change(search, { target: { value: name.toLowerCase() } });
        await user.click(await screen.findByRole('heading', { name }));
      }
      fireEvent.change(search, { target: { value: '' } });

      // The validation alert clears once the selection satisfies the rules
      await waitFor(() => {
        expect(screen.queryByText(/Expected 3 cantrips/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Expected 6 spells/)).not.toBeInTheDocument();
      });
    });
  });

  describe('Touch Interaction', () => {
    it('should toggle selection on click like on keyboard', async () => {
      const user = userEvent.setup();
      renderSpellSelection(buildWizardCharacter('Touch Interaction Wizard'));

      await waitForCantrips();

      const card = spellCard('Mage Hand');

      // Click should work the same as keyboard interaction
      await user.click(card);
      expect(card).toHaveAttribute('aria-checked', 'true');

      await user.click(card);
      expect(card).toHaveAttribute('aria-checked', 'false');
    });
  });

  describe('Non-Spellcaster Accessibility', () => {
    it('should provide accessible messaging for non-spellcasters', async () => {
      renderSpellSelection(buildFighterCharacter('Accessible Fighter'));

      // The real non-spellcaster state: a clear heading plus an explanation
      // of why no spells are available. Assert the class name so the test
      // waits for the seeded fighter rather than the pre-seed null-character
      // shell, which shows the same heading.
      expect(
        await screen.findByText(/Your Fighter class is not a spellcasting class/),
      ).toBeInTheDocument();
    });
  });

  describe('Headings and Status Updates', () => {
    it('should have a proper heading hierarchy', async () => {
      renderSpellSelection(buildWizardCharacter('Heading Wizard'));

      await waitForCantrips();

      // Page-level heading plus one heading per spell card
      expect(screen.getByRole('heading', { level: 2, name: 'Choose Your Starting Spells' }))
        .toBeInTheDocument();
      const spellHeadings = screen.getAllByRole('heading', { level: 4 });
      expect(spellHeadings.length).toBeGreaterThan(0);
    });

    it('should update the selection counts as spells are chosen', async () => {
      const user = userEvent.setup();
      renderSpellSelection(buildWizardCharacter('Status Wizard'));

      await waitForCantrips();

      const cantripsTab = screen.getByRole('tab', { name: /Cantrips/ });
      expect(cantripsTab).toHaveTextContent('0/3');

      await user.click(spellCard('Mage Hand'));

      await waitFor(() => expect(cantripsTab).toHaveTextContent('1/3'));
    });

    it('should not rely on color alone for selection state', async () => {
      const user = userEvent.setup();
      renderSpellSelection(buildWizardCharacter('Contrast Wizard'));

      await waitForCantrips();

      // Selection is exposed programmatically (aria-checked), not just visually
      const card = spellCard('Mage Hand');
      await user.click(card);
      expect(card).toHaveAttribute('aria-checked', 'true');
    });
  });

  describe('Documented differences from the test-local copy', () => {
    it('[characterization] arrow keys do not move focus between cards (feature missing)', async () => {
      const user = userEvent.setup();
      renderSpellSelection(buildWizardCharacter('Arrow Key Wizard'));

      await waitForCantrips();

      // The previous suite tested ArrowDown/ArrowUp/Home/End/focus-trapping on
      // its own listbox copy. The real SpellCard only handles Enter/Space;
      // arrow keys do not move focus between cards.
      const card = spellCard('Mage Hand');
      card.focus();
      expect(card).toHaveFocus();

      await user.keyboard('{ArrowDown}');
      expect(card).toHaveFocus();

      await user.keyboard('{End}');
      expect(card).toHaveFocus();
    });

    it('has no live region for selection announcements (test-local invention)', async () => {
      renderSpellSelection(buildWizardCharacter('Live Region Wizard'));

      await waitForCantrips();

      // The test-local copy announced selections via role="status". The real
      // component exposes selection state through aria-checked instead.
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('documents dropped assertions from the old suites', async () => {
      // #2669 step 3 requires every old assertion to be preserved against the
      // real component or named as dropped with a reason. Each group below
      // pins the real component's actual behavior that replaces it.

      // 1. Cleric 1st-level selection (old: "Cure Wounds/Healing Word/Bless
      //    shown", "Spells (0/1)" counts, over-select error). Dropped: the real
      //    cleric prepares spells instead of knowing them, so SpellSelectionTabs
      //    renders no 1st-level selection UI at creation (the tab trigger is
      //    always present, but the "1st Level Spells" section never appears).
      renderSpellSelection(buildClericCharacter('Dropped Cleric'));
      await screen.findByRole('heading', { name: 'Guidance' });
      expect(
        screen.queryByRole('heading', { name: '1st Level Spells' }),
      ).not.toBeInTheDocument();

      // 2. "should handle validation errors gracefully" (old: mocked validator
      //    throws -> "Failed to validate spell"). Dropped: that tested the
      //    test-local copy's own try/catch around its mock; the real async
      //    validator returns errors instead of throwing. The real component
      //    never renders that test-local error text.
      expect(screen.queryByText('Failed to validate spell')).not.toBeInTheDocument();

      // 3. Per-card `aria-label="School: …"` + aria-describedby (old:
      //    "should provide descriptive labels for complex elements"). Dropped:
      //    the real SpellCard shows the school in a visual badge only — the
      //    card has no aria-label at all.
      const card = spellCard('Guidance');
      expect(card.getAttribute('aria-label')).toBeNull();

      // 4. Reduced-motion preference (old: "should work with reduced motion
      //    preferences"). Dropped: a CSS-only concern with no real-component
      //    equivalent to assert against.

      // 5. Over-select message (old: "Cannot select more than 3 cantrips").
      //    Dropped as text: the real component never renders that message.
      //    Moved as behavior: the 4th card gets aria-disabled="true" and the
      //    tab badge reads "3/3" (asserted in the component suite's
      //    "should enforce cantrip count limits").
      expect(screen.queryByText(/Cannot select more than/)).not.toBeInTheDocument();

      // 6. Character name in the heading (old: "Spell Selection for Gandalf
      //    (Wizard"). Dropped: the real heading is "Choose Your Starting
      //    Spells" with "As a Wizard, you begin with magical knowledge" — the
      //    character name is not rendered.
      expect(screen.queryByText(/Gandalf/)).not.toBeInTheDocument();
      expect(screen.getByText('Choose Your Starting Spells')).toBeInTheDocument();

      // 7. Test-local structure (old: main[aria-labelledby], 3 groups,
      //    2 listboxes, option aria-describedby, data-testids like
      //    "spell-selection", "cantrip-mage-hand"). Dropped: that was the
      //    test-local copy's own DOM. The real component uses tabs and
      //    checkbox cards (asserted in "should have proper ARIA labels and roles").
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(screen.queryByTestId('spell-selection')).not.toBeInTheDocument();

      // 8. "Selected: N cantrips" summary and "All required spells selected"
      //    status (old). Dropped as text: the real component shows count
      //    badges on the tabs ("0/3", "3/3") instead (asserted in the
      //    component suite's count tests).
      expect(screen.queryByText(/Selected: \d+ cantrips/)).not.toBeInTheDocument();
      expect(screen.queryByText(/All required spells selected/)).not.toBeInTheDocument();

      // 9. "Not selected" text for high contrast (old). Dropped: the real
      //    SpellCard renders no Selected/Not-selected text — selection state
      //    is exposed only via aria-checked, so there is no non-color
      //    indicator to assert. (Known gap in the real component, not a test
      //    invention.)
      expect(screen.queryByText(/Not selected/)).not.toBeInTheDocument();

      // 10. Touch-target dimensions (old: "should have adequate touch
      //     targets"). Dropped: the old test asserted on the test-local
      //     copy's option elements and was vacuous — it never measured a
      //     real target. No real-component equivalent was asserted.

      // 11. Non-spellcaster region/label (old: role="region", labelled
      //     "Character information", "Non-spellcaster Character"). Dropped as
      //     structure: the real non-spellcaster state is a plain heading
      //     ("No Spells to Select") plus the "Your <class> class is not a
      //     spellcasting class" message (asserted in both suites' fighter
      //     tests). The real component uses no region/label structure.
    });
  });
});
