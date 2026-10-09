import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

import type { Character, Spell } from '@/types/character';

import {
  renderSpellSelection,
  buildWizardCharacter,
  buildClericCharacter,
  buildFighterCharacter,
} from '@/__tests__/helpers/spell-selection-test-setup';

/**
 * Spell Selection Component Tests
 *
 * These tests render the REAL SpellSelection component
 * (`src/components/character-creation/steps/SpellSelection.tsx`) — not a
 * test-local reimplementation. Only the network transport is stubbed:
 * `spellApi.getClassSpells` is backed by the real SRD spell catalog
 * (`src/data/spells/api`), and `saveCharacterSpells` stays pending without
 * touching the network. Characters use the real class catalog
 * (`src/data/classes/*`); the invented classes from spell-test-helpers are
 * not used.
 *
 * Critical for preventing the bug where wizards could select divine spells in the UI.
 *
 * Assertion audit: every behavior the old suites asserted (class-specific spell
 * lists, keyboard toggling, search/school filters, validation errors,
 * over-selection blocking, non-spellcaster handling) is covered here against
 * the real component. Assertions with no real-component equivalent are named
 * as dropped with reasons in the accessibility suite's "Documented
 * differences" tests (arrow-key roving focus, live-region announcements,
 * cleric 1st-level selection, validator-throws handling, per-card School:
 * aria-labels, reduced-motion).
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

describe('Spell Selection Component Tests', () => {
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

  describe('Class-Specific Spell Filtering', () => {
    it('should only show wizard spells for wizard characters', async () => {
      const user = userEvent.setup();
      renderSpellSelection(buildWizardCharacter('Test Wizard'));

      await waitForCantrips();

      // Wizard cantrips from the real catalog
      expect(screen.getByRole('heading', { name: 'Mage Hand' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Prestidigitation' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Light' })).toBeInTheDocument();

      // Cleric-only cantrips must not be offered to a wizard
      expect(screen.queryByRole('heading', { name: 'Guidance' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Sacred Flame' })).not.toBeInTheDocument();

      // Narrow the 1st-level list through the production search before opening
      // the tab, so the test never mounts the full 191-card catalog.
      const search = screen.getByLabelText('Search spells');
      const spellsTab = screen.getByRole('tab', { name: /1st Level/ });

      fireEvent.change(search, { target: { value: 'magic missile' } });
      await user.click(spellsTab);
      await screen.findByRole('heading', { name: 'Magic Missile' });

      fireEvent.change(search, { target: { value: 'shield' } });
      await screen.findByRole('heading', { name: 'Shield' });

      // Cleric-only spells are not offered to a wizard, even when searched
      fireEvent.change(search, { target: { value: 'cure wounds' } });
      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: 'Cure Wounds' })).not.toBeInTheDocument();
      });
      fireEvent.change(search, { target: { value: 'healing word' } });
      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: 'Healing Word' })).not.toBeInTheDocument();
      });
    });

    it('should only show cleric spells for cleric characters', async () => {
      renderSpellSelection(buildClericCharacter('Test Cleric'));

      // Cleric cantrips from the real catalog
      await screen.findByRole('heading', { name: 'Guidance' });
      expect(screen.getByRole('heading', { name: 'Thaumaturgy' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Sacred Flame' })).toBeInTheDocument();

      // Wizard-only cantrips must not be offered to a cleric
      expect(screen.queryByRole('heading', { name: 'Mage Hand' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Prestidigitation' })).not.toBeInTheDocument();

      // Data-layer: the cleric's spell list must not contain wizard-only
      // 1st-level spells. (The cleric has no 1st-level selection UI at
      // creation, so searching the UI for them is vacuous — assert the
      // production catalog separation instead.)
      const { getClassSpells } = await import('@/data/spells/api');
      const clericCatalog = getClassSpells('cleric');
      const clericSpellNames = [...clericCatalog.cantrips, ...clericCatalog.spells].map(
        (spell) => spell.name,
      );
      expect(clericSpellNames).not.toContain('Magic Missile');
      expect(clericSpellNames).not.toContain('Shield');
      // And the list is not empty/vacuous: a real cleric spell is present.
      expect(clericSpellNames).toContain('Cure Wounds');
    });

    it('should handle non-spellcaster characters', async () => {
      renderSpellSelection(buildFighterCharacter('Test Fighter'));

      // The real component renders its non-spellcaster state (no invented test-id needed).
      // Assert the fighter's class name, not just the generic message: the first
      // frame renders with character=null and shows the same "No Spells to
      // Select" shell, so the class name proves the fighter was actually seeded.
      expect(
        await screen.findByText(/Your Fighter class is not a spellcasting class/),
      ).toBeInTheDocument();
    });
  });

  describe('Search and School Filtering (production filter)', () => {
    it('should filter the spell list via the search box', async () => {
      renderSpellSelection(buildWizardCharacter('Test Wizard'));

      await waitForCantrips();

      fireEvent.change(screen.getByLabelText('Search spells'), { target: { value: 'fire bolt' } });

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Fire Bolt' })).toBeInTheDocument();
      });
      expect(screen.queryByRole('heading', { name: 'Mage Hand' })).not.toBeInTheDocument();
    });

    it('should filter the spell list by school via the Filters panel', async () => {
      const user = userEvent.setup();
      renderSpellSelection(buildWizardCharacter('Test Wizard'));

      await waitForCantrips();

      await user.click(screen.getByRole('button', { name: /Filters/ }));
      await user.click(await screen.findByLabelText('Filter by Evocation'));

      // Light is Evocation in the real catalog; Mage Hand is Conjuration
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Light' })).toBeInTheDocument();
      });
      expect(screen.queryByRole('heading', { name: 'Mage Hand' })).not.toBeInTheDocument();
    });
  });

  describe('Spell Selection Validation', () => {
    it('should flag a cleric spell preselected on a wizard as invalid', async () => {
      // Seed an out-of-class spell the way a corrupted draft would: the real
      // validator (used by the real component) must reject it in the UI.
      const wizardWithClericSpell: Character = buildWizardCharacter('Test Wizard', {
        knownSpells: ['cure-wounds'],
      });
      renderSpellSelection(wizardWithClericSpell);

      await waitForCantrips();

      await waitFor(() => {
        expect(
          screen.getByText('cure-wounds is not available as a 1st level spell for Wizard'),
        ).toBeInTheDocument();
      });
    });

    it('should enforce cantrip count limits', async () => {
      const user = userEvent.setup();
      renderSpellSelection(buildWizardCharacter('Test Wizard'));

      await waitForCantrips();

      // Wizard knows 3 cantrips: select the maximum
      await user.click(spellCard('Mage Hand'));
      await user.click(spellCard('Prestidigitation'));
      await user.click(spellCard('Light'));

      const cantripsTab = screen.getByRole('tab', { name: /Cantrips/ });
      await waitFor(() => expect(cantripsTab).toHaveTextContent('3/3'));

      // A fourth cantrip card is disabled once the limit is reached...
      const fourthCard = spellCard('Minor Illusion');
      expect(fourthCard).toHaveAttribute('aria-disabled', 'true');

      // ...and clicking it does not change the selection
      await user.click(fourthCard);
      expect(screen.getByRole('tab', { name: /Cantrips/ })).toHaveTextContent('3/3');
    });

    it('should allow deselection of spells', async () => {
      const user = userEvent.setup();
      renderSpellSelection(buildWizardCharacter('Test Wizard'));

      await waitForCantrips();

      const card = spellCard('Mage Hand');
      await user.click(card);
      expect(card).toHaveAttribute('aria-checked', 'true');

      await user.click(card);
      expect(card).toHaveAttribute('aria-checked', 'false');
    });

    it('should show the error state when spell loading fails', async () => {
      getClassSpellsMock.mockRejectedValueOnce(new Error('Network down'));
      renderSpellSelection(buildWizardCharacter('Test Wizard'));

      // The real component's error path (useAvailableSpells -> spellsError)
      expect(await screen.findByText('Failed to Load Spells')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    });
  });

  describe('Error Handling and Display', () => {
    it('should display validation errors clearly', async () => {
      renderSpellSelection(buildWizardCharacter('Test Wizard'));

      await waitForCantrips();

      // Empty selection is invalid per the real validator: the destructive
      // alert (role="alert") surfaces the first errors.
      await waitFor(() => {
        expect(
          screen.getByText(/Expected 3 cantrips \(3 class \+ 0 racial\), but got 0/),
        ).toBeInTheDocument();
      });
    });

    it('should clear errors when making valid selections', async () => {
      const user = userEvent.setup();
      renderSpellSelection(buildWizardCharacter('Test Wizard'));

      await waitForCantrips();

      await waitFor(() => {
        expect(
          screen.getByText(/Expected 3 cantrips \(3 class \+ 0 racial\), but got 0/),
        ).toBeInTheDocument();
      });

      // Select a fully valid set: 3 cantrips + 6 first-level spells
      for (const name of ['Mage Hand', 'Prestidigitation', 'Light']) {
        await user.click(spellCard(name));
      }
      // Each 1st-level pick goes through the production search. The search
      // term is set BEFORE opening the tab so the 191-card catalog is never
      // mounted unfiltered (that path took ~16s against the 20s CI timeout).
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

      await waitFor(() => {
        expect(screen.queryByText(/Expected 3 cantrips/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Expected 6 spells/)).not.toBeInTheDocument();
      });
    });

    it('should handle loading states', async () => {
      let resolveSpells!: (value: { cantrips: Spell[]; spells: Spell[] }) => void;
      getClassSpellsMock.mockImplementationOnce(
        () =>
          new Promise<{ cantrips: Spell[]; spells: Spell[] }>((resolve) => {
            resolveSpells = resolve;
          }),
      );
      renderSpellSelection(buildWizardCharacter('Test Wizard'));

      // While the stubbed transport is pending, the real loading state shows
      expect(await screen.findByText('Loading Spells...')).toBeInTheDocument();

      const { getClassSpells } = await import('@/data/spells/api');
      resolveSpells(getClassSpells('Wizard'));

      await waitForCantrips();
      expect(screen.queryByText('Loading Spells...')).not.toBeInTheDocument();
    });
  });

  describe('Different Class Spell Limits', () => {
    it('should show the real cleric limits (cantrips only at creation)', async () => {
      // The real cleric catalog prepares (not knows) 1st-level spells, so the
      // real component offers cantrips but no 1st-level selection at creation.
      renderSpellSelection(buildClericCharacter('Test Cleric'));

      await screen.findByRole('heading', { name: 'Guidance' });

      expect(screen.getByRole('tab', { name: /Cantrips/ })).toHaveTextContent('0/3');
    });

    it('should display correct spell counts for different classes', async () => {
      renderSpellSelection(buildWizardCharacter('Test Wizard'));
      await waitForCantrips();
      // Real wizard catalog: 3 cantrips known, 6 spells known
      expect(screen.getByRole('tab', { name: /Cantrips/ })).toHaveTextContent('0/3');
      expect(screen.getByRole('tab', { name: /1st Level/ })).toHaveTextContent('0/6');
    });
  });

  describe('Labels and Character Information', () => {
    it('should have proper labels and roles', async () => {
      renderSpellSelection(buildWizardCharacter('Test Wizard'));

      await waitForCantrips();

      // Search is labelled
      expect(screen.getByLabelText('Search spells')).toBeInTheDocument();
      // Tabs are real tab roles
      expect(screen.getByRole('tab', { name: /Cantrips/ })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /1st Level/ })).toBeInTheDocument();
      // Spell cards expose checkbox semantics with their checked state
      const cards = screen.getAllByRole('checkbox');
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        expect(card).toHaveAttribute('aria-checked');
      }
    });

    it('should display character and class information', async () => {
      renderSpellSelection(buildWizardCharacter('Gandalf'));

      await waitForCantrips();

      expect(screen.getByText('Choose Your Starting Spells')).toBeInTheDocument();
      expect(screen.getByText(/As a Wizard, you begin with magical knowledge/)).toBeInTheDocument();
    });
  });
});
