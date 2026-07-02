import { EnhancedMemoryManager } from '../memory/EnhancedMemoryManager';
import { AgentResult, AgentTask } from '../../types';
import { GameState } from '@/types/gameState';
import { logger } from '../../../lib/logger';

/**
 * Dungeon Master Context Manager
 *
 * Manages game state and memory integration for the DM Agent.
 * Extracted from DungeonMasterAgent to improve modularity and maintainability.
 */
export class DungeonMasterContextManager {
  private gameState: Partial<GameState>;
  private memoryManager: EnhancedMemoryManager | null = null;

  constructor() {
    this.gameState = this.initializeGameState();
  }

  /**
   * Initializes the default game state.
   */
  private initializeGameState(): Partial<GameState> {
    return {
      location: {
        name: 'Starting Location',
        description: 'The beginning of your adventure',
        atmosphere: 'neutral',
        timeOfDay: 'dawn',
      },
      activeNPCs: [],
      sceneStatus: {
        currentAction: 'beginning',
        availableActions: [],
        environmentalEffects: [],
        threatLevel: 'none',
      },
    };
  }

  /**
   * Returns the current game state.
   */
  public getGameState(): Partial<GameState> {
    return this.gameState;
  }

  /**
   * Initializes the memory manager and stores player action.
   * Consolidated from initializeMemoryManager and storePlayerActionMemory.
   */
  public async initialize(task: AgentTask): Promise<void> {
    // Initialize memory manager if needed
    if (task.context?.sessionId && !this.memoryManager) {
      this.memoryManager = new EnhancedMemoryManager(task.context.sessionId);
    }

    // Store the player's action in memory
    if (this.memoryManager) {
      await this.memoryManager.storeMemory(task.description, 'action', 'player_action', {
        location: this.gameState.location?.name,
      });
    }
  }

  /**
   * Enhances the task context with game state and recent memories.
   */
  public async enhanceTask(task: AgentTask): Promise<AgentTask> {
    const recentMemories = this.memoryManager
      ? await this.memoryManager.retrieveMemories({ timeframe: 'recent', limit: 10 })
      : [];

    return {
      ...task,
      context: {
        ...task.context,
        gameState: this.gameState,
        recentMemories,
      },
    };
  }

  /**
   * Updates game state and memory from the DM response.
   * Consolidated from storeResponseMemories, updateGameStateFromResponse, and updateGameState.
   */
  public async updateFromResponse(response: AgentResult): Promise<void> {
    if (!response.data?.narrativeResponse) return;

    const { environment, characters, opportunities } = response.data.narrativeResponse;

    // 1. Store response memories
    if (this.memoryManager) {
      await this.memoryManager.storeMemory(environment.description, 'description', 'location', {
        location: this.gameState.location?.name,
        npcs: characters.activeNPCs,
      });

      if (characters.dialogue) {
        await this.memoryManager.storeMemory(characters.dialogue, 'dialogue', 'npc', {
          location: this.gameState.location?.name,
          npcs: characters.activeNPCs,
        });
      }
    }

    // 2. Update internal game state
    this.gameState = {
      ...this.gameState,
      location: {
        ...this.gameState.location,
        description: environment.description,
        atmosphere: environment.atmosphere,
      },
      activeNPCs: characters.activeNPCs.map((name: string) => ({
        id: name.toLowerCase().replace(/\s/g, '_'),
        name,
        description: '',
        personality: '',
        currentStatus: 'active',
      })),
      sceneStatus: {
        ...this.gameState.sceneStatus,
        availableActions: opportunities.immediate,
      },
    };

    logger.info('Updated game state:', this.gameState);
  }
}
