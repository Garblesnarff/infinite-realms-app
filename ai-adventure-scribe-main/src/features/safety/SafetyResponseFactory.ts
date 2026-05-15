import type { SafetyCommandResponse } from './types';

export class SafetyResponseFactory {
  static createXCardResponse(
    context: string,
    autoTriggered: boolean,
    triggerWord?: string,
  ): SafetyCommandResponse {
    return {
      isSafetyCommand: true,
      command: {
        type: 'x_card',
        triggeredBy: autoTriggered ? 'auto_detect' : 'explicit_command',
        timestamp: new Date().toISOString(),
        context,
        autoTriggered,
        triggerWord,
      },
      response: {
        text: '🚨 **X-CARD ACTIVATED** 🚨\n\nThe scene has been immediately stopped. The content will be rewound to before the uncomfortable element. We can take a break or continue in a different direction that works for everyone.\n\nYour comfort and safety are the priority. Please take care of yourself.',
        sender: 'system',
        context: {
          intent: 'safety_x_card',
          urgency: 'immediate',
          autoTriggered,
          triggerWord,
        },
      },
      shouldPause: true,
    };
  }

  static createVeilResponse(
    context: string,
    autoTriggered: boolean,
    triggerWord?: string,
  ): SafetyCommandResponse {
    return {
      isSafetyCommand: true,
      command: {
        type: 'veil',
        triggeredBy: autoTriggered ? 'auto_detect' : 'explicit_command',
        timestamp: new Date().toISOString(),
        context,
        autoTriggered,
        triggerWord,
      },
      response: {
        text: "🌫️ **VEIL ACTIVATED** 🌫️\n\nThe sensitive content has been faded or skipped. We'll acknowledge what happened off-screen and move to the aftermath or a different scene element.\n\nWe're redirecting to maintain comfort while preserving the narrative flow.",
        sender: 'system',
        context: {
          intent: 'safety_veil',
          urgency: 'moderate',
          autoTriggered,
          triggerWord,
        },
      },
    };
  }

  static createPauseResponse(): any {
    return {
      text: "⏸️ **GAME PAUSED** ⏸️\n\nThe game has been paused. Take all the time you need. Use /resume when you're ready to continue.\n\nYour comfort is important. We'll wait as long as needed.",
      sender: 'system',
      context: {
        intent: 'safety_pause',
        urgency: 'moderate',
      },
    };
  }

  static createResumeResponse(): any {
    return {
      text: "▶️ **GAME RESUMED** ▶️\n\nWelcome back! Let's continue from where we left off. If anything becomes uncomfortable, remember you can always use the safety commands.\n\nWhat would you like to do next?",
      sender: 'system',
      context: {
        intent: 'safety_resume',
      },
    };
  }

  static createDefaultResponse(): any {
    return {
      text: 'Safety command processed. Your comfort and safety are the priority.',
      sender: 'system',
      context: {
        intent: 'safety_generic',
      },
    };
  }

  static createDisabledResponse(): any {
    return {
      text: 'Safety command ignored (guardrails disabled).',
      sender: 'system',
      context: {
        intent: 'safety_disabled',
      },
    };
  }
}
