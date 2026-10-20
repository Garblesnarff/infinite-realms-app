import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ProficienciesSelection from '../ProficienciesSelection';

import { rogue } from '@/data/classes/rogue';

const state = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({
    state: {
      character: {
        class: rogue,
        level: 1,
        background: {
          skillProficiencies: ['Athletics', 'Intimidation'],
          languages: 0,
          toolProficiencies: ['One type of gaming set'],
        },
        race: { languages: ['Common'] },
      },
    },
    dispatch: state.dispatch,
  }),
}));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
describe('#898 creator proficiency commit', () => {
  it('commits the choices after selecting Expertise last and includes class tools', () => {
    const { container } = render(<ProficienciesSelection />);
    for (const skill of ['Insight', 'Stealth', 'Perception', 'Acrobatics'])
      fireEvent.click(container.querySelector(`[id="${skill}"]`)!);
    fireEvent.click(container.querySelector('[id="expertise-Insight"]')!);
    fireEvent.click(container.querySelector('[id="expertise-Stealth"]')!);
    expect(state.dispatch).toHaveBeenLastCalledWith({
      type: 'UPDATE_CHARACTER',
      payload: {
        skillProficiencies: [
          'Athletics',
          'Intimidation',
          'Insight',
          'Stealth',
          'Perception',
          'Acrobatics',
        ],
        expertiseProficiencies: ['Insight', 'Stealth'],
        toolProficiencies: ["Thieves' tools", 'One type of gaming set'],
        savingThrowProficiencies: ['dexterity', 'intelligence'],
        languages: ['Common'],
      },
    });
  });
});
