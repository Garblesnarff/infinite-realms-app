import React, { useEffect, useRef } from 'react';

import type { PendingLethalActionConfirmation } from '@/hooks/combat/use-lethal-action-confirmation-host';

import { Button } from '@/components/ui/button';

interface Props {
  confirmation: PendingLethalActionConfirmation | null;
}

export const LethalActionConfirmation: React.FC<Props> = ({ confirmation }) => {
  const noButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirmation) return undefined;
    noButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        confirmation.cancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirmation]);

  if (!confirmation) return null;
  const { confirm, cancel } = confirmation;

  return (
    <div
      role="alertdialog"
      aria-labelledby="lethal-action-title"
      aria-describedby="lethal-action-desc"
      data-testid="lethal-action-confirmation"
      className="bg-card border border-infinite-gold rounded-lg p-4 shadow-2xl"
    >
      <p id="lethal-action-title">Are you sure?</p>
      <p id="lethal-action-desc">This can kill the hero.</p>
      <div className="mt-3 flex gap-2">
        <Button ref={noButtonRef} type="button" onClick={cancel} data-action="decline" autoFocus>
          No
        </Button>
        <Button type="button" onClick={confirm} data-action="confirm">
          Yes
        </Button>
      </div>
    </div>
  );
};
