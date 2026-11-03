import React from 'react';

import { playthroughLabel, type SavedPlaythrough } from './saved-playthroughs';

import { Button } from '@/components/ui/button';

/** Rows for the "Choose a saved playthrough" dialog. Newest last-played first. */
export const SavedPlaythroughList: React.FC<{
  rows: readonly SavedPlaythrough[];
  now?: number;
  onChoose: (row: SavedPlaythrough) => void;
}> = ({ rows, now = Date.now(), onChoose }) => (
  <div className="flex flex-col gap-2">
    {rows.map((row) => (
      <Button
        key={row.characterId}
        type="button"
        variant="outline"
        className="min-h-11 justify-start text-left"
        onClick={() => onChoose(row)}
      >
        {playthroughLabel(row, now)}
      </Button>
    ))}
  </div>
);
