// Fixtures follow the producer shape from getLegalCombatActions
// (ai-adventure-scribe-main/server-bun/src/services/combat/combat-intent-service.ts)
// and buildCombatWeaponOptions (server-bun/src/services/combat/combat-weapon-options.ts).
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CombatActionBar } from '../CombatActionBar';

import type { LegalAction } from '@/features/game-session/hooks/use-combat-legal-actions';

const moveAction: LegalAction = { type: 'move', label: 'Move (30 ft remaining)', x: 3, y: 4 };
const attackAction: LegalAction = {
  type: 'attack',
  label: 'Attack with Longsword',
  weaponId: 'longsword',
  targetIds: ['goblin-1'],
};
const dashAction: LegalAction = { type: 'dash', label: 'Dash' };
const dodgeAction: LegalAction = { type: 'dodge', label: 'Dodge' };
const disengageAction: LegalAction = { type: 'disengage', label: 'Disengage' };
const spellAction: LegalAction = {
  type: 'spell',
  label: 'Cast Fire Bolt',
  spellId: 'fire-bolt',
  targetIds: ['goblin-1'],
};
const endTurnAction: LegalAction = { type: 'end_turn', label: 'End turn' };

const nameOf = (id: string): string =>
  id === 'goblin-1' ? 'Goblin' : id === 'goblin-2' ? 'Goblin 2' : id;

const defaultProps = {
  actions: [
    moveAction,
    attackAction,
    dashAction,
    dodgeAction,
    disengageAction,
    spellAction,
    endTurnAction,
  ],
  enabled: true,
  hasSpells: true,
  consumables: [{ id: 'rations', name: 'Rations' }],
  nameOf,
  attackSub: 'Longsword · +5',
  moveSub: '30 ft',
  canMove: true,
  spellInfo: () => ({ range: '120 feet', timing: 'action' as const }),
  onAction: vi.fn(),
  onMove: vi.fn(),
  onUseItem: vi.fn(),
};

describe('CombatActionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('your turn', async () => {
    const onAction = vi.fn();
    const onMove = vi.fn();
    render(<CombatActionBar {...defaultProps} onAction={onAction} onMove={onMove} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Your actions' });
    const buttons = within(toolbar).getAllByRole('button');
    expect(buttons[0]).toHaveTextContent(/^Attack/);
    expect(buttons[1]).toHaveTextContent(/^Cast/);
    expect(buttons[2]).toHaveTextContent(/^Move/);
    expect(buttons[3]).toHaveTextContent(/^Dodge/);
    expect(buttons[4]).toHaveTextContent(/^Use item/);
    expect(buttons[5]).toHaveTextContent(/^End turn/);
    buttons.forEach((b) => expect(b).not.toBeDisabled());

    const user = userEvent.setup();
    await user.click(within(toolbar).getByRole('button', { name: /^Attack/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(attackAction);

    await user.click(within(toolbar).getByRole('button', { name: /^Dodge/ }));
    expect(onAction).toHaveBeenCalledWith(dodgeAction);

    await user.click(within(toolbar).getByRole('button', { name: /^End turn/ }));
    expect(onAction).toHaveBeenCalledWith(endTurnAction);

    await user.click(within(toolbar).getByRole('button', { name: /^Move/ }));
    expect(onMove).toHaveBeenCalled();
  });

  it('action used', () => {
    render(<CombatActionBar {...defaultProps} actions={[moveAction, endTurnAction]} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Your actions' });
    const attackBtn = within(toolbar).getByRole('button', { name: /^Attack/ });
    const castBtn = within(toolbar).getByRole('button', { name: /^Cast/ });
    expect(attackBtn).toBeDisabled();
    expect(castBtn).toBeDisabled();
    expect(attackBtn).toHaveClass('opacity-45');
    expect(castBtn).toHaveClass('opacity-45');
    expect(within(toolbar).getByRole('button', { name: /^Move/ })).not.toBeDisabled();
    expect(within(toolbar).getByRole('button', { name: /^End turn/ })).not.toBeDisabled();
  });

  it('enemy turn', () => {
    render(<CombatActionBar {...defaultProps} enabled={false} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Your actions' });
    within(toolbar)
      .getAllByRole('button')
      .forEach((b) => expect(b).toBeDisabled());
  });

  it('no spells', () => {
    render(<CombatActionBar {...defaultProps} hasSpells={false} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Your actions' });
    expect(within(toolbar).queryByRole('button', { name: /^Cast/ })).toBeNull();
  });

  it('no items', () => {
    render(<CombatActionBar {...defaultProps} consumables={[]} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Your actions' });
    expect(within(toolbar).queryByRole('button', { name: 'Use item' })).toBeNull();
  });

  it('two targets', async () => {
    const onAction = vi.fn();
    const twoTargetAttack: LegalAction = { ...attackAction, targetIds: ['goblin-1', 'goblin-2'] };
    const actions = [
      moveAction,
      twoTargetAttack,
      dashAction,
      dodgeAction,
      disengageAction,
      spellAction,
      endTurnAction,
    ];
    render(<CombatActionBar {...defaultProps} actions={actions} onAction={onAction} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Your actions' });
    const chevron = within(toolbar).getByRole('button', { name: 'Other weapons and targets' });
    expect(chevron).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(chevron);
    expect(
      screen.getByRole('menuitem', { name: 'Attack with Longsword → Goblin' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Attack with Longsword → Goblin 2' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: 'Attack with Longsword → Goblin 2' }));
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'attack',
        label: 'Attack with Longsword',
        weaponId: 'longsword',
        targetIds: ['goblin-2'],
      }),
    );
  });

  it('Cast menu', async () => {
    const onAction = vi.fn();
    render(<CombatActionBar {...defaultProps} onAction={onAction} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Your actions' });
    const user = userEvent.setup();
    await user.click(within(toolbar).getByRole('button', { name: /^Cast/ }));
    const item = (await screen.findAllByRole('menuitem')).find((mi) =>
      mi.textContent?.includes('Cast Fire Bolt → Goblin'),
    )!;
    expect(item).toHaveTextContent('120 feet · action');
    await user.click(item);
    expect(onAction).toHaveBeenCalledWith(spellAction);
  });

  it('classes', () => {
    render(<CombatActionBar {...defaultProps} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Your actions' });
    expect(toolbar).toHaveClass('flex', 'flex-wrap', 'gap-2', 'items-center');
    const attackBtn = within(toolbar).getByRole('button', { name: /^Attack/ });
    expect(attackBtn).toHaveClass(
      'border-infinite-gold',
      'text-infinite-gold',
      'bg-infinite-gold/10',
      'min-h-11',
    );
    within(toolbar)
      .getAllByRole('button')
      .forEach((btn) => {
        if (btn.getAttribute('aria-label') === 'Other weapons and targets') return;
        expect(btn).toHaveClass('min-h-11');
        expect(btn).toHaveClass('max-[699px]:flex-1');
        expect(btn).toHaveClass('max-[699px]:basis-[calc(33%-8px)]');
      });
    expect(within(toolbar).getByRole('button', { name: /^End turn/ })).toHaveClass(
      'min-[700px]:ml-auto',
    );
    expect(screen.getByText('Longsword · +5')).toHaveClass(
      'text-xs',
      'text-muted-foreground',
      'max-[699px]:hidden',
    );
    expect(screen.getByText('30 ft')).toHaveClass(
      'text-xs',
      'text-muted-foreground',
      'max-[699px]:hidden',
    );
  });
});
