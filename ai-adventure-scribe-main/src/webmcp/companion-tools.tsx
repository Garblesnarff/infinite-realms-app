import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import {
  CompanionApiError,
  getCompanionId,
  getCombatActorId,
  getCombatEncounterId,
  getSceneCompanionId,
  getCompanionScene,
  joinParty,
  listMyCharacters,
  rollForCompanion,
  speakAsCompanion,
  submitCombatIntent,
} from './companion-api';
import { companionSceneQueryKey } from './use-companion-scene';

import type { CompanionSceneResponse, CombatIntent, RollForCompanionInput } from './companion-api';
import type { FC, MutableRefObject } from 'react';

import logger from '@/lib/logger';

export interface WebMcpToolResult {
  content: Array<{ type: 'text'; text: string }>;
}

export interface WebMcpExecutionContext {
  signal?: AbortSignal;
}

export interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
  };
  execute: (
    input: Record<string, unknown>,
    context?: WebMcpExecutionContext,
  ) => Promise<WebMcpToolResult>;
}

export interface WebMcpModelContext {
  registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => Promise<void> | void;
}

declare global {
  interface Document {
    modelContext?: WebMcpModelContext;
  }

  interface Navigator {
    modelContext?: WebMcpModelContext;
  }
}

interface CompanionToolsOptions {
  sessionId: string;
  lastSceneRef?: MutableRefObject<CompanionSceneResponse | null>;
  companionIdRef?: MutableRefObject<string | null>;
  onSceneChanged?: (scene: CompanionSceneResponse) => void;
  onMutation?: () => void;
}

const objectSchema = (
  properties: Record<string, unknown> = {},
  required: string[] = [],
): Record<string, unknown> => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const textSchema = { type: 'string' };

const toolResult = (result: unknown): WebMcpToolResult => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify(result) ?? String(result),
    },
  ],
});

const errorResult = (error: unknown): WebMcpToolResult => ({
  content: [
    {
      type: 'text',
      text:
        error instanceof CompanionApiError
          ? error.responseBody
          : error instanceof Error
            ? error.message
            : String(error),
    },
  ],
});

