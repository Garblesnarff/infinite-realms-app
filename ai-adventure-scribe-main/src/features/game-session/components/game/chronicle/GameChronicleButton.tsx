import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import ChronicleDialog from './ChronicleDialog';

import type { EndSessionTarget } from '../game-content/EndSessionButton';

import { Button } from '@/components/ui/button';

interface GameChronicleButtonProps {
  sessionId?: string | null;
  endSession?: EndSessionTarget;
  isFallen?: boolean;
}

export const GameChronicleButton: React.FC<GameChronicleButtonProps> = ({
  sessionId: sessionIdProp,
  endSession,
  isFallen,
}) => {
  const [searchParams] = useSearchParams();
  const sessionId = sessionIdProp !== undefined ? sessionIdProp : searchParams.get('session');
  const [open, setOpen] = useState(false);

  if (!sessionId) {
    return null;
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="ir-hit shrink-0"
        onClick={() => setOpen(true)}
      >
        Chronicle
      </Button>
      <ChronicleDialog
        sessionId={sessionId}
        open={open}
        onClose={() => setOpen(false)}
        endSession={endSession}
        isFallen={isFallen}
      />
    </>
  );
};
