/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #210 QA-039: sheet tab panels must not add an extra keyboard focus stop.
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CharacterSheetTabs from '../character-sheet-tabs';

vi.mock('../CharacterSheetHeader', () => ({ CharacterSheetHeader: () => null }));
vi.mock('../ExperienceManager', () => ({ default: () => null }));
vi.mock('../MulticlassManager', () => ({ default: () => null }));
vi.mock('../tabs/AbilitiesTab', () => ({ default: () => null }));
vi.mock('../tabs/FeaturesTab', () => ({ default: () => null }));
vi.mock('../tabs/InventoryTab', () => ({ default: () => null }));
vi.mock('../tabs/MainTab', () => ({ default: () => <div>main</div> }));
vi.mock('../tabs/NotesTab', () => ({ default: () => null }));
vi.mock('../tabs/SpellsTab', () => ({ default: () => null }));
vi.mock('@/components/gallery/CharacterGallery', () => ({ default: () => null }));

describe('CharacterSheetTabs focus order (#210 QA-039)', () => {
  it('tab panels are not in the tab order', () => {
    const { container } = render(
      <CharacterSheetTabs
        character={{ id: 'c1', name: 'X' } as any}
        onCharacterUpdate={vi.fn() as any}
      />,
    );
    const panels = container.querySelectorAll('[role="tabpanel"]');
    expect(panels.length).toBeGreaterThan(0);
    panels.forEach((panel) => expect(panel.getAttribute('tabindex')).toBe('-1'));
  });
});
