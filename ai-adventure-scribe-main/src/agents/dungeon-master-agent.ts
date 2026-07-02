/**
 * Dungeon Master Agent
 *
 * Core AI Dungeon Master logic.
 * Manages game state, coordinates responses, interacts with memory,
 * and communicates with other agents.
 *
 * Dependencies:
 * - Agent interfaces and types (src/agents/types.ts)
 * - Messaging service (src/agents/messaging/agent-messaging-service.ts)
 * - Error handling services (src/agents/error/services/ErrorHandlingService.ts)
 * - Response coordinator (src/agents/services/response/response-coordinator.ts)
 * - Game state types (src/types/gameState.ts)
 * - Memory manager (src/agents/services/memory/EnhancedMemoryManager.ts)
 *
 * @author AI Dungeon Master Team
 */

// ============================
// Project Imports
// ============================

// Agent Core & Types
import { Agent, AgentResult, AgentTask } from './types';
import { ErrorCategory, ErrorSeverity } from './error/types';
import { GameState } from '@/types/gameState';
import { MessagePriority, MessageType } from './messaging/types';

// Services
import { AgentMessagingService } from './messaging/agent-messaging-service';
import { ErrorHandlingService } from './error/services/error-handling-service';
import { ResponseCoordinator } from './services/response/ResponseCoordinator';
import { ResponsePipeline } from './services/response/ResponsePipeline';
import { CachedCampaignContextProvider } from './services/campaign/CachedCampaignContextProvider';
import { ConversationStateStore } from './services/conversation/ConversationStateStore';
import { DungeonMasterContextManager } from './services/dm/DungeonMasterContextManager';
import encounterGenerator from '@/services/encounters/encounter-generator';
import { EncounterGenerationInput, EncounterSpec } from '@/types/encounters';
import { postEncounterTelemetry } from '@/services/encounters/telemetry-client';
import { logger } from '../lib/logger';

export class DungeonMasterAgent implements Agent {
  // ====================================
  // Types and Interfaces
  // ====================================
  // (none needed here, but this is where you'd define local types)

  // ====================================
  // Agent identity
  // ====================================
  id: string;
  role: string;
  goal: string;
  backstory: string;
  verbose: boolean;
  allowDelegation: boolean;

  // ====================================
  // Dependencies and State
  // ====================================
  private messagingService: AgentMessagingService;
  private responseCoordinator: ResponseCoordinator;
  private responsePipeline: ResponsePipeline;
  private errorHandler: ErrorHandlingService;
  private contextManager: DungeonMasterContextManager;
  private lastEncounterAt: number = 0;
  private readonly encounterCooldownMs = 120000; // 2 minutes

  // ====================================
  // Constructor
  // ====================================
  /**
   * Creates a new DungeonMasterAgent instance.
   */
  constructor() {
    this.id = 'dm_agent_1';
    this.role = 'Game Master';
    this.goal = 'Guide players through an engaging fantasy RPG campaign';
    this.backstory =
      'An experienced GM with vast knowledge of fantasy RPG rules and creative storytelling abilities';
    this.verbose = true;
    this.allowDelegation = true;

    this.messagingService = AgentMessagingService.getInstance();
    this.responseCoordinator = new ResponseCoordinator();
    this.responsePipeline = new ResponsePipeline({
      responseCoordinator: this.responseCoordinator,
      campaignProvider: new CachedCampaignContextProvider(),
      conversationStore: new ConversationStateStore(),
    });
    this.errorHandler = ErrorHandlingService.getInstance();
    this.contextManager = new DungeonMasterContextManager();
  }

  /**
   * Executes an agent task, updating game state, storing memories, and generating a response.
   *
   * @param {AgentTask} task - The task to execute
   * @returns {Promise<AgentResult>} The result of the task execution
   */
  async executeTask(task: AgentTask): Promise<AgentResult> {
    try {
      logger.info(`DM Agent executing task: ${task.description}`);

      // Initialize context and memory manager
      await this.contextManager.initialize(task);

      // Enhance the task with game state and recent memories
      const enhancedTask = await this.contextManager.enhanceTask(task);

      // Generate the DM response using the response pipeline
      const { result: response } = await this.responsePipeline.execute(enhancedTask);

      if (!response.success) {
        return response;
      }

      // Store response memories and update internal game state
      await this.contextManager.updateFromResponse(response);

      // Targeted invocation hooks (no player UI)
      await this.maybeInvokeEncounterHooks(enhancedTask, response);

      // Notify other agents (rules interpreter, narrator) with the response
      await this.notifyAgents(enhancedTask, response);

      return response;
    } catch (error) {
      logger.error('Error executing DM agent task:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to execute task',
      };
    }
  }

