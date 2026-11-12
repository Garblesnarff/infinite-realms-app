import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  divineSmiteInSessionUseBody,
  divineSmiteUseBody,
  flexibleCastingConvertUseBody,
  flexibleCastingCreateUseBody,
  quickenedMetamagicUseBody,
} from '../../../../../../../shared/test-fixtures/feature-use-bodies';
import { VariableSpendPanel } from '../VariableSpendPanel';

import type { CharacterFeatureRow } from '@/services/class-features-api';
import type { Character } from '@/types/character';

import { spendCharacterFeature } from '@/services/class-features-api';

vi.mock('@/services/class-features-api', () => ({
  spendCharacterFeature: vi.fn(),
}));

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

/**
 * #1233: the sheet's variable-cost picker sends exactly the shared fixture's wire body
 * for each choice. The server test posts the same bodies through the real route schema.
 */

const row = (featureId: string, className: string, featureName: string): CharacterFeatureRow => ({
  id: `row-${featureId}`,
  characterId: 'char-1',
  featureId,
  usesRemaining: null,
  isActive: true,
  acquiredAtLevel: 1,
  createdAt: '2026-01-01T00:00:00Z',
  feature: {
    id: featureId,
    className,
    subclassName: null,
    featureName,
    levelAcquired: 1,
    description: '',
    mechanicalEffects: null,
    usageType: null,
    usesPerRest: null,
    usesCount: null,
    createdAt: '2026-01-01T00:00:00Z',
  },
});

const renderPanel = (
  rows: CharacterFeatureRow[],
  spellSlots?: Character['spellSlots'],
  extra: { sessionId?: string; onSpent?: () => void; knownMetamagic?: string[] } = {},
) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <VariableSpendPanel characterId="char-1" rows={rows} spellSlots={spellSlots} {...extra} />
    </QueryClientProvider>,
  );
};

const pick = async (user: ReturnType<typeof userEvent.setup>, label: string, option: string) => {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
};

