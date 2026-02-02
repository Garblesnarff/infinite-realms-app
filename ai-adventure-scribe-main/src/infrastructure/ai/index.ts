/**
 * AI Infrastructure Layer - Public API
 *
 * This module provides centralized access to AI service clients:
 * - OpenAI (embeddings)
 * - ElevenLabs (text-to-speech)
 *
 * Text generation is handled via llmApiClient (server-proxied).
 *
 * @module infrastructure/ai
 */

// Export OpenAI client
export { OpenAIClient, openaiClient } from './openai-client';

// Export ElevenLabs client
export { ElevenLabsClient, elevenlabsClient } from './elevenlabs-client';

// Export types
export type {
  AIGenerationParams,
  AIProvider,
  RateLimitStats,
  ApiKeyConfig,
  VoiceSettings,
  TTSRequest,
  EmbeddingResponse,
} from './types';
