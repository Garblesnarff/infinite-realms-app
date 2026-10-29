import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { makeDie, symmetry, topIndex, type DieType } from '../diceShapes';
import { expandRolls } from '../PhysicsDiceBox';

import type { DiceRollResult } from '@/services/dice/DiceEngine';

vi.mock('howler', () => ({
  Howl: vi.fn(),
}));

const cases: Array<{ type: DieType; values: number[]; tens?: boolean }> = [
  { type: 'd4', values: [1, 2, 3, 4] },
  { type: 'd6', values: [1, 2, 3, 4, 5, 6] },
  { type: 'd8', values: [1, 2, 3, 4, 5, 6, 7, 8] },
  { type: 'd10', values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
  { type: 'd12', values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { type: 'd20', values: Array.from({ length: 20 }, (_, i) => i + 1) },
  { type: 'd10', values: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90], tens: true },
  { type: 'd10', values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
];

describe('dice face symmetry', () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  });
  afterAll(() => vi.restoreAllMocks());

  it('lands every die face on the engine-selected value (80/80)', () => {
    let checked = 0;
    cases.forEach(({ type, values, tens }) => {
      const die = makeDie(type, 0.95, tens);
      values.forEach((value, targetIndex) => {
        const observedIndex = (targetIndex + 1) % die.directions.length;
        const source = die.directions[observedIndex];
        const tableNormal = new THREE.Vector3(0, type === 'd4' ? -1 : 1, 0);
        const toTable = new THREE.Quaternion().setFromUnitVectors(source, tableNormal);
        const orientation = toTable.multiply(symmetry(die, targetIndex, observedIndex));
        expect(
          die.readResult(orientation),
          `${type} target=${targetIndex} observed=${observedIndex}`,
        ).toBe(value);
        expect(topIndex(die, orientation).dot).toBeGreaterThan(0.985);
        checked += 1;
      });
    });
    expect(checked).toBe(80);
  });

  it('lands every (observed, target) pair on the engine-selected value', () => {
    let checked = 0;
    cases.forEach(({ type, values, tens }) => {
      const die = makeDie(type, 0.95, tens);
      values.forEach((_value, targetIndex) => {
        die.directions.forEach((_direction, observedIndex) => {
          const source = die.directions[observedIndex];
          const tableNormal = new THREE.Vector3(0, type === 'd4' ? -1 : 1, 0);
          const toTable = new THREE.Quaternion().setFromUnitVectors(source, tableNormal);
          const orientation = toTable.multiply(symmetry(die, targetIndex, observedIndex));
          expect(
            die.readResult(orientation),
            `${type} target=${targetIndex} observed=${observedIndex}`,
          ).toBe(values[targetIndex]);
          expect(topIndex(die, orientation).dot).toBeGreaterThan(0.985);
          checked += 1;
        });
      });
    });
    expect(checked).toBe(960);
  });

  it('shows face "0" for an engine d10 value of 10', () => {
    const die = makeDie('d10', 0.95);
    const index = die.faceIndexForValue(10);
    expect(die.faces[index].value).toBe(0);
    const tableNormal = new THREE.Vector3(0, 1, 0);
    const orientation = new THREE.Quaternion().setFromUnitVectors(
      die.directions[index],
      tableNormal,
    );
    expect(die.readResult(orientation)).toBe(0);

    const result = {
      expression: '1d10',
      total: 10,
      rolls: [{ dice: 10, value: 10, sign: 1 as const, critical: false }],
      modifiers: 0,
      advantage: false,
      disadvantage: false,
      critical: false,
      naturalRoll: 10,
      timestamp: 1,
    } as DiceRollResult;
    const specs = expandRolls(result);
    expect(specs).toHaveLength(1);
    expect(specs[0].target).toBe(0);
    expect(specs[0].die.faceIndexForValue(specs[0].target)).toBe(index);
  });
});