describe('VariableSpendPanel wire bodies (#1233)', () => {
  beforeAll(() => {
    // Radix Select needs these DOM APIs, which jsdom does not provide.
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
    Element.prototype.scrollIntoView = () => undefined;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(spendCharacterFeature).mockResolvedValue({
      success: true,
      usesRemaining: 1,
      effect: '',
      message: 'ok',
    });
  });

  it('sends the Divine Smite slot level the player picked', async () => {
    const user = userEvent.setup();
    renderPanel([row('smite-1', 'Paladin', 'Divine Smite')], {
      1: { max: 4, current: 1 },
      2: { max: 2, current: 2 },
    });

    await pick(user, 'Divine Smite choice', '1st-level slot');
    await user.click(screen.getByRole('button', { name: 'Spend' }));

    await waitFor(() =>
      expect(spendCharacterFeature).toHaveBeenCalledWith('char-1', 'smite-1', divineSmiteUseBody),
    );
  });

  it('offers no Divine Smite slot level the character has no slot for', async () => {
    renderPanel([row('smite-1', 'Paladin', 'Divine Smite')], { 1: { max: 4, current: 0 } });

    expect(screen.getByText('No spell slots left to spend.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Divine Smite choice' })).toBeNull();
  });

  it('sends the Metamagic option the player picked', async () => {
    const user = userEvent.setup();
    // #1233: the list shows only the options the Sorcerer knows, so the test stores two.
    renderPanel([row('meta-1', 'Sorcerer', 'Metamagic')], undefined, {
      knownMetamagic: ['quickened', 'careful'],
    });

    await pick(user, 'Metamagic choice', 'Quickened Spell (2 SP)');
    await user.click(screen.getByRole('button', { name: 'Spend' }));

    await waitFor(() =>
      expect(spendCharacterFeature).toHaveBeenCalledWith(
        'char-1',
        'meta-1',
        quickenedMetamagicUseBody,
      ),
    );
  });

  it('with no stored list, shows the one-time picker and saves the chosen options (#1233)', async () => {
    const user = userEvent.setup();
    const onChooseMetamagic = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <VariableSpendPanel
          characterId="char-1"
          rows={[row('meta-1', 'Sorcerer', 'Metamagic')]}
          sorcererLevel={3}
          onChooseMetamagic={onChooseMetamagic}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Choose your Metamagic')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Metamagic choice' })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Know Quickened Spell' }));
    await user.click(screen.getByRole('checkbox', { name: 'Know Careful Spell' }));
    await user.click(screen.getByRole('button', { name: 'Save Metamagic' }));

    expect(onChooseMetamagic).toHaveBeenCalledWith(['careful', 'quickened']);
  });

  it('a third pick at Sorcerer 3 is not taken: the cap is two', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <VariableSpendPanel
          characterId="char-1"
          rows={[row('meta-1', 'Sorcerer', 'Metamagic')]}
          sorcererLevel={3}
          onChooseMetamagic={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Know Quickened Spell' }));
    await user.click(screen.getByRole('checkbox', { name: 'Know Careful Spell' }));
    await user.click(screen.getByRole('checkbox', { name: 'Know Subtle Spell' }));

    expect(screen.getByRole('checkbox', { name: 'Know Subtle Spell' })).not.toBeChecked();
  });

  it('sends the Flexible Casting direction and slot level for both directions', async () => {
    const user = userEvent.setup();
    renderPanel(
      [
        row('flex-convert', 'Sorcerer', 'Flexible Casting: Converting Spell Slot'),
        row('flex-create', 'Sorcerer', 'Flexible Casting: Creating Spell Slots'),
      ],
      { 1: { max: 4, current: 1 } },
    );

    await pick(
      user,
      'Flexible Casting: Converting Spell Slot choice',
      'Convert a 1st-level slot into 1 SP',
    );
    await user.click(screen.getAllByRole('button', { name: 'Spend' })[0]);
    await waitFor(() =>
      expect(spendCharacterFeature).toHaveBeenCalledWith(
        'char-1',
        'flex-convert',
        flexibleCastingConvertUseBody,
      ),
    );

    await pick(
      user,
      'Flexible Casting: Creating Spell Slots choice',
      'Create a 2nd-level slot (3 SP)',
    );
    await user.click(screen.getAllByRole('button', { name: 'Spend' })[1]);
    await waitFor(() =>
      expect(spendCharacterFeature).toHaveBeenCalledWith(
        'char-1',
        'flex-create',
        flexibleCastingCreateUseBody,
      ),
    );
  });
  it('sends the session id when the sheet runs inside a game session', async () => {
    const user = userEvent.setup();
    renderPanel(
      [row('smite-1', 'Paladin', 'Divine Smite')],
      { 1: { max: 4, current: 1 } },
      {
        sessionId: 'session-1',
      },
    );

    await pick(user, 'Divine Smite choice', '1st-level slot');
    await user.click(screen.getByRole('button', { name: 'Spend' }));

    await waitFor(() =>
      expect(spendCharacterFeature).toHaveBeenCalledWith(
        'char-1',
        'smite-1',
        divineSmiteInSessionUseBody,
      ),
    );
  });

  it('shows the server refusal message in the toast', async () => {
    const user = userEvent.setup();
    vi.mocked(spendCharacterFeature).mockRejectedValue(
      new Error('Paladin has no level 1 spell slot left.'),
    );
    renderPanel([row('smite-1', 'Paladin', 'Divine Smite')], { 1: { max: 4, current: 1 } });

    await pick(user, 'Divine Smite choice', '1st-level slot');
    await user.click(screen.getByRole('button', { name: 'Spend' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Spend failed',
          description: 'Paladin has no level 1 spell slot left.',
          variant: 'destructive',
        }),
      ),
    );
  });

  it('triggers the sheet refresh after a spend lands, and not after a refusal', async () => {
    const user = userEvent.setup();
    const onSpent = vi.fn();
    renderPanel(
      [row('smite-1', 'Paladin', 'Divine Smite')],
      { 1: { max: 4, current: 1 } },
      {
        onSpent,
      },
    );

    await pick(user, 'Divine Smite choice', '1st-level slot');
    await user.click(screen.getByRole('button', { name: 'Spend' }));
    await waitFor(() => expect(onSpent).toHaveBeenCalledTimes(1));

    vi.mocked(spendCharacterFeature).mockResolvedValue({
      success: false,
      usesRemaining: 0,
      effect: '',
      message: 'refused',
    });
    await user.click(screen.getByRole('button', { name: 'Spend' }));
    await waitFor(() => expect(spendCharacterFeature).toHaveBeenCalledTimes(2));
    expect(onSpent).toHaveBeenCalledTimes(1);
  });
});
