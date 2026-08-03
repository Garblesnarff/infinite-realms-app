## 2026-03-06 - [Surgical Fog Raycasting Extraction]
**Challenge:** Extracting raycasting visibility polygon logic from a dense geometric utility file (`fog-calculations.ts`) without altering the public functions or breaking existing test imports.
**Learning:** Moving algorithmic raycasting helpers to a sister `-raycasting.ts` file keeps both files cleanly focused and under the codebase's strict 200-line budget. This allows removing the target from the ESLint overrides list while maintaining complete functionality and backward compatibility.
**Pattern:** For mathematically heavy utility files, separate pure geometric polygon calculations from raycasting/lighting queries. Export the sub-modules and re-export them from the main barrel utility to prevent consumer import churn.

## 2026-03-05 - [Surgical Prompt Templates Extraction]
**Challenge:** Extracting static XML-style prompt templates from a large prompt construction module (`combat-rules-prompts.ts`) without altering the class name or public methods to avoid breaking existing imports.
**Learning:** Separating multi-line static text templates into dedicated sub-modules reduces the size of logic/orchestration files significantly (from 389 down to ~120 lines). It also isolates static documentation strings from functional TypeScript logic, making the linter completely clean and files far easier to maintain.
**Pattern:** For static prompt-orchestration classes, extract multi-line XML structures to a sister `-templates.ts` file. Export them as uppercase constants (`COMBAT_RULES_TEMPLATE`) and reference them directly in the main class's static builder functions, allowing immediate reduction of the source file and removal from the ESLint overrides list.

## 2025-02-14 - [Rest Mechanics Extraction]
**Challenge:** Extracting Hit Dice and Exhaustion logic from `restMechanics.ts` into a new `src/utils/rest/` directory. The extraction was technically successful but violated the "ONE surgical extraction per PR" rule by moving two logical units at once.
**Learning:** Even when logical units are closely related, the "Scalpel" persona requires single, focused extractions. Always prioritize the largest files from the "Priority targets" list when they are available and haven't been refactored yet.
**Pattern:** Creating a new directory (e.g., `src/utils/rest/`) and re-exporting from the original file (e.g., `restMechanics.ts`) is an effective way to modularize while maintaining backward compatibility.

## 2026-02-17 - [Sidebar Refactor: Atomic Extraction]
**Challenge:** Refactoring a complex Shadcn-style Sidebar (503 lines) with multiple interconnected components, context, and constants into a modular structure without breaking existing imports.
**Learning:** Using a barrel/aggregator file at the original location allows for seamless refactoring while satisfying ESLint `max-lines` rules. Explicitly exporting from sub-modules (`export * from './sidebar/...'`) is safer than manual re-exports for large component sets.
**Pattern:** Directory-based refactoring for UI components: `component/` contains `component-context.tsx`, `component-parts.tsx`, and `component-main.tsx`, with the original `component.tsx` acting as a clean aggregator.
