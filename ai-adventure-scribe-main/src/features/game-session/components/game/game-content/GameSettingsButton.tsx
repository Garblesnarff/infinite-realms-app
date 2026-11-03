import { Settings } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { PlayerSettings } from '@/features/settings/PlayerSettings';

/** Gear in the game top bar. Opens the same settings the Campaign Hub tab shows. */
export const GameSettingsButton: React.FC = () => {
  const [open, setOpen] = React.useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="ir-hit" aria-label="Settings">
          <Settings className="h-4 w-4" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      {open ? (
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Settings</SheetTitle>
            <SheetDescription>Table and narration preferences for this browser.</SheetDescription>
          </SheetHeader>
          <PlayerSettings />
        </SheetContent>
      ) : null}
    </Sheet>
  );
};