const valueAsString = (input: Record<string, unknown>, key: string): string => {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const signalFrom = (context?: WebMcpExecutionContext): AbortSignal | undefined => context?.signal;

const activeCompanionId = (ref: MutableRefObject<string | null>): string => {
  if (!ref.current) {
    throw new Error('Join a companion with join_party before using this tool');
  }
  return ref.current;
};

const targetIdForName = (scene: CompanionSceneResponse, targetName: string): string | null => {
  const participants = scene.combat?.participants ?? [];
  const participant = participants.find(
    (candidate) => candidate.name?.toLocaleLowerCase() === targetName.toLocaleLowerCase(),
  );
  return participant?.id ?? participant?.participant_id ?? null;
};

export const createCompanionTools = ({
  sessionId,
  lastSceneRef = { current: null },
  companionIdRef = { current: null },
  onSceneChanged,
  onMutation,
}: CompanionToolsOptions): WebMcpTool[] => {
  const execute = async (action: () => Promise<unknown>): Promise<WebMcpToolResult> => {
    try {
      return toolResult(await action());
    } catch (error) {
      logger.warn('[WebMCP] Companion tool failed:', error);
      return errorResult(error);
    }
  };

  return [
    {
      name: 'join_party',
      description:
        'Join a companion to this game session. Pick character_id from list_my_characters first.',
      inputSchema: objectSchema({ character_id: textSchema }, ['character_id']),
      execute: (input, context) =>
        execute(async () => {
          const result = await joinParty(
            sessionId,
            valueAsString(input, 'character_id'),
            signalFrom(context),
          );
          companionIdRef.current = getCompanionId(result) ?? companionIdRef.current;
          onMutation?.();
          return result;
        }),
    },
    {
      name: 'list_my_characters',
      description: 'List the authenticated user’s existing characters available to join the party.',
      inputSchema: objectSchema(),
      annotations: { readOnlyHint: true },
      execute: (_input, context) => execute(() => listMyCharacters(signalFrom(context))),
    },
    {
      name: 'get_scene',
      description:
        'Get the current redacted scene, party, dialogue, and combat state for this game session.',
      inputSchema: objectSchema(),
      annotations: { readOnlyHint: true },
      execute: (_input, context) =>
        execute(async () => {
          const scene = await getCompanionScene(
            sessionId,
            companionIdRef.current,
            signalFrom(context),
          );
          lastSceneRef.current = scene;
          companionIdRef.current = getSceneCompanionId(scene) ?? companionIdRef.current;
          onSceneChanged?.(scene);
          return scene;
        }),
    },
    {
      name: 'speak_as_companion',
      description: 'Send in-world speech from the joined companion into the current session.',
      inputSchema: objectSchema({ text: textSchema }, ['text']),
      execute: (input, context) =>
        execute(async () => {
          const result = await speakAsCompanion(
            sessionId,
            activeCompanionId(companionIdRef),
            valueAsString(input, 'text'),
            signalFrom(context),
          );
          onMutation?.();
          return result;
        }),
    },
    {
      name: 'roll_for_companion',
      description:
        'Request an engine-resolved skill, ability, or saving throw for the joined companion.',
      inputSchema: objectSchema(
        {
          kind: { type: 'string', enum: ['skill', 'ability', 'save'] },
          name: textSchema,
          reason: textSchema,
        },
        ['kind', 'name'],
      ),
      execute: (input, context) =>
        execute(async () => {
          const kind = valueAsString(input, 'kind') as RollForCompanionInput['kind'];
          if (!['skill', 'ability', 'save'].includes(kind)) {
            throw new Error('kind must be skill, ability, or save');
          }
          const reason = typeof input.reason === 'string' ? input.reason : undefined;
          const result = await rollForCompanion(
            sessionId,
            activeCompanionId(companionIdRef),
            { kind, name: valueAsString(input, 'name'), ...(reason ? { reason } : {}) },
            signalFrom(context),
          );
          onMutation?.();
          return result;
        }),
    },
    {
      name: 'act_in_combat',
      description:
        'Take a combat action for the joined companion; only legal on your turn; the engine will refuse otherwise — call get_scene to check whose turn it is.',
      inputSchema: objectSchema(
        {
          action_type: {
            type: 'string',
            enum: [
              'attack',
              'heal',
              'dodge',
              'dash',
              'disengage',
              'move',
              'spell',
              'help',
              'hide',
              'ready',
              'search',
              'use_item',
              'end_turn',
            ],
          },
          target_name: textSchema,
        },
        ['action_type'],
      ),
      execute: (input, context) =>
        execute(async () => {
          const scene = lastSceneRef.current;
          if (!scene) throw new Error('Call get_scene before act_in_combat');
          if (!scene.combat) throw new Error('There is no active combat in the current scene');

          const encounterId = getCombatEncounterId(scene.combat);
          const actorId = getCombatActorId(scene.combat);
          if (!encounterId || !actorId) {
            throw new Error('The current scene does not identify the companion combat turn');
          }

          const actionType = valueAsString(input, 'action_type');
          const targetName = typeof input.target_name === 'string' ? input.target_name : undefined;
          const targetId = targetName ? targetIdForName(scene, targetName) : null;
          if (targetName && !targetId) throw new Error(`No combat participant named ${targetName}`);

          const intent: CombatIntent = {
            type: actionType,
            actorId,
            ...(targetId ? { targetId } : {}),
          };
          const result = await submitCombatIntent(encounterId, intent, signalFrom(context));
          onMutation?.();
          return result;
        }),
    },
  ];
};

export const WebMcpCompanionBridge: FC<{ sessionId: string }> = ({ sessionId }) => {
  const queryClient = useQueryClient();
  const lastSceneRef = useRef<CompanionSceneResponse | null>(null);
  const companionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const mc = document.modelContext ?? navigator.modelContext;
    if (!mc) return undefined;

    lastSceneRef.current = null;
    companionIdRef.current = null;
    const abortController = new AbortController();
    const tools = createCompanionTools({
      sessionId,
      lastSceneRef,
      companionIdRef,
      onSceneChanged: (scene) => {
        queryClient.setQueryData(companionSceneQueryKey(sessionId), scene);
      },
      onMutation: () => {
        void queryClient.invalidateQueries({ queryKey: companionSceneQueryKey(sessionId) });
        void queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
      },
    });

    tools.forEach((tool) => {
      try {
        Promise.resolve(mc.registerTool(tool, { signal: abortController.signal })).catch(
          (error: unknown) => logger.warn('[WebMCP] Tool registration failed:', error),
        );
      } catch (error) {
        logger.warn('[WebMCP] Tool registration failed:', error);
      }
    });

    return () => abortController.abort();
  }, [queryClient, sessionId]);

  return null;
};

export default WebMcpCompanionBridge;
