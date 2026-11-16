import { createContext, useContext } from 'react';

/**
 * #1554: the game's combat flag, provided by GameProvider. Kept in its own module so a test that
 * mocks the GameContext module does not also lose this flag. Without a provider the flag is false.
 */
export const InCombatFlagContext = createContext(false);

/** Whether the game is in combat. The sheet's Lay on Hands control steps aside during a fight. */
export const useIsInCombatOptional = (): boolean => useContext(InCombatFlagContext);
