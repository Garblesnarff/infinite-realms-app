import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'server/**',
      'supabase/**',
      'coverage/**',
      'src/engine/**',
      'src/agents/**',
      'unify-graphql/**',
      'unify-service-layer/**',
      'archive/**',
      'src/archive/**',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      import: importPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React Rules
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': 'warn',

      // TypeScript Strict Rules
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-function-return-type': [
        'warn',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': 'allow-with-description',
          'ts-nocheck': false,
          'ts-check': false,
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      // Note: @typescript-eslint/no-unnecessary-condition is disabled because it requires
      // type-aware linting which significantly slows down the linting process
      // "@typescript-eslint/no-unnecessary-condition": "warn",

      // Error Handling Patterns
      'no-throw-literal': 'error',
      'prefer-promise-reject-errors': 'error',

      // Import Organization
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling'], 'index', 'type'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
      'import/newline-after-import': 'error',
      'import/no-duplicates': 'error',

      // General Code Quality
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'all'],

      // Code Standards Enforcement (from CODE_STANDARDS.md)
      // Files should be under 200 lines
      'max-lines': [
        'error',
        {
          max: 200,
          skipBlankLines: true,
          skipComments: true,
        },
      ],

      // Architectural boundaries - path-based restrictions
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/domains',
              from: ['./src/features', './src/app'],
              message: 'Domain layer must not depend on UI layer',
            },
          ],
        },
      ],

      // Vertical Slice Architecture - import pattern restrictions
      // Features cannot import from internal paths of other features
      // Allows: @/features/feature-name, @/features/feature-name/hooks, @/features/feature-name/components
      // Blocks: @/features/feature-name/hooks/specific-hook, @/features/feature-name/components/path/Component
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*/*/*', '../features/*/*/*', '../../features/*/*/*'],
              message:
                "Do not import from feature internals. Import from feature's public API (index.ts) or use shared layer.",
            },
          ],
        },
      ],
    },
  },
  // Supabase migration guardrail - direct Supabase access is being phased out
  // in favor of the server-routed API. This intentionally uses the
  // `@typescript-eslint` flavor of `no-restricted-imports` (rather than
  // adding to the core `no-restricted-imports` rule above) because ESLint's
  // flat config merges `rules` per rule-name: a second top-level entry for
  // the *same* rule name would silently replace the existing error-level
  // vertical-slice-architecture config instead of layering on top of it.
  // Using a distinct rule name lets this guardrail run at 'warn' without
  // touching that rule's severity or patterns.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: [
                '@/integrations/supabase',
                '@/integrations/supabase/**',
                '**/integrations/supabase',
                '**/integrations/supabase/**',
              ],
              message:
                'Direct Supabase access is being migrated out — use the server-routed API (services/user-data-api, services/rest-api, or tRPC) instead.',
            },
          ],
        },
      ],
    },
  },
  // WorkOS token migration guardrail - direct token reads are being consolidated
  // in TokenService. This intentionally uses `no-restricted-syntax` (rather
  // than adding to an existing `no-restricted-imports` rule) because ESLint's
  // flat config merges `rules` per rule-name: a second top-level entry for the
  // *same* rule name would silently replace the existing configuration instead
  // of layering on top of it. Using a distinct rule name lets this guardrail
  // run at 'warn' without changing other architectural restrictions.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='getItem'][arguments.0.value='workos_access_token']",
          message:
            'Read WorkOS tokens through services/auth/TokenService instead of localStorage directly.',
        },
      ],
    },
  },
  // TokenService is the one intentional owner of direct WorkOS token storage access.
  {
    files: ['src/services/auth/TokenService.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  // =========================================================================
  // Drizzle insert-select ban
  // =========================================================================
  // `db.insert(table).select(subquery)` requires the subquery's projection to
  // list every column of the target table, in table-definition order. Drizzle
  // checks this when it *builds* the statement and throws synchronously:
  //
  //   Insert select error: selected fields are not the same or are in a
  //   different order compared to the table definition
  //
  // Nothing catches a violation earlier. The projection is written once, the
  // table grows a column later, and the write starts throwing 100% of the time
  // in production while every unit test that mocks `db` keeps passing.
  //
  // This was not hypothetical. 33537a67 fixed one such call site in
  // CombatEncounterService -- a projection covering 4 of combat_encounters' 13
  // columns, meaning structured combat had never worked for any client since it
  // shipped. Only that site was repaired. A sweep afterwards found the pattern at
  // 34 call sites, 30 of which were broken in exactly the same way: spells, XP,
  // class features, spell slots, hit dice, inventory, tokens, scenes, drawings,
  // fog of war, vision blockers, measurement templates, subclasses, folders,
  // permissions, blog categories/tags and the combat damage log had all never
  // written a row. They are now plain `insert().values()` calls preceded by an
  // explicit authorization query, and this rule stops the pattern returning.
  //
  // Scoped to server-bun/ and db/ because that is where Drizzle lives; the
  // separate `files` glob also keeps it from colliding with the WorkOS
  // `no-restricted-syntax` entry above (flat config replaces rather than merges
  // per rule name, see that comment).
  //
  // The `:not(...'from')` clause is what distinguishes this from the Supabase
  // client's unrelated `.from(t).insert(payload).select(cols)`, which is a
  // different API and is perfectly fine. Keying on the `.from()` in the chain
  // rather than on the argument type matters: Supabase call sites here pass a
  // named constant (`.select(CATEGORY_COLS)`), not a string literal.
  {
    files: ['server-bun/src/**/*.{ts,tsx}', 'db/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='select'][callee.object.type='CallExpression'][callee.object.callee.property.name='insert']:not([callee.object.callee.object.callee.property.name='from'])",
          message:
            'Drizzle insert-select is banned: the projection must list every column of the target table in order, and Drizzle only checks that at statement-build time, so a mismatch reaches production as a 100% failure rate. Run the authorization check as its own query and use insert().values() instead.',
        },
      ],
    },
  },
  // The insert-select guard test is the one place that builds these statements on
  // purpose -- it asserts that Drizzle rejects them, which is the whole argument for
  // the ban above. Exempting a single known file is preferable to inline disables
  // that would also mask a real regression sneaking into the same file.
  {
    files: ['server-bun/src/services/combat/__tests__/combat-encounter-insert-select.test.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  // Shared layer restrictions - cannot depend on features
  {
    files: ['src/shared/**/*'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*', '../features/*', '../../features/*'],
              message: 'Shared layer cannot depend on features.',
            },
          ],
        },
      ],
    },
  },
  // Infrastructure restrictions - cannot depend on features or shared
  {
    files: ['src/infrastructure/**/*'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*', '@/shared/*', '../features/*', '../shared/*'],
              message: 'Infrastructure cannot depend on features or shared.',
            },
          ],
        },
      ],
    },
  },
  // Enforce infrastructure layer usage - prevent bypassing infrastructure
  {
    files: ['src/**/*'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/services/gemini-api-manager',
              message: 'Use @/infrastructure/ai instead of importing directly from services',
            },
            {
              name: '@/services/gemini-api-manager-singleton',
              message: 'Use @/infrastructure/ai instead of importing directly from services',
            },
            {
              name: '@/services/llm-api-client',
              message: 'Use @/infrastructure/api instead of importing directly from services',
            },
            {
              name: '@/lib/trpc/client',
              message: 'Use @/infrastructure/api instead of importing from lib/trpc',
            },
            {
              name: '@/lib/trpc/hooks',
              message: 'Use @/infrastructure/api instead of importing from lib/trpc',
            },
            {
              name: '@/lib/trpc/Provider',
              message: 'Use @/infrastructure/api instead of importing from lib/trpc',
            },
          ],
        },
      ],
    },
  },
  // Override for existing large files (temporary - mark as warnings until refactored)
  // These files currently violate the 200-line limit and need refactoring
  {
    files: [
      // Generated type files (acceptable to be large)
      'src/integrations/supabase/types.ts',

      // Top violators requiring refactoring (1000+ lines)
      'src/contexts/GameContext.tsx',
      'src/contexts/CombatContext.tsx',
      'src/contexts/combat/health-handlers.ts',
      'src/contexts/combat/combat-reducer.ts',
      'src/services/ai-service.ts', // 1142 lines
      'src/services/ai/dm-response-processor.ts',
      'src/services/ai/__tests__/dm-response-processor.test.ts',
      'src/components/combat/CombatInterface.tsx', // 966 lines
      'src/pages/CampaignDetailPage.tsx',

      // Engine files needing modularization (800+ lines)

      // Test files (acceptable to be longer)
      'src/__tests__/**/*.test.ts',
      'src/__tests__/**/*.test.tsx',
      'src/**/__tests__/**/*.test.ts',
      'src/**/__tests__/**/*.test.tsx',
      'src/hooks/game-session/__tests__/use-session-management.test.ts',
      'src/hooks/game-session/__tests__/use-session-initialization.test.ts',
      'src/hooks/__tests__/useFogWebSocket.test.ts',
      'src/utils/__tests__/raycasting.test.ts',
      'src/hooks/ai/__tests__/session-logger.test.ts',
      'src/utils/combat/__tests__/attack-narration.test.ts',

      // Additional large production files
      'src/hooks/use-game-session.ts', // 797 lines
      'src/hooks/game-session/use-session-management.ts',
      'src/hooks/game-session/use-session-initialization.ts',
      'src/hooks/use-progressive-voice.ts',
      'src/hooks/voice/use-voice-processing.ts',
      'src/hooks/use-voice-audio-control.ts',
      'src/services/voice-consistency-service.ts',
      'src/services/voice-mapper.ts',
      'src/services/voice/voice-constants.ts',
      'src/components/character-creation/steps/RaceSelection.tsx', // 766 lines
      'src/components/character-creation/steps/variant-human/use-variant-human-selection.ts',
      'src/components/ui/sidebar-menu.tsx', // 264 lines
      'src/components/ui/option-selector/OptionInput.tsx',
      'src/services/ai/prompts/combat-rules-templates.ts',
      'src/services/ai/prompts/character-description-prompts.ts',
      'src/utils/character-calculations.ts',
      'src/utils/template-calculations.ts',
      'src/utils/attackUtils.ts',
      'src/utils/vision-calculations.ts',
      'src/utils/vision-polygon.ts',
      'src/utils/character/data-transformers.ts',
      'src/utils/image-label-generator.ts',
      'src/utils/performance/culling.ts',
      'src/data/progression-data.ts',
      'src/hooks/use-drawing-tool.ts', // 354 lines
      'src/components/game/NPCRollCard.tsx',
      'src/utils/lighting-integration.ts',
      'src/utils/polygon-utils.ts',
      'src/workers/vision-worker.ts',
      'src/workers/vision-raycasting.ts',
      'src/shaders/light-blend.tsx', // 271 lines - shader with JSX component
      'src/services/prompts/character-prompt-helpers.ts',
      'src/services/prompts/character-prompt-extractors.ts',
      'src/components/battle-map/VisionPolygon.tsx',
      'src/components/battle-map/QuickActionMenu.tsx',
      'src/components/battle-map/hooks/use-quick-action-menu.ts',
      'src/components/battle-map/ToolOptionsPanel.tsx',
      'src/components/battle-map/Toolbar.tsx',
      'src/components/ui/enhancement-panel.tsx',
      'server-bun/src/services/inventory-service.ts',
      'server-bun/src/services/inventory/inventory-data-access.ts',
      'server-bun/src/routes/v1/inventory.ts',
      'server-bun/src/services/character-folder-service.ts',
      'server-bun/src/services/progression-service.ts',
      'server-bun/src/services/character-service.ts',
      'server-bun/src/services/character/character-spell-service.ts',
      'server-bun/src/services/chronicle-generator.ts',
      'server-bun/src/services/character-permission-service.ts',
      'server-bun/src/services/progression/level-up-service.ts',
      'server-bun/src/services/combat-initiative-service.ts',
      'server-bun/src/services/measurement-service.ts',
      'server-bun/src/services/measurement/measurement-mechanics.ts',
      'server-bun/src/services/combat/combat-encounter-service.ts',
      'server-bun/src/services/combat/combat-authorization.ts',
      'src/components/scenes/SceneCreationWizard.tsx',
      'src/components/scenes/SceneTemplateLibrary.tsx',
      'src/components/scenes/scene-templates.ts',
      'src/components/scenes/MapUploader.tsx',
      'src/features/campaign/components/creation/steps/CampaignParameterSection.tsx',
      'src/features/campaign/components/creation/steps/GenreSelection.tsx',
      'server-bun/src/services/spell-slots-service.ts',
      'server-bun/src/services/spell-slots/spell-slot-data-access.ts',
      'server-bun/src/services/spell-slots/spell-slot-mechanics.ts',
      'server-bun/src/services/rest-service.ts',
      'server-bun/src/services/rest/rest-hit-dice-service.ts',
      'server-bun/src/ws.ts',
      'server-bun/src/services/combat-hp-service.ts',
      'server-bun/src/services/combat/hp-data-access.ts',
      'server-bun/src/services/combat/hp-mechanics.ts',
      'server-bun/src/types/combat.ts',
      'src/utils/downtimeActivities.ts',
      'src/utils/conditionEffects.ts',
      'src/utils/condition-definitions.ts',
      'src/utils/multiclassing.ts',
      'src/utils/lighting-integration.ts',
      'src/utils/__tests__/lighting-integration.test.ts',
      'src/utils/__tests__/multiclassing.test.ts',
      'src/utils/classFeatures.ts',
      'src/utils/character/class-definitions.ts',
      'src/utils/classMechanics.ts',
      'src/utils/movement-validation.ts',
      'src/utils/movement-navigation.ts',
      'src/hooks/use-combat-actions.ts',
      'src/hooks/combat/use-combat-action-handlers.ts',
      'src/hooks/use-combat-ai-integration.ts',
      'src/hooks/combat/use-combat-detection.ts',
      'src/hooks/useAdvancedSpellcasting.ts',
      'src/hooks/use-combat-mechanics.ts',
      'src/utils/reactionTriggers.ts',
      'src/components/battle-map/LayersPanel.tsx',
      'src/components/battle-map/LayerControlItem.tsx',
      'src/features/character/components/sheet/character-sheet-tabs.tsx',
      'src/features/character/components/sheet/multiclass/MulticlassSummary.tsx',
      'src/features/character/components/list/character-card.tsx',
      'src/features/character/components/list/CharacterCardHoverContent.tsx',
      'src/components/character-import-export/ImportDialog.tsx',
      'src/components/character-import-export/ImportCharacterPreview.tsx',
      'src/components/blog-admin/blog-posts-list.tsx',
      'src/components/blog-admin/blog-posts-table.tsx',
      'src/services/blog/blog-media-service.ts',
      'src/components/character-creation/steps/race-selection/RaceCard.tsx',
      'src/components/character-creation/steps/race-selection/use-race-selection.ts',
      'src/components/character-creation/steps/RaceSelection.tsx',
      'src/components/character-creation/steps/ClassSelection.tsx',
      'src/components/character-creation/steps/AbilityScoresSelection.tsx',
      'src/components/character-creation/steps/AdvancedSpellcastingSelection.tsx',
      'server-bun/src/services/llm-provider-service.ts',
      'server-bun/src/services/scene-service.ts',
      'server-bun/src/services/conditions-service.ts',
      'server-bun/src/services/conditions/condition-query-service.ts',
      'server-bun/src/services/conditions/condition-mechanics.ts',
      'server-bun/src/services/conditions/condition-query-service.ts',
      'server-bun/src/services/conditions/condition-lifecycle-service.ts',
      'server-bun/src/services/combat/combat-attack-service.ts',
      'server-bun/src/services/combat/data-access.ts',
      'server-bun/src/routes/v1/blog/posts.ts',
      'src/hooks/ai/roll-processor.ts',
      'src/hooks/use-ai-response.ts',
      'src/hooks/use-initial-greeting.ts',
      'src/utils/game-session/initial-greeting-memories.ts',
      'src/services/combat/CombatSequenceValidator.ts',
      'src/services/combat/CombatResponseValidator.ts',
      'src/services/dice/DiceEngine.ts',
      'src/services/dice/__tests__/DiceEngine.test.ts',
      'src/pages/StarterCharacterSelectionPage.tsx',
      'server-bun/src/trpc/routers/blog-taxonomy.ts',
      'src/components/blog-admin/blog-post-editor/media-manager.tsx',
      'src/features/game-session/hooks/use-chat-history.ts',
      'src/features/game-session/components/chat/message-list/MessageAssetDisplay.tsx',
      'src/features/game-session/components/chat/chat/DMChatBubble.tsx',
      'src/features/game-session/components/chat/chat/DMBubbleVoiceSection.tsx',
      'src/features/game-session/components/chat/ChatInput.tsx',
      'src/components/spells/SpellCard.tsx',
      'src/features/game-session/components/dice/DiceRollEmbed.tsx',
      'src/features/game-session/components/dice/Dice3DSection.tsx',
      'src/components/combat/CombatMessage.tsx',
      'src/services/world-builders/world-builder-service.ts',
      'src/services/world-builders/world-building-analyzer.ts',
      'server-bun/src/services/vision-blocker-service.ts',
      'src/features/character/components/sheet/tabs/components/CombatVitals.tsx',
      'src/hooks/use-character-save.ts',
      'src/contexts/AuthContext.tsx',
      'src/features/game-session/components/chat/message-list/MessageAssetDisplay.tsx',
      'src/features/game-session/components/chat/message-list/MessageListContainer.tsx',
      'src/features/game-session/components/chat/message-list/use-message-dice-rolls.ts',
      'src/features/game-session/components/game/message/use-message-handler-logic.ts',
      'src/features/game-session/components/game/message/use-message-command-handler.ts',
      'src/features/game-session/components/game/game-content/GameMainContent.tsx',
      'src/components/character-creation/steps/CharacterFinalization.tsx',
      'src/components/character-creation/steps/character-finalization/use-character-finalization.ts',
      'src/services/spell-progression-data.ts',
      'src/pages/AccountPage.tsx',
      'src/services/world-builders/quest-prompts.ts',
      'src/pages/BattleMapPage.tsx',
      'src/features/character/hooks/use-inventory-manager.ts',
      'src/components/scenes/SceneManager.tsx',
      'src/components/scenes/SceneCard.tsx',
      'src/components/scenes/SceneListItem.tsx',
      'src/services/ai/shared/verbalized-sampling.ts',
      'src/features/game-session/components/game/MemoryPanel.tsx',
      'src/features/game-session/components/game/DesktopGameSidePanel.tsx',
      'src/features/game-session/components/game/GameSidePanelContent.tsx',
      'src/features/game-session/components/chat/message-list/MessageAssetCards.tsx',
      'src/features/game-session/components/audio/VoicePlayerControls.tsx',
      'src/features/character/hooks/use-personality-manager.ts',
      'src/features/character/hooks/__tests__/use-personality-manager.test.ts',
      'src/services/blog/blog-service.ts',
      'src/hooks/blog/useBlogTaxonomy.ts',
      'src/utils/stealthUtils.ts',
      'src/utils/__tests__/stealthUtils.test.ts',
      'src/features/safety/SafetyCommandProcessor.ts',
      'src/components/character-sharing/ShareCharacterDialog.tsx',
      'src/components/character-sharing/SharedCharactersList.tsx',
      'src/components/character-folders/FolderTree.tsx',
      'src/components/character-folders/FolderItem.tsx',
      'src/components/blog-admin/blog-post-editor/blog-post-editor.tsx',
      'src/components/blog-admin/blog-post-editor/use-blog-post-editor.ts',
      'server-bun/src/services/blog-service.ts',
      'src/components/combat/ParticipantRow.tsx',
      'src/features/campaign/hooks/use-character-selection.ts',
      'src/components/character-creation/steps/PhysicalStep.tsx',
      'src/components/character-creation/steps/SpellSelection.tsx',
      'src/components/character-creation/steps/spell-selection/SpellSelectionTabs.tsx',
      'src/components/battle-map/hotkeys/constants.ts',
      'src/hooks/useSpellSelection.ts',
      'src/services/supabase-subscription-manager.ts',
      'src/components/spells/SpellFilterPanel.tsx',
      'src/hooks/blog/__tests__/useBlogTaxonomy.test.tsx',
      'src/components/game/__tests__/NPCRollDisplay.test.tsx',
      'src/components/game/voice/DMMessageVoiceControls.tsx',
      'src/components/game/voice/__tests__/DMMessageVoiceControls.test.tsx',
      'src/hooks/__tests__/use-drawing-tool.test.tsx',
      'src/contexts/character/character-updater.ts',
      'src/services/world-builders/npc-generator.ts',
      'src/services/world-builders/__tests__/npc-generator.test.ts',
      'src/components/game/DiceRollRequest.tsx',
      'src/components/game/DiceRollMessage.tsx',
      'src/utils/roll-request/regex-parser.ts',
      'src/utils/roll-request/__tests__/regex-parser.test.ts',
      'src/hooks/game/use-dice-roll-request.ts',
      'src/hooks/game/__tests__/use-dice-roll-request.test.ts',
      'server-bun/src/services/inventory/inventory-consumable-service.ts',
      'server-bun/src/services/inventory/__tests__/inventory-consumable-service.test.ts',
      'server-bun/src/services/token-service.ts',
      'server-bun/src/services/token/token-config-service.ts',
      'server-bun/src/services/token/token-link-service.ts',
      'server-bun/src/services/class-features-service.ts',
      'server-bun/src/services/progression/class-feature-usage-service.ts',
      'server-bun/src/services/session-service.ts',
      'server-bun/src/services/fog-of-war-service.ts',
      'src/components/character-creation/steps/StartingEquipmentSelection.tsx',
      'src/components/character-creation/steps/PersonalitySelection.tsx',
      'src/components/character-creation/steps/personality/use-personality-selection.ts',
      'src/features/game-session/components/game/FloatingActionPanel.tsx',
      'src/services/spellApi.ts',
      'src/services/__tests__/spellApi.test.ts',
      'src/services/__tests__/passive-skills-service.test.ts',
      'src/agents/services/lore-keeper/LoreKeeperService.ts',
      'src/agents/services/lore-keeper/__tests__/LoreKeeperService.test.ts',
      'src/features/character/components/sheet/sections/class-feature-tracker/ResourceSection.tsx',
      'server-bun/src/services/exhaustion-service.ts',
      'server-bun/src/services/exhaustion/exhaustion-mechanics.ts',
    ],
    rules: {
      'max-lines': 'warn',
    },
  },
  // Prettier integration - must be last to override conflicting rules
  prettierConfig,
);
