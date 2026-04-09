/**
 * AI Service Public API
 *
 * Central export file for all AI service modules.
 * Maintains backward compatibility with the original ai-service.ts exports.
 *
 * @module ai
 */

// Export types
export type {
  ChatMessage,
  NarrationSegment,
  GameContext,
  CampaignParams,
  ClassEquipment,
  AIResponse,
} from './shared/types';

// Export campaign generation
export { generateCampaignDescription } from './campaign-generator';

// Export narration and DM services
export { chatWithDM } from './narration-service';

// Export conversation management
export { saveChatMessage, getConversationHistory } from './conversation-service';

// Export API manager
export { getApiStats } from './api-manager';
export type { ApiStats } from './api-manager';

/**
 * AIService class - Maintains backward compatibility
 *
 * This class wraps all the modular functions to maintain the original
 * static method API from ai-service.ts. Existing code can continue using
 * AIService.method() syntax without breaking changes.
 *
 * @example
 * ```typescript
 * // Old usage (still works)
 * const description = await AIService.generateCampaignDescription(params);
 * const response = await AIService.chatWithDM(chatParams);
 *
 * // New usage (preferred)
 * import { generateCampaignDescription, chatWithDM } from '@/services/ai';
 * const description = await generateCampaignDescription(params);
 * const response = await chatWithDM(chatParams);
 * ```
 */
export class AIService {
  /**
   * Generate a campaign description using AI with fallback
   */
  static async generateCampaignDescription(params: {
    genre: string;
    difficulty: string;
    length: string;
    tone: string;
  }): Promise<string> {
    const { generateCampaignDescription: generate } = await import('./campaign-generator');
    return generate(params);
  }

  /**
   * Simplified chat with AI DM for MVP with fallback and streaming support
   */
  static async chatWithDM(params: {
    message: string;
    context: any;
    conversationHistory?: any[];
    onStream?: (chunk: string) => void;
  }): Promise<any> {
    const { chatWithDM: chat } = await import('./narration-service');
    return chat(params);
  }

  /**
   * Save a chat message to the database
   */
  static async saveChatMessage(params: {
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    speakerId?: string;
    id?: string;
  }): Promise<void> {
    const { saveChatMessage: save } = await import('./conversation-service');
    return save(params);
  }

  /**
   * Get conversation history for a session
   */
  static async getConversationHistory(sessionId: string): Promise<any[]> {
    const { getConversationHistory: getHistory } = await import('./conversation-service');
    return getHistory(sessionId);
  }

  /**
   * Generate an opening message for a new campaign session
   * Uses chatWithDM with empty message to trigger first message flow
   */
  static async generateOpeningMessage(params: { context: any }): Promise<string> {
    const { chatWithDM } = await import('./narration-service');
    const response = await chatWithDM({
      message: '',
      context: params.context,
      conversationHistory: [],
    });
    if (typeof response === 'string') {
      return response;
    }
    return (response as any)?.text || (response as any)?.content || 'Welcome to your adventure!';
  }

  /**
   * Get Gemini API manager statistics (for debugging)
   */
  static async getApiStats(): Promise<any> {
    const { getApiStats: getStats } = await import('./api-manager');
    return getStats();
  }
}
