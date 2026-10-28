import type { Spell } from '../types/character';

import { fetchWithAuth } from '@/infrastructure/api/rest-client';
import logger from '@/lib/logger';

export interface CharacterSpellData extends Spell {
  is_prepared: boolean;
  source_feature: string;
}

export interface CharacterSpellsResponse {
  character: {
    id: string;
    class: string;
    level: number;
  };
  cantrips: CharacterSpellData[];
  spells: CharacterSpellData[];
  total_spells: number;
}

export interface SaveSpellsRequest {
  spells: string[];
  className: string;
  // #2710: spell ids the user prepared; server writes isPrepared per spell.
  prepared?: string[];
}

export interface SaveSpellsResponse {
  success: boolean;
  message: string;
}

class CharacterSpellService {
  private async parseError(response: Response): Promise<string> {
    const body = await response.json().catch(() => ({ error: 'Unknown error' }));
    const rawMessage =
      body?.error || body?.message || `Request failed: ${response.status} ${response.statusText}`;

    if (
      response.status === 401 &&
      typeof rawMessage === 'string' &&
      rawMessage.toLowerCase().includes('invalid token')
    ) {
      return 'Authentication expired. Please sign in again.';
    }

    return typeof rawMessage === 'string' ? rawMessage : 'Unknown error';
  }

  private async fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
    try {
      const response = await fetchWithAuth(url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers },
      });

      if (!response.ok) {
        if (response.status === 401) {
          const message = await this.parseError(response);
          // If parseError didn't return a specialized message, use a default one
          if (message.includes('401') || message === 'Unknown error') {
            throw new Error('Your session has expired. Please sign in again.');
          }
          throw new Error(message);
        }
        const message = await this.parseError(response);
        throw new Error(message);
      }

      return response;
    } catch (error) {
      logger.error('[CharacterSpellService] Authenticated request failed:', error);
      throw error;
    }
  }

  async getCharacterSpells(characterId: string): Promise<CharacterSpellsResponse> {
    try {
      const response = await this.fetchWithAuth(`/v1/characters/${characterId}/spells`);
      return response.json();
    } catch (error) {
      logger.warn(
        `[CharacterSpellService] Failed to fetch spells for character ${characterId}:`,
        error,
      );

      if (error instanceof Error && error.message.includes('Character not found')) {
        return {
          character: {
            id: characterId,
            class: 'Unknown',
            level: 1,
          },
          cantrips: [],
          spells: [],
          total_spells: 0,
        };
      }

      throw error;
    }
  }

  async saveCharacterSpells(
    characterId: string,
    request: SaveSpellsRequest,
  ): Promise<SaveSpellsResponse> {
    const response = await this.fetchWithAuth(`/v1/characters/${characterId}/spells`, {
      method: 'POST',
      body: JSON.stringify(request),
    });

    return response.json();
  }

  async deleteCharacterSpell(characterId: string, spellId: string): Promise<void> {
    await this.fetchWithAuth(`/v1/characters/${characterId}/spells/${spellId}`, {
      method: 'DELETE',
    });
  }

  async updateSpellPreparation(
    characterId: string,
    spellId: string,
    isPrepared: boolean,
  ): Promise<void> {
    await this.fetchWithAuth(`/v1/characters/${characterId}/spells/${spellId}/preparation`, {
      method: 'PATCH',
      body: JSON.stringify({ is_prepared: isPrepared }),
    });
  }
}

export const characterSpellService = new CharacterSpellService();
