import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { nameReadsAsPerson } from '../../../../shared/creature-name-kind';
import { CombatEntryConfirmation } from '../CombatEntryConfirmation';

import { confirmCombatEntry, type PendingCombatEntry } from '@/hooks/ai/combat-entry-hold';
import { useCombatEntryConfirmationHost } from '@/hooks/combat/use-combat-entry-confirmation-host';
import {
  settlePendingCombatEntryConfirmation,
  type CombatEntryOutcome,
} from '@/services/combat/combat-entry-confirmation-bridge';

function Host(): JSX.Element {
  const confirmation = useCombatEntryConfirmationHost('session-567-article');
  return <CombatEntryConfirmation confirmation={confirmation} />;
}

const player = { name: 'Tester', initiativeModifier: 0 };

function pendingFor(actorName: string, monsterId?: string): PendingCombatEntry {
  return {
    trigger: 'player_intent',
    detail: 'entry',
    combatants: [{ name: actorName, count: 1, ...(monsterId ? { monsterId } : {}) }],
    sceneSpec: null,
    sceneSpecSynthesized: false,
    declaredAttack: {
      verb: 'attack',
      actorName,
      attackSource: 'weapon',
      ...(monsterId ? { monsterId } : {}),
    },
  };
}

describe('combat entry title article (#567)', () => {
  beforeEach(() => {
    settlePendingCombatEntryConfirmation(false);
  });

  it('keeps the article for a creature kind', async () => {
    render(<Host />);
    await act(async () => {
      await Promise.resolve();
    });

    let outcomePromise: Promise<CombatEntryOutcome> | undefined;
    await act(async () => {
      outcomePromise = confirmCombatEntry(pendingFor('goblin'), player);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('combat-entry-confirmation-overlay')).toBeInTheDocument();
    });
    expect(screen.getByText('Attack the goblin?')).toBeInTheDocument();

    act(() => {
      settlePendingCombatEntryConfirmation(false);
    });
    if (outcomePromise) await outcomePromise;
  });

  it('drops the article for a proper name', async () => {
    render(<Host />);
    await act(async () => {
      await Promise.resolve();
    });

    let outcomePromise: Promise<CombatEntryOutcome> | undefined;
    await act(async () => {
      outcomePromise = confirmCombatEntry(pendingFor('Odile Vantrell'), player);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('combat-entry-confirmation-overlay')).toBeInTheDocument();
    });
    expect(screen.getByText('Attack Odile Vantrell?')).toBeInTheDocument();

    act(() => {
      settlePendingCombatEntryConfirmation(false);
    });
    if (outcomePromise) await outcomePromise;
  });

  it('keeps the article for Owlbear with an srd: monster id', async () => {
    render(<Host />);
    await act(async () => {
      await Promise.resolve();
    });

    let outcomePromise: Promise<CombatEntryOutcome> | undefined;
    await act(async () => {
      outcomePromise = confirmCombatEntry(pendingFor('Owlbear', 'srd:owlbear'), player);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('combat-entry-confirmation-overlay')).toBeInTheDocument();
    });
    expect(screen.getByText('Attack the Owlbear?')).toBeInTheDocument();

    act(() => {
      settlePendingCombatEntryConfirmation(false);
    });
    if (outcomePromise) await outcomePromise;
  });

  it('keeps the article for Giant Rats with an srd: monster id', async () => {
    render(<Host />);
    await act(async () => {
      await Promise.resolve();
    });

    let outcomePromise: Promise<CombatEntryOutcome> | undefined;
    await act(async () => {
      outcomePromise = confirmCombatEntry(pendingFor('Giant Rats', 'srd:giant-rat'), player);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('combat-entry-confirmation-overlay')).toBeInTheDocument();
    });
    expect(screen.getByText('Attack the Giant Rats?')).toBeInTheDocument();

    act(() => {
      settlePendingCombatEntryConfirmation(false);
    });
    if (outcomePromise) await outcomePromise;
  });
});

describe('creature-name-kind nameReadsAsPerson (#567)', () => {
  it('reads creature kinds as not persons', () => {
    expect(nameReadsAsPerson('goblin')).toBe(false);
    expect(nameReadsAsPerson('Goblin 2')).toBe(false);
    expect(nameReadsAsPerson('Vitruvian Spider')).toBe(false);
    expect(nameReadsAsPerson('Faceless Stalker')).toBe(false);
  });

  it('reads srd: monster ids as creature kinds', () => {
    expect(nameReadsAsPerson('Ghoul', 'srd:ghoul')).toBe(false);
  });

  it('reads proper names as persons', () => {
    expect(nameReadsAsPerson('Odile Vantrell')).toBe(true);
    expect(nameReadsAsPerson('Vance')).toBe(true);
    expect(nameReadsAsPerson('Captain Mira Holt')).toBe(true);
    expect(nameReadsAsPerson('Kaelen the Warlock')).toBe(true);
  });

  it('reads an all-symbol name as a person', () => {
    expect(nameReadsAsPerson('???')).toBe(true);
  });

  it('a leading article, a seat number and a non-kind noun follow the server rule', () => {
    expect(nameReadsAsPerson('The Ghoul')).toBe(false);
    expect(nameReadsAsPerson('Goblin 2')).toBe(false);
    expect(nameReadsAsPerson('Silk Woman')).toBe(true);
  });
});
