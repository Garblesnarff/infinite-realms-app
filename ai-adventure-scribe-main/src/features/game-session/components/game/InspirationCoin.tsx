import React from 'react';

import { useOptionalCharacter } from '@/contexts/CharacterContext';

/** Display-only until spending can be persisted as part of a roll. */
export const InspirationCoin: React.FC = () => {
  const inspiration = useOptionalCharacter()?.state.character?.inspiration;
  const hasInspiration = inspiration === true;
  const state = inspiration == null ? 'unknown' : hasInspiration ? 'available' : 'unavailable';
  return (
    <div
      className="hidden text-center text-xs text-[#f6e3b8] [body.ir-table-look_&]:block max-[699px]:[body.ir-table-look_&]:flex max-[699px]:items-center max-[699px]:gap-1"
      role="status"
    >
      <span
        aria-hidden="true"
        className={`mx-auto flex h-11 w-11 items-center max-[699px]:h-6 max-[699px]:w-6 justify-center rounded-full border-2 ${hasInspiration ? 'border-[#f6e3b8] bg-[#a9823f] text-[#1a1206]' : 'border-slate-400 bg-slate-600 text-white'}`}
      >
        ★
      </span>
      <span>
        Inspiration {state}
        <span className="max-[699px]:hidden"> · spending coming soon</span>
      </span>
    </div>
  );
};
