import React from 'react';

import { resultSealFill, resultSealTone, type ResultSealTone } from './result-seal';

/**
 * The Check board stamp: a wax circle whose word is the engine's verdict.
 * No loop. The fill is a flat colour so the word stays at 7:1.
 */
export const ResultWaxSeal: React.FC<{
  word: string;
  tone?: ResultSealTone;
  engineTone?: 'gold' | 'red' | 'grey' | null;
}> = ({ word, tone, engineTone }) => {
  const sealTone = tone ?? resultSealTone(word, engineTone);
  return (
    <span
      data-testid="engine-roll-seal"
      data-seal-tone={sealTone}
      className={`ir-wax-seal ir-wax-seal--${sealTone} inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full px-2 text-center text-[11px] font-bold uppercase leading-tight tracking-[.06em]`}
      style={{ background: resultSealFill(sealTone), color: '#fff' }}
    >
      {word}
    </span>
  );
};
