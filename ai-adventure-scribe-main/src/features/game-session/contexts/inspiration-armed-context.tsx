import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useOptionalCharacter } from '@/contexts/CharacterContext';

export type InspirationArmedValue = {
  /** Advantage is armed for the next roll. The flag itself is spent server-side only when that roll is submitted. */
  armed: boolean;
  arm: () => void;
  disarm: () => void;
};

const InspirationArmedContext = createContext<InspirationArmedValue | null>(null);

/**
 * #1414: the armed-advantage state shared by the Inspiration coin (which arms it), the
 * roll request (which consumes it) and the combat action bar (which arms it from the
 * legal-action chip). Provided in GameProviders, next to the other session contexts.
 */
export function InspirationArmedProvider({ children }: { children: ReactNode }) {
  const [armed, setArmed] = useState(false);
  const arm = useCallback(() => setArmed(true), []);
  const disarm = useCallback(() => setArmed(false), []);
  // #1414 round 2: the arm belongs to one character — a switch (or unload) clears it,
  // so the next roll never spends the new character's flag for an arm made under the
  // old one. The first load (undefined → id) is not a switch, so it never disarms.
  const characterContext = useOptionalCharacter();
  const characterId = characterContext?.state.character?.id;
  const prevCharacterIdRef = useRef(characterId);
  useEffect(() => {
    if (prevCharacterIdRef.current !== undefined && prevCharacterIdRef.current !== characterId) {
      setArmed(false);
    }
    prevCharacterIdRef.current = characterId;
  }, [characterId]);
  const value = useMemo(() => ({ armed, arm, disarm }), [armed, arm, disarm]);
  return (
    <InspirationArmedContext.Provider value={value}>{children}</InspirationArmedContext.Provider>
  );
}

/**
 * #1414 round 4 (CI fix): the armed state is only meaningful inside a game session,
 * but useCombatLegalActions — which reads it directly — is also rendered outside
 * GameProviders (DynamicOptionsSection in tests, and any surface that mounts the
 * combat menu without the session providers). Throwing here broke every such render
 * (use-ai-response.combat-options.test.tsx: 17/17 in CI). Outside the provider there
 * is no arm to share, so the hook returns a safe default — not armed, arm/disarm
 * no-ops — the same optional-context pattern as useOptionalCharacter. Inside
 * GameProviders the real provider value is returned unchanged.
 */
const DEFAULT_ARMED_VALUE: InspirationArmedValue = {
  armed: false,
  arm: () => {},
  disarm: () => {},
};

export function useInspirationArmed(): InspirationArmedValue {
  return useContext(InspirationArmedContext) ?? DEFAULT_ARMED_VALUE;
}
