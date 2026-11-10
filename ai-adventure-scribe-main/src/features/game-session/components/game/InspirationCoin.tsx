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
export function InspirationCoin() {
  const characterContext = useOptionalCharacter();
  const { armed, arm, disarm } = useInspirationArmed();
  const inspiration = characterContext?.state.character?.inspiration;
  if (inspiration === undefined) return null;
  const hasInspiration = inspiration === true;
  return (
    <button
      type="button"
      className={
        hasInspiration
          ? `inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded-full border border-[color:var(--ir-brass-3)] bg-[linear-gradient(var(--ir-brass-1),var(--ir-brass-2))] px-3 text-sm font-semibold text-[color:var(--ir-brass-ink)] ${
              armed
                ? 'ring-2 ring-[color:var(--ir-brass-1)] ring-offset-2 ring-offset-[color:var(--ir-felt-2)]'
                : ''
            }`
          : 'inline-flex min-h-11 min-w-11 cursor-not-allowed items-center gap-1.5 rounded-full border border-[color:var(--ir-wax-slate)] bg-[color:var(--ir-wax-slate)] px-3 text-sm font-semibold text-[color:var(--ir-parchment-1)] opacity-70'
      }
      aria-pressed={armed}
      aria-label={
        hasInspiration
          ? armed
            ? 'Inspiration armed — advantage on your next roll. Activate to disarm.'
            : 'Spend Inspiration — advantage on your next roll'
          : 'No Inspiration'
      }
      disabled={!hasInspiration}
      onClick={() => (armed ? disarm() : arm())}
    >
      <span aria-hidden="true">✦</span>
      <span>Inspiration{armed ? ' · armed' : ''}</span>
    </button>
  );
}
