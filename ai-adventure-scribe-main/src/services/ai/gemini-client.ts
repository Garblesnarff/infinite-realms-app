import { GEMINI_TEXT_MODEL } from '@/config/ai';
import { getGeminiApiManager } from '@/infrastructure/ai';
import type { ChatMessage } from './shared/types';

export class GeminiClient {
  static async chat(params: {
    systemPrompt: string;
    message: string;
    conversationHistory: ChatMessage[];
    onStream?: (chunk: string) => void;
    temperature?: number;
  }): Promise<string> {
    const manager = getGeminiApiManager();

    return manager.executeWithRotation(async (genAI) => {
      const model = genAI.getGenerativeModel({ model: GEMINI_TEXT_MODEL });

      // Build conversation history
      const messages = [
        { role: 'user', parts: [{ text: params.systemPrompt }] },
        { role: 'model', parts: [{ text: "Understood! I'm ready to be your Dungeon Master." }] },
      ];

      if (params.conversationHistory) {
        params.conversationHistory.forEach((msg) => {
          messages.push({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }],
          });
        });
      }

      const chat = model.startChat({
        history: messages,
        generationConfig: {
          temperature: params.temperature ?? 0.9,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        },
      });

      if (params.onStream) {
        const result = await chat.sendMessageStream(params.message);
        let fullText = '';
        for await (const chunk of result.stream) {
          const chunkText = chunk.text();
          fullText += chunkText;
          params.onStream(chunkText);
        }
        return fullText;
      } else {
        const result = await chat.sendMessage(params.message);
        const response = await result.response;
        return response.text();
      }
    });
  }
}