  /**
   * Plans an encounter using the internal orchestrator (players never see this directly).
   */
  public planEncounter(input: EncounterGenerationInput): EncounterSpec {
    return encounterGenerator.generate(input);
  }

  /**
   * Notifies other agents (rules interpreter, narrator) with task results.
   *
   * @private
   * @param {AgentTask} task - The original task
   * @param {AgentResult} response - The generated response
   * @returns {Promise<void>}
   */
  private async notifyAgents(task: AgentTask, response: AgentResult): Promise<void> {
    await this.errorHandler.handleOperation(
      async () =>
        this.messagingService.sendMessage(
          this.id,
          'rules_interpreter_1',
          MessageType.TASK,
          {
            taskDescription: task.description,
            result: response,
          },
          MessagePriority.HIGH,
        ),
      {
        category: ErrorCategory.AGENT,
        context: 'DungeonMasterAgent.notifyAgents',
        severity: ErrorSeverity.MEDIUM,
      },
    );

    await this.errorHandler.handleOperation(
      async () =>
        this.messagingService.sendMessage(
          this.id,
          'narrator_1',
          MessageType.RESULT,
          {
            taskId: task.id,
            result: response,
          },
          MessagePriority.MEDIUM,
        ),
      {
        category: ErrorCategory.AGENT,
        context: 'DungeonMasterAgent.notifyAgents',
        severity: ErrorSeverity.MEDIUM,
      },
    );
  }

  /**
   * Ask Rules Interpreter to validate an encounter spec.
   */
  public async validatePlannedEncounter(spec: EncounterSpec): Promise<void> {
    await this.errorHandler.handleOperation(
      async () =>
        this.messagingService.sendMessage(
          this.id,
          'rules_interpreter_1',
          MessageType.TASK,
          {
            taskDescription: 'Validate planned encounter',
            ruleType: 'encounter',
            encounterSpec: spec,
            monsters: [], // kept empty here; Rules Interpreter can load SRD
          },
          MessagePriority.HIGH,
        ),
      {
        category: ErrorCategory.AGENT,
        context: 'DungeonMasterAgent.validatePlannedEncounter',
        severity: ErrorSeverity.MEDIUM,
      },
    );
  }

  /**
   * Internal targeted hooks to plan/validate encounters based on pacing signals.
   */
  private async maybeInvokeEncounterHooks(task: AgentTask, _response: AgentResult): Promise<void> {
    const now = Date.now();
    if (now - this.lastEncounterAt < this.encounterCooldownMs) return;

    const gameState = this.contextManager.getGameState();
    const threat = gameState.sceneStatus?.threatLevel;
    const justRested =
      typeof task.description === 'string' && /(short|long)\s+rest/i.test(task.description);

    let trigger: 'none' | 'combat' | 'exploration' = 'none';
    if (threat === 'high' || threat === 'medium') trigger = 'combat';
    else if (justRested) trigger = 'exploration';

    if (trigger === 'none') return;

    const sessionId = task.context?.sessionId as string | undefined;
    const input = {
      type: trigger,
      party: { members: [{ level: 3 }] }, // TODO: replace with real party snapshot when available
      world: { biome: 'forest' },
      requestedDifficulty: trigger === 'combat' ? 'medium' : 'easy',
      sessionId,
    } as EncounterGenerationInput;

    const spec = this.planEncounter(input);
    await this.validatePlannedEncounter(spec);
    this.lastEncounterAt = now;
  }

  /**
   * Report outcome telemetry for adaptive difficulty. No player UI involved.
   */
  public async reportEncounterOutcome(
    sessionId: string,
    spec: EncounterSpec,
    resourcesUsedEst: number,
  ): Promise<void> {
    try {
      await postEncounterTelemetry({ sessionId, difficulty: spec.difficulty, resourcesUsedEst });
    } catch (e) {
      logger.warn('Failed to post encounter telemetry', e);
    }
  }
}
