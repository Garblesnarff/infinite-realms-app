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
      'src/integrations/supabase/database.types.ts',
      'src/integrations/supabase/types.ts',

      // Top violators requiring refactoring (1000+ lines)
      'src/contexts/CombatContext.tsx', // 1199 lines
      'src/contexts/combat/combat-reducer.ts',
      'src/services/ai-service.ts', // 1142 lines
      'src/services/ai/dm-response-processor.ts',
      'src/components/combat/CombatInterface.tsx', // 966 lines

      // Engine files needing modularization (800+ lines)
      'src/engine/world/orchestrator.ts', // 884 lines
      'src/engine/world/graph.ts', // 838 lines
      'src/engine/world/graph-logic.ts',
      'src/engine/multiplayer/SessionManager.ts', // 833 lines

      // Test files (acceptable to be longer)
      'src/__tests__/**/*.test.ts',
      'src/__tests__/**/*.test.tsx',
      'src/**/__tests__/**/*.test.ts',
      'src/**/__tests__/**/*.test.tsx',

      // Additional large production files
      'src/hooks/use-game-session.ts', // 797 lines
      'src/hooks/use-progressive-voice.ts',
      'src/hooks/use-voice-audio-control.ts',
      'src/services/voice-director.ts',
      'src/services/voice-routing.ts',
      'src/components/combat/CombatActionPanel.tsx', // 773 lines
      'src/components/character-creation/steps/RaceSelection.tsx', // 766 lines
      'src/components/ui/sidebar.tsx', // 761 lines
      'src/services/ai/prompts/game-context-prompts.ts',
      'src/services/ai/prompts/combat-rules-prompts.ts',
      'src/services/ai/prompts/character-description-prompts.ts',
      'src/utils/vision-calculations.ts',
      'src/utils/vision-polygon.ts',
      'src/utils/lighting-integration.ts',
      'src/utils/fog-calculations.ts',
      'src/utils/vision-worker-manager.ts',
      'src/workers/vision-worker.ts',
      'src/shaders/light-blend.tsx', // 271 lines - shader with JSX component
      'src/services/prompts/characterPrompts.ts',
      'src/services/prompts/character-prompt-helpers.ts',
      'src/components/battle-map/VisionPolygon.tsx',
      'src/components/battle-map/ToolOptionsPanel.tsx',
      'src/examples/vision-system-usage.tsx',
      'server-bun/src/services/inventory-service.ts',
      'server-bun/src/routes/v1/inventory.ts',
      'server-bun/src/services/character-folder-service.ts',
      'server-bun/src/services/progression-service.ts',
      'server-bun/src/services/character-service.ts',
      'src/components/scenes/SceneCreationWizard.tsx',
      'src/features/campaign/components/creation/steps/CampaignParameterSection.tsx',
      'src/features/campaign/components/creation/steps/GenreSelection.tsx',
      'server-bun/src/services/spell-slots-service.ts',
      'server-bun/src/services/spell-slots/spell-slot-mechanics.ts',
      'server-bun/src/services/rest-service.ts',
      'server-bun/src/services/combat-hp-service.ts',
      'server-bun/src/services/combat/hp-mechanics.ts',
      'server-bun/src/types/combat.ts',
      'src/utils/downtimeActivities.ts',
      'src/utils/restMechanics.ts',
      'src/utils/__tests__/restMechanics.test.ts',
      'src/utils/characterModifiers.ts',
      'src/utils/conditionEffects.ts',
      'src/utils/condition-definitions.ts',
      'src/utils/combatDetection.ts',
      'src/utils/multiclassing.ts',
      'src/utils/__tests__/multiclassing.test.ts',
      'src/utils/classFeatures.ts',
      'src/hooks/use-combat-actions.ts',
      'src/hooks/useAdvancedSpellcasting.ts',
      'src/hooks/use-combat-mechanics.ts',
      'src/utils/reactionTriggers.ts',
      'src/components/battle-map/LayersPanel.tsx',
      'src/components/battle-map/TokenConditionIcons.tsx',
      'src/components/battle-map/VisionRange.tsx',
      'src/features/character/components/sheet/character-sheet-tabs.tsx',
      'src/components/character-sheet/character-sheet-tabs.tsx',
      'src/features/character/components/list/character-card.tsx',
      'src/components/character-sheet/tabs/InventoryTab.tsx',
      'src/features/character/components/sheet/tabs/InventoryTab.tsx',
      'src/components/character-creation/steps/race-selection/RaceCard.tsx',
      'src/components/character-creation/steps/ClassSelection.tsx',
      'src/components/character-creation/steps/AdvancedSpellcastingSelection.tsx',
      'server-bun/src/services/scene-service.ts',
      'server-bun/src/services/conditions-service.ts',
      'server-bun/src/services/conditions/condition-mechanics.ts',
      'src/features/campaign/components/view/SimpleCampaignView.tsx',
      'src/features/campaign/components/view/CampaignCharacterSelection.tsx',
      'server-bun/src/services/combat/combat-attack-service.ts',
      'server-bun/src/services/combat/data-access.ts',
      'server-bun/src/routes/v1/blog/posts.ts',
      'server-bun/src/routes/v1/blog/posts-workflow.ts',
      'src/hooks/ai/roll-processor.ts',
      'src/hooks/use-ai-response.ts',
      'src/hooks/use-initial-greeting.ts',
      'src/services/combat/CombatSequenceValidator.ts',
      'src/utils/memory/patterns.ts',
      'server-bun/src/trpc/routers/blog-taxonomy.ts',
      'src/components/blog-admin/blog-post-editor/media-manager.tsx',
      'src/features/game-session/hooks/use-chat-history.ts',
      'src/features/game-session/components/chat/SimpleGameChatWithVoice.tsx',
      'src/components/spells/SpellCard.tsx',
      'src/features/character/components/spells/SpellCard.tsx',
      'src/features/game-session/components/dice/DiceRollEmbed.tsx',
      'src/components/combat/CombatMessage.tsx',
      'src/services/world-builders/world-builder-service.ts',
      'server-bun/src/services/vision-blocker-service.ts',
      'src/features/character/components/sheet/tabs/components/CombatVitals.tsx',
    ],
    rules: {
      'max-lines': 'warn',
    },
  },
  // Prettier integration - must be last to override conflicting rules
  prettierConfig,
);
