import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sound = vi.hoisted(() => ({ play: vi.fn() }));

vi.mock('three', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('three');
  class FakeWebGLRenderer {
    domElement = document.createElement('canvas');
    shadowMap = { enabled: false, type: undefined, mapSize: { set: vi.fn() } };

    setPixelRatio(): void {}

    setSize(): void {}

    render(): void {}

    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

vi.mock('howler', () => ({
  Howl: vi.fn(function FakeHowl() {
    return { play: sound.play, unload: vi.fn() };
  }),
}));

import { PhysicsDiceBox } from '../PhysicsDiceBox';

import type { DiceRollResult } from '@/services/dice/DiceEngine';

const result = {
  expression: '1d20',
  total: 9,
  rolls: [{ dice: 20, value: 9, sign: 1 as const, critical: false }],
  modifiers: 0,
  advantage: false,
  disadvantage: false,
  critical: false,
  naturalRoll: 9,
  timestamp: 3,
} as DiceRollResult;

describe('PhysicsDiceBox sound', () => {
  beforeEach(() => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    sound.play.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stays silent and hides its mute button when the Table setting is off', async () => {
    const view = render(
      <PhysicsDiceBox
        result={result}
        isRolling={false}
        showAnimation
        height={150}
        soundOn={false}
      />,
    );

    await waitFor(() => {
      expect(view.container.querySelector('canvas')).not.toBeNull();
    });
    expect(screen.queryByRole('button', { name: /dice sounds/i })).not.toBeInTheDocument();
    expect(sound.play).not.toHaveBeenCalled();
    view.unmount();
  });

  it('plays the roll sound when the Table setting is on, and the in-box button can mute it', async () => {
    const view = render(
      <PhysicsDiceBox result={result} isRolling={false} showAnimation height={150} soundOn />,
    );

    await waitFor(() => {
      expect(sound.play).toHaveBeenCalledTimes(1);
    });

    const toggle = screen.getByRole('button', { name: 'Mute dice sounds' });
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Unmute dice sounds' })).toBeInTheDocument();
    view.unmount();
  });
});
