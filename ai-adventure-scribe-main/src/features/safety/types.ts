import type { ChatMessage } from '@/types/game';

export interface SafetyCommand {
  type: 'x_card' | 'veil' | 'pause' | 'resume';
  triggeredBy: string;
  timestamp: string;
  context?: string;
  autoTriggered?: boolean;
  triggerWord?: string;
}

export interface SessionConfig {
  x_card_enabled: boolean;
  veil_enabled: boolean;
  pause_enabled: boolean;
  auto_pause_on_trigger: boolean;
  custom_x_card_triggers: string[];
  custom_veil_triggers: string[];
  custom_pause_triggers: string[];
  strict_mode_triggers: boolean;
  content_warnings: string[];
  hard_boundaries: string[];
  comfort_level: 'pg' | 'pg13' | 'r' | 'custom';
  [key: string]: any;
}

export interface TriggerWords {
  x_card: string[];
  veil: string[];
  pause: string[];
}

export interface SafetyCommandResponse {
  isSafetyCommand: boolean;
  command?: SafetyCommand;
  response?: ChatMessage;
  shouldPause?: boolean;
  shouldResume?: boolean;
  shouldProcessNormal?: boolean;
}

// Safety trigger words based on the implementation plan
export const SAFETY_TRIGGER_WORDS = {
  x_card: [
    'stop',
    'blood',
    'gore',
    'violence',
    'torture',
    'abuse',
    'trauma',
    'assault',
    'horrible',
    'uncomfortable',
    'trigger',
  ],
  veil: ['suggestive', 'sexual', 'intimate', 'private', 'personal', 'nsfw', 'explicit', 'mature'],
  pause: ['break', 'pause', 'slow down', 'too much', 'overwhelmed'],
};
