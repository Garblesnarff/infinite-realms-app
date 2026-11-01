import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import ClassFeatureTracker from '../../ClassFeatureTracker';

import type { Character, CharacterSheetUpdateFn } from '@/types/character';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

const onUpdate = vi.fn(async (_character: Character) => true);
const onUpdateProp = onUpdate as unknown as CharacterSheetUpdateFn;

const paladin = (classFeatures?: Record<string, unknown>): Character =>
  ({
    id: 'char-1',
    name: 'Test Paladin',
    class: { name: 'Paladin' },
    level: 1,
    classFeatures,
  }) as unknown as Character;

const indicatorTransform = (label: string): string => {
  const bar = screen.getByLabelText(label);
  const indicator = bar.firstElementChild as HTMLElement | null;
  return indicator?.style.transform ?? '';
};

describe('ClassFeatureTracker paladin pools (#712)', () => {
  it('the Lay on Hands bar follows the sheet JSON the server mirrors', () => {
    render(
      <ClassFeatureTracker
        character={paladin({ lay_on_hands: { maxUses: 5, currentUses: 2 } })}
        onUpdate={onUpdateProp}
      />,
    );

    // 2 of 5 HP left in the pool: the bar reads the mirrored pool, not the
    // static level x 5 values.
    expect(indicatorTransform('Lay on Hands remaining')).toBe('translateX(-60%)');
  });

  it('Divine Sense shows its uses once the sheet JSON carries them', () => {
    render(
      <ClassFeatureTracker
        character={paladin({ divine_sense: { maxUses: 1, currentUses: 0 } })}
        onUpdate={onUpdateProp}
      />,
    );

    expect(indicatorTransform('Divine Sense uses')).toBe('translateX(-100%)');
    expect(indicatorTransform('Divine Sense remaining')).toBe('translateX(-100%)');
    expect(screen.getAllByText('0 / 1')).toHaveLength(3);
  });

  it('without sheet JSON the bar stays static and Divine Sense shows no uses', () => {
    render(<ClassFeatureTracker character={paladin()} onUpdate={onUpdateProp} />);

    expect(indicatorTransform('Lay on Hands remaining')).toBe('translateX(-0%)');
    expect(screen.queryByLabelText('Divine Sense uses')).not.toBeInTheDocument();
  });
});
