import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SheetRestControls } from '../SheetRestControls';

import type { RestApiResult } from '@/services/rest-api';
import type { Character, CharacterSheetUpdateFn } from '@/types/character';

import { restApi } from '@/services/rest-api';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/services/rest-api', async (importOriginal) => {
  const mod = await importOriginal<{ restApi: typeof restApi }>();
  return {
    ...mod,
    restApi: {
      ...mod.restApi,
      shortRest: vi.fn(),
      longRest: vi.fn(),
    },
  };
});

const serverShortRest = {
  characterId: 'char-1',
  restType: 'short',
  hpRestored: 7,
  hitDiceSpent: 2,
  hitDiceRemaining: [
    {
      id: 'hd-1',
      characterId: 'char-1',
      className: 'Fighter',
      dieType: 'd8',
      totalDice: 5,
      usedDice: 4,
    },
  ],
  resourcesRestored: [],
  spellSlots: {},
  pactSlots: null,
  classFeatures: {},
  restEventId: 'rest-1',
} as RestApiResult;

const characterWithDice = {
  id: 'char-1',
  name: 'Mira',
  hitDice: { total: 5, remaining: 3, type: 'd8' },
  hitPoints: { maximum: 30, current: 10, temporary: 0 },
} as Character;

describe('SheetRestControls (#264)', () => {
  const onUpdate = vi.fn(async (_character: Character) => true);
  const onUpdateProp = onUpdate as unknown as CharacterSheetUpdateFn;

  beforeEach(() => {
    vi.clearAllMocks();
    onUpdate.mockResolvedValue(true);
    vi.mocked(restApi.shortRest).mockResolvedValue(serverShortRest);
    vi.mocked(restApi.longRest).mockResolvedValue({ ...serverShortRest, restType: 'long' });
  });

  it('opens the hit-dice prompt on Short Rest when dice are available', () => {
    render(<SheetRestControls character={characterWithDice} onUpdate={onUpdateProp} />);

    fireEvent.click(screen.getByRole('button', { name: /short rest/i }));

    expect(screen.getByRole('group', { name: /spend hit dice/i })).toBeInTheDocument();
    expect(screen.getByText(/3 of 5 hit dice/)).toBeInTheDocument();
    expect(screen.getByLabelText(/hit dice to spend/i)).toBeInTheDocument();
  });

  it('sends the chosen dice count and persists the rest-applied character', async () => {
    render(<SheetRestControls character={characterWithDice} onUpdate={onUpdateProp} />);

    fireEvent.click(screen.getByRole('button', { name: /short rest/i }));
    fireEvent.change(screen.getByLabelText(/hit dice to spend/i), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /take short rest/i }));

    await waitFor(() => {
      expect(restApi.shortRest).toHaveBeenCalledWith('char-1', 2);
    });
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalled();
    });
    const firstCall = onUpdate.mock.calls[0];
    expect(firstCall).toBeDefined();
    const persisted = firstCall![0] as Character;
    expect(persisted.hitDice).toEqual({ total: 5, remaining: 1, type: 'd8' });
    expect(persisted.hitPoints?.current).toBe(17);
  });

  it('clamps the spend to the dice available', async () => {
    render(<SheetRestControls character={characterWithDice} onUpdate={onUpdateProp} />);

    fireEvent.click(screen.getByRole('button', { name: /short rest/i }));
    fireEvent.change(screen.getByLabelText(/hit dice to spend/i), { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: /take short rest/i }));

    await waitFor(() => {
      expect(restApi.shortRest).toHaveBeenCalledWith('char-1', 3);
    });
  });

  it('applies a short rest directly when no dice are available', async () => {
    const noDice = {
      ...characterWithDice,
      hitDice: { total: 5, remaining: 0, type: 'd8' },
    } as Character;
    render(<SheetRestControls character={noDice} onUpdate={onUpdateProp} />);

    fireEvent.click(screen.getByRole('button', { name: /short rest/i }));

    expect(screen.queryByRole('group', { name: /spend hit dice/i })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(restApi.shortRest).toHaveBeenCalledWith('char-1', 0);
    });
  });
});
