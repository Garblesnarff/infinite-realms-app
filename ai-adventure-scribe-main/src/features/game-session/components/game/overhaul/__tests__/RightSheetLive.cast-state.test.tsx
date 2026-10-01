import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RightSheetLive } from '../RightSheetLive';

import {
  beginSheetCast,
  finishSheetCast,
  resetSheetCastProgress,
} from '@/services/combat/sheet-cast-progress';

const rightSheetProps = vi.hoisted(() => ({
  latest: undefined as undefined | { castingSpellId?: string },
}));

vi.mock('../RightSheet', () => ({
  RightSheet: (props: { castingSpellId?: string }) => {
    rightSheetProps.latest = props;
    return null;
  },
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: { id: 'char-1' } }, dispatch: vi.fn() }),
}));
vi.mock('../useOverhaulViewModel', () => ({
  useOverhaulViewModel: () => ({
    character: {
      spells: {
        cantrips: [{ id: 'acid-splash', name: 'Acid Splash', level: 0, isPrepared: true }],
        known: [{ id: 'magic-missile', name: 'Magic Missile', level: 1, isPrepared: true }],
        prepared: [],
      },
    },
  }),
}));

describe('RightSheetLive cast state (#2418)', () => {
  afterEach(() => act(() => resetSheetCastProgress()));

  it('holds every Cast button while a cast from another mount of the sheet is in flight', () => {
    render(<RightSheetLive />);
    expect(rightSheetProps.latest?.castingSpellId).toBeUndefined();

    act(() => {
      beginSheetCast('Acid Splash');
    });
    expect(rightSheetProps.latest?.castingSpellId).toBe('acid-splash');

    act(() => finishSheetCast());
    expect(rightSheetProps.latest?.castingSpellId).toBeUndefined();
  });
});
