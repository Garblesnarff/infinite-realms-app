# Guardian Journal 🧪

## Learnings
- **D&D 5e Combat Logic**: Resistance reduces damage by half (floored). Vulnerability doubles damage. Resistance and Vulnerability stack; if both apply to one instance, calculate resistance first (floored), then apply vulnerability.
- **Testing Supabase**: Mocking the Supabase client requires careful attention to the chainable methods (`from`, `select`, `update`, `eq`, `single`). Each method in the chain should be mocked to return the appropriate next link (usually `this` or a Promise).
- **Vitest Configuration**: In this project, `vitest.config.ts` uses an explicit `include` list. New tests must be added manually to this list and to `coverage.include` for proper tracking.
- **Linting**: Strict import ordering and file length limits (200 lines) are enforced. Use `eslint-disable` sparingly for test files with complex mock setups.
- **Combat Validation**: The `CombatSequenceValidator` ensures D&D 5e rule compliance. Testing it requires covering various DM message patterns and state transitions (e.g., initiative -> turn order -> attack -> damage).
- **Test Discovery**: In this project, new tests MUST be manually added to `vitest.config.ts`'s `include` array and `coverage.include` to be picked up by the CI and coverage reporter.

## 2025-02-02 - [Bug Found] calculateHitPoints logic flaw
**Learning:** The previous implementation of `calculateHitPoints` in `src/utils/character-calculations.ts` only ensured the *total* hit points were at least 1. However, D&D 5e rules state that a character must gain at least 1 hit point *per level* upon leveling up.
**Action:** Improved the logic to apply `Math.max(1, ...)` to both the 1st level base HP and the subsequent level gains individually. Added unit tests to verify this edge case.

## 2025-02-02 - [Linting] max-lines for core utilities
**Learning:** The project enforces a strict 200-line limit for most files. Core utility files like `src/utils/character-calculations.ts` and their corresponding test files are allowed to exceed this limit using `/* eslint-disable max-lines */` at the top of the file to maintain logic cohesion.
**Action:** Applied `/* eslint-disable max-lines */` to `src/utils/character-calculations.ts` and `src/utils/__tests__/character-calculations.test.ts` to resolve linting errors.
