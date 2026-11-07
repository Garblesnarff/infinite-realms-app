import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import ChronicleDialog from './ChronicleDialog';

import { Button } from '@/components/ui/button';

export const GameChronicleButton: React.FC = () => {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session');
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
      <ChronicleDialog sessionId={sessionId} open={open} onClose={() => setOpen(false)} />
    </>
  );
};
