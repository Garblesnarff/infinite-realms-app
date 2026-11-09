import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ENEMY_FAILS_SAVE,
  FIGHT_ROSTER,
  REEVES,
  SCHOLAR,
  spellAction,
} from '../../../../../../../shared/test-fixtures/engine-results';
import { RailOverStoryLayer } from '../../game-content/RailOverStoryLayer';
import { SpellTargetSaveCard } from '../../SpellTargetSaveCard';
import { RightSheetLive } from '../RightSheetLive';

import { useSpellTargetSaveHost } from '@/hooks/combat/use-spell-target-save-host';
import { formatCombatEngineParts } from '@/services/combat/combat-outcome-transcript';
import {
  beginSheetCastCommit,
  reportSheetCastResult,
  resetSheetCastProgress,
} from '@/services/combat/sheet-cast-progress';
import { holdSaveCardBeforeDm, clearHeldSaveCard } from '@/services/combat/sheet-cast-save-hold';

vi.mock('../RightSheet', () => ({
  RightSheet: ({ onCastSpell }: { onCastSpell: (spell: unknown) => void }) => (
    <button onClick={() => onCastSpell({ id: 'acid-splash', name: 'Acid Splash', level: 0 })}>
      Cast Acid Splash
    </button>
  ),
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: { id: 'char-1' } }, dispatch: vi.fn() }),
}));
vi.mock('../useOverhaulViewModel', () => ({
  useOverhaulViewModel: () => ({
    character: {
      spells: {
        cantrips: [{ id: 'acid-splash', name: 'Acid Splash', level: 0 }],
        known: [],
        prepared: [],
      },
    },
  }),
}));
vi.mock('@/features/game-session/hooks/use-show-target-numbers', () => ({
  useShowTargetNumbers: () => ({ showTargetNumbers: true }),
}));
vi.mock('@/services/combat/combat-attack-proposal', () => ({
  proposeAuthoritativeSpell: vi.fn(async () => ({ saveDC: 14 })),
}));

const Host = () => <SpellTargetSaveCard pending={useSpellTargetSaveHost()} />;

describe('sheet cast and target-save flow (#1428)', () => {
  afterEach(() => {
    resetSheetCastProgress();
    clearHeldSaveCard();
  });

  it('opens the save before the DM, then follows the engine result through the sheet stages', async () => {
    let finishResolution: (() => void) | undefined;
    const resolution = new Promise<void>((resolve) => {
      finishResolution = resolve;
    });
    const dm = vi.fn();
    const handler = vi.fn(async () => {
      await holdSaveCardBeforeDm({
        origin: 'sheet_cast',
        spellId: 'acid-splash',
        activeEncounter: {
          id: 'enc-1',
          currentTurnParticipantId: SCHOLAR.id,
          participants: [
            { ...SCHOLAR, participantType: 'player', currentHitPoints: 7 },
            { ...REEVES, participantType: 'monster', currentHitPoints: 9 },
          ],
        },
      });
      dm();
      beginSheetCastCommit(REEVES.name);
      await resolution;
      reportSheetCastResult(
        formatCombatEngineParts(spellAction(SCHOLAR, REEVES), ENEMY_FAILS_SAVE, FIGHT_ROSTER)[0]
          .card,
      );
    });
    render(
      <>
        <Host />
        <RailOverStoryLayer onClose={() => {}}>
          <RightSheetLive spellCastHandlerRef={{ current: handler }} />
        </RailOverStoryLayer>
      </>,
    );
    expect(screen.getByTestId('rail-over-story')).toHaveAttribute('data-stage', 'idle');
    fireEvent.click(screen.getByRole('button', { name: 'Cast Acid Splash' }));
    const card = await screen.findByTestId('spell-target-save-card');
    expect(card).toHaveTextContent('Captain Sarah Reeves');
    expect(screen.getByTestId('rail-over-story')).toHaveAttribute('data-stage', 'save');
    expect(dm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(screen.getByTestId('rail-over-story')).toHaveAttribute('data-stage', 'resolving'),
    );
    expect(dm).toHaveBeenCalledOnce();
    await act(async () => {
      finishResolution?.();
      await resolution;
    });
    await waitFor(() =>
      expect(screen.getByTestId('rail-over-story')).toHaveAttribute('data-stage', 'done'),
    );
  });
});
