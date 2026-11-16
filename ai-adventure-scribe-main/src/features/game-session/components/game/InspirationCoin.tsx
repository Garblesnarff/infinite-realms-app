import type { ReactElement, ReactNode } from 'react';

import { useOptionalCharacter } from '@/contexts/CharacterContext';
import { useInspirationArmed } from '@/features/game-session/contexts/inspiration-armed-context';

/**
 * #1414: the Table's Inspiration coin. Hidden until the flag is known (the character has not
 * loaded, or the envelope carries no inspiration value); gold while the character has
 * inspiration, grey once spent. Tapping a gold coin arms advantage on the next roll — the
 * flag itself is spent server-side only when that roll is submitted, so disarming costs
 * nothing. Colours are the Table tokens (ir-table.css): brass on ink for gold, slate on
 * parchment for grey.
 */

export interface InspirationCoinFaceProps {
  hasInspiration: boolean;
  armed?: boolean;
  readOnly?: boolean;
  ariaLabel?: string;
  onClick?: () => void;
  children?: ReactNode;
}

/**
 * Shared presentational face for the Inspiration coin. Renders as a <button> for the Table
 * (arm/disarm on click) and as a non-button <div> for read-only surfaces such as the
 * character sheet, which may not have InspirationArmedProvider.
 */
export function InspirationCoinFace({
  hasInspiration,
  armed = false,
  readOnly = false,
  ariaLabel,
  onClick,
  children,
}: InspirationCoinFaceProps): ReactElement {
  const className = hasInspiration
    ? `inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded-full border border-[color:var(--ir-brass-3)] bg-[linear-gradient(var(--ir-brass-1),var(--ir-brass-2))] px-3 text-sm font-semibold text-[color:var(--ir-brass-ink)] ${
        armed && !readOnly
          ? 'ring-2 ring-[color:var(--ir-brass-1)] ring-offset-2 ring-offset-[color:var(--ir-felt-2)]'
          : ''
      }`
    : 'inline-flex min-h-11 min-w-11 cursor-not-allowed items-center gap-1.5 rounded-full border border-[color:var(--ir-wax-slate)] bg-[color:var(--ir-wax-slate)] px-3 text-sm font-semibold text-[color:var(--ir-parchment-1)] opacity-70';

  const content = (
    <>
      <span aria-hidden="true">✦</span>
      {children}
    </>
  );

  if (readOnly) {
    return (
      <div className={className} aria-label={ariaLabel}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={className}
      aria-pressed={armed}
      aria-label={ariaLabel}
      disabled={!hasInspiration}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

export function InspirationCoin(): ReactElement | null {
  const characterContext = useOptionalCharacter();
  const { armed, arm, disarm } = useInspirationArmed();
  const inspiration = characterContext?.state.character?.inspiration;
  if (inspiration === undefined) return null;
  const hasInspiration = inspiration === true;
  return (
    <InspirationCoinFace
      hasInspiration={hasInspiration}
      armed={armed}
      ariaLabel={
        hasInspiration
          ? armed
            ? 'Inspiration armed — advantage on your next roll. Activate to disarm.'
            : 'Spend Inspiration — advantage on your next roll'
          : 'No Inspiration'
      }
      onClick={() => (armed ? disarm() : arm())}
    >
      Inspiration{armed ? ' · armed' : ''}
    </InspirationCoinFace>
  );
}
