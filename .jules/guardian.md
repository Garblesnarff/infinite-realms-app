# Guardian Journal 🧪

## Learnings
- **D&D 5e Combat Logic**: Resistance reduces damage by half (floored). Vulnerability doubles damage. Resistance and Vulnerability stack; if both apply to one instance, calculate resistance first (floored), then apply vulnerability.
- **Testing Supabase**: Mocking the Supabase client requires careful attention to the chainable methods (`from`, `select`, `update`, `eq`, `single`). Each method in the chain should be mocked to return the appropriate next link (usually `this` or a Promise).
- **Vitest Configuration**: In this project, `vitest.config.ts` uses an explicit `include` list. New tests must be added manually to this list and to `coverage.include` for proper tracking.
- **Linting**: Strict import ordering and file length limits (200 lines) are enforced. Use `eslint-disable` sparingly for test files with complex mock setups.
- **Combat Validation**: The `CombatSequenceValidator` ensures D&D 5e rule compliance. Testing it requires covering various DM message patterns and state transitions (e.g., initiative -> turn order -> attack -> damage).
- **Test Discovery**: In this project, new tests MUST be manually added to `vitest.config.ts`'s `include` array and `coverage.include` to be picked up by the CI and coverage reporter.

## 2025-05-15 - [Character Calculations Bug Fixes]
**Learning:** Found that `calculateHitPoints` was missing the D&D 5e "minimum 1 HP per level" rule, and `calculateArmorClass` was ignoring shields and Monk shield restrictions.
**Action:** Always test D&D math utilities with extreme edge cases (like score 1, modifier -5) and negative class-specific interactions (like Monk + Shield). Centralized math utilities are prone to growing beyond 200 lines; use `eslint-disable max-lines` if refactoring isn't immediate.

## 2025-05-16 - [NPC Auto-Roller Test Coverage]
**Learning:** The `npc-auto-roller.ts` service handles critical "behind the screen" DM logic. Testing it revealed that it correctly separates NPC rolls from player rolls but needed verification for edge cases like critical hits/misses and formatting for various roll types (attack, damage, save, initiative).
**Action:** When testing services that interface with the `DiceEngine`, mock the engine to return specific `naturalRoll` values (1, 20, etc.) to verify critical logic and formatting in the calling service. Always check that the `autoExecute` flag is enforced to prevent accidental auto-rolling of player requests.

## 2025-05-20 - [Rest Mechanics Bug Found]
**Learning:** Found a bug in `rollHitDice` and `processShortRestCombat` where hit dice were under-rolled. The loop condition `i < Math.min(numDice, remainingDice)` was re-evaluated as `remainingDice` was decremented, causing the loop to terminate early (approximately half the requested dice were rolled).
**Action:** Always capture loop limits in a local variable before starting a loop if the variables in the limit expression are modified within the loop.

## 2025-05-24 - [Condition Effects Logic Fixes]
**Learning:** Found that `getConditionModifiers` in `src/utils/conditionEffects.ts` had incorrect logic for several conditions (like `blinded`) because it relied on `participantType === 'player'` instead of the `rollType`. This meant players never received the correct defensive penalties for being blinded.
**Action:** Always use `rollType` (e.g., 'attack', 'defense', 'save') to determine which side of a condition's effect to apply. When testing situational advantage/disadvantage, call `getConditionModifiers` on the participant *possessing* the condition with the appropriate `rollType` (e.g., 'defense' if they are being targeted).
