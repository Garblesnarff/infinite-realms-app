// #1423: the roll tray's natural-d20 state comes from the client dice engine's
// result (DiceEngine.roll), and the 3D physics die is only driven to that result;
// the die never reports a face that the UI reads. The stub's onSettled(1) below
// stands in for a physics die that settled on a different face (face 1).
// Not pinned here: moving the roll itself to the server engine.

import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiceRollEmbed } from '../DiceRollEmbed';

type StubProps = {
  result: { naturalRoll?: number } | null;
  onSettled?: () => void;
};

const recordedProps = vi.hoisted(() => [] as StubProps[]);

vi.mock('howler', () => ({
  Howl: vi.fn().mockImplementation(() => ({
    play: vi.fn(),
    unload: vi.fn(),
  })),
}));

vi.mock('../physics/PhysicsDiceBox', () => ({
  PhysicsDiceBox: (props: StubProps) => {
    recordedProps.push(props);
    React.useEffect(() => {
      if (props.result != null) {
        (props.onSettled as unknown as (face: number) => void)?.(1);
      }
    }, [props.result, props.onSettled]);
    return <div data-testid="physics-die" />;
  },
}));

vi.mock('@/services/dice/DiceEngine', () => ({
  DiceEngine: {
    roll: () => ({
      expression: '1d20+5',
      total: 25,
      rolls: [{ dice: 20, value: 20 }],
      modifiers: 5,
      critical: true,
      naturalRoll: 20,
      timestamp: 1,
    }),
  },
}));

describe('DiceRollEmbed natural face source (#1423)', () => {
  beforeEach(() => {
    recordedProps.length = 0;
    vi.stubEnv('VITE_DISABLE_DICE_3D', 'false');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('the natural 20 comes from DiceEngine.roll, not the face the physics die reports (#1423)', () => {
    const onRoll = vi.fn();
    render(
      <DiceRollEmbed
        expression="1d20+5"
        purpose="Investigation check"
        autoRoll
        showAnimation
        onRoll={onRoll}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    act(() => {
      vi.advanceTimersByTime(2100);
    });

    expect(recordedProps.some((p) => p.result?.naturalRoll === 20)).toBe(true);
    expect(screen.getByLabelText('Natural 20')).toBeInTheDocument();
    expect(screen.queryByLabelText('Natural 1')).not.toBeInTheDocument();
    expect(onRoll).toHaveBeenCalledTimes(1);
    expect(onRoll).toHaveBeenCalledWith(
      expect.objectContaining({ naturalRoll: 20, critical: true }),
    );
  });
});
