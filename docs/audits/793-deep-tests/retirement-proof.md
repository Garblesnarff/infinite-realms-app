# Issue 793 client retirement proof

Baseline: dff923b19e47813be84d971d0bfcb28b7acf8b50

## Production graph

Entry index.html loads /src/main.tsx. Graph resolves relative and @/ static imports, re-exports and literal dynamic imports (including lazy route imports), conservatively including type-only imports. Built from all 1826 src TS/TSX/JS/JSX files; main reaches 959 files. None of the deletion candidates occur in that overapproximated graph.
Limits: regex scanner cannot prove nonliteral dynamic imports, import.meta.glob loading or external package consumers. Full repo searches below supplement it; no production glob or dynamic registry names these modules. src/landing-client.ts is a separate Vite landing entry and does not import these modules. CLI/server/shared/script searches found no consumers.

## Per-module direct importers and overlap checks

### src/utils/context/builder.ts

Open PR overlap: none.
Main reachable: False
Importers: src/utils/context/**tests**/builder.test.ts, src/utils/context/**tests**/context-utils.test.ts, src/utils/context/**tests**/no-dead-barrel-509.test.ts
Exported symbols: gameContextBuilder, formatEquipmentContextType

### src/utils/context/contextDefaults.ts

Open PR overlap: none.
Main reachable: False
Importers: src/utils/context/builder.ts, src/utils/context/**tests**/no-dead-barrel-509.test.ts
Exported symbols: createDefaultContext

### src/utils/context/contextEnhancement.ts

Open PR overlap: none.
Main reachable: False
Importers: src/utils/context/**tests**/context-utils.test.ts, src/utils/context/**tests**/no-dead-barrel-509.test.ts
Exported symbols: enhanceCampaignContext, enhanceMemoryContext, buildEnhancedGameContext

### src/utils/context/contextValidation.ts

Open PR overlap: none.
Main reachable: False
Importers: src/utils/context/contextEnhancement.ts, src/utils/context/**tests**/context-utils.test.ts, src/utils/context/**tests**/no-dead-barrel-509.test.ts
Exported symbols: validateCampaignSetting, validateThematicElements, sortMemoriesByRelevance, validateGameContext

### src/components/combat/CombatStatus.tsx

Open PR overlap: none.
Main reachable: False
Importers: src/components/combat/**tests**/CombatStatus.test.tsx
Exported symbols: CombatStatus

### src/services/combat/CombatSequenceValidator.ts

Open PR overlap: none.
Main reachable: False
Importers: src/test/combat-roll-flow.test.ts, src/services/combat/**tests**/CombatSequenceValidator.test.ts
Exported symbols: CombatPhase, CombatSequenceValidator, combatSequenceValidator

### src/services/combat/CombatActionTracker.ts

Open PR overlap: none.
Main reachable: False
Importers: src/services/combat/CombatSequenceValidator.ts, src/services/combat/**tests**/CombatActionTracker.test.ts
Exported symbols: PendingAttack, AwaitingDamage, CombatActionTracker

### src/services/combat/CombatTurnManager.ts

Open PR overlap: none.
Main reachable: False
Importers: src/services/combat/CombatSequenceValidator.ts, src/services/combat/**tests**/CombatTurnManager.test.ts
Exported symbols: InitiativeEntry, TurnOrder, CombatTurnManager

### src/services/combat/CombatResponseValidator.ts

Open PR overlap: none.
Main reachable: False
Importers: src/services/combat/CombatSequenceValidator.ts, src/services/combat/**tests**/CombatResponseValidator.test.ts
Exported symbols: CombatValidationError, CombatValidationResult, CombatStateProvider, CombatResponseValidator

### src/services/combat/dm-response-patterns.ts

Open PR overlap: none.
Main reachable: False
Importers: src/services/combat/CombatResponseValidator.ts, src/services/combat/**tests**/dm-response-patterns.test.ts
Exported symbols: detectsDirectDamage, detectsCombatStart, detectsAttackRequest, detectsSkillCheck, detectsDamageRequest, containsAC, containsDC, containsModifier

### src/services/combat-audit/index.ts

Open PR overlap: none.
Main reachable: False
Importers: src/test/combat-roll-flow.test.ts, src/services/combat/CombatActionTracker.ts, src/services/combat/CombatSequenceValidator.ts, src/services/combat/CombatTurnManager.ts, src/services/combat/**tests**/CombatActionTracker.test.ts, src/services/combat/**tests**/CombatSequenceValidator.test.ts, src/services/combat/**tests**/CombatTurnManager.test.ts, src/services/combat-audit/**tests**/CombatAuditSystem.test.ts
Exported symbols: CombatAuditSystem, combatAuditSystem

### src/services/combat-audit/reporter.ts

Open PR overlap: none.
Main reachable: False
Importers: src/services/combat-audit/index.ts, src/services/combat-audit/**tests**/reporter.test.ts
Exported symbols: generateAuditReport

### src/services/combat-audit/rules.ts

Open PR overlap: none.
Main reachable: False
Importers: src/services/combat-audit/index.ts, src/services/combat-audit/**tests**/rules.test.ts
Exported symbols: validateAction

### src/services/combat-audit/types.ts

Open PR overlap: none.
Main reachable: False
Importers: src/services/combat-audit/index.ts, src/services/combat-audit/reporter.ts, src/services/combat-audit/rules.ts, src/services/combat-audit/**tests**/reporter.test.ts, src/services/combat-audit/**tests**/rules.test.ts
Exported symbols: CombatAction, RuleViolation, AuditReport

## Cross-repository reference search

`references-before.txt` records rg output for every removed public symbol/module basename across repository. The similarly named server CombatStatus type and getCharacterCombatStatus route/service remain active and untouched. eslint.config.js stale allowlist entries are filename strings, not imports.

## Assertion inventory and preservation

- utils/context/builder.test.ts tests only removed GameContextBuilder. context-utils.test.ts tests only createDefaultContext, old validators and enhance/build helpers. Their assertions apply solely to the unreachable API; active ContextBuilder prompt assembly coverage is in services/ai/**tests**/context-builder\*.test.ts and services/ai/prompts/**tests**/game-context-prompts.test.ts, preserved.
- no-dead-barrel-509.test.ts: preserve first source-wide assertion prohibiting broken context barrel imports; remove second smoke test importing the four dead modules.
- CombatStatus.test.tsx: six component-specific cases assert retired phase badge labels, live-region attributes, participant HP/init and pending-roll count. None renders production GameContent. CombatTurnBarLive and CompactCharacterHeader are active replacements; their existing meaningful turn/status/accessibility and HP route coverage stays.
- CombatSequenceValidator, CombatActionTracker, CombatTurnManager, CombatResponseValidator, dm-response-patterns and combat-audit suites exercise only the removed in-browser singleton state and narrative string heuristics. No live route or server resolver appears in these test imports. Server initiative/attack/HP/security tests are independent and preserved.
- src/test/combat-roll-flow.test.ts: preserve Attack Roll Detection, Damage Roll Detection, Success Detection, Roll State Management, Dice Engine Integration, Complete Combat Flow Simulation (all assert active rollRequestParser, rollStateManager and DiceEngine behavior). Remove only Initiative Tracking and Turn Order and Combat Audit System describe blocks, plus retired imports/setup.
- Remove only vi.mock registrations of retired CombatStatus from GameMainContent and GameLayout.composer suites; preserve all assertions.
