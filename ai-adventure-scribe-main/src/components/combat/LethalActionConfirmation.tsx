import React from 'react';

import type { PendingLethalActionConfirmation } from '@/hooks/combat/use-lethal-action-confirmation-host';

import { Button } from '@/components/ui/button';

interface Props {
  confirmation: PendingLethalActionConfirmation | null;
}

export const LethalActionConfirmation: React.FC<Props> = ({ confirmation }) => {
  if (!confirmation) return null;
  const { confirm, cancel } = confirmation;

  return (
    <div
      data-testid="lethal-action-confirmation"
      className="bg-card border border-infinite-gold rounded-lg p-4 shadow-2xl"
    >
      <p>Are you sure?</p>
      <div className="mt-3 flex gap-2">
        <Button type="button" onClick={confirm} data-action="confirm">
          Yes
        </Button>
        <Button type="button" onClick={cancel} data-action="decline">
          No
        </Button>
      </div>
    </div>
  );
};
