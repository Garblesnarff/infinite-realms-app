import React from 'react';

import type { ExtendedGameSession, SessionStateUpdater } from '../../../types/session';
import type { ChatMessage } from '@/types/game';

import { useCharacter } from '@/contexts/CharacterContext';
import { useMemoryContext } from '@/contexts/MemoryContext';
import { useMessageContext } from '@/contexts/MessageContext';
import { useAIResponse } from '@/hooks/use-ai-response';
import logger from '@/lib/logger';
import { parseDiceCommand } from '@/utils/diceCommandParser';
import { rollDice } from '@/utils/diceUtils';
import { handleAsyncError } from '@/utils/error-handler';
import { checkSafetyCommands, processSafetyCommand } from '@/utils/safetyCommands';

interface UseMessageCommandHandlerProps {
  sessionId: string;
  updateGameSessionState: (newStateOrUpdater: SessionStateUpdater) => Promise<void>;
  onAIResponse?: (message: ChatMessage) => Promise<void>;
}

export const useMessageCommandHandler = ({
  sessionId,
  updateGameSessionState,
  onAIResponse,
}: UseMessageCommandHandlerProps) => {
  const { sendMessage, messages } = useMessageContext();
  const { extractMemories } = useMemoryContext();
  const { getAIResponse } = useAIResponse();
  const { state: characterState } = useCharacter();
  const character = characterState.character;

  const messagesRef = React.useRef(messages);
  React.useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const handleSafetyCommand = async (
    playerInput: string,
    aiResponseText?: string,
  ): Promise<{ isSafetyCommand: boolean }> => {
    const safetyCheck = await checkSafetyCommands(playerInput, sessionId, aiResponseText);

    if (safetyCheck.isSafetyCommand && safetyCheck.command) {
      logger.info(
        `🛡️ [Safety] ${aiResponseText ? 'Auto-triggered' : 'Manual'} safety command detected:`,
        safetyCheck.command,
      );

      // Current session state for safety command processor
      const currentSessionState = { is_paused: false }; // Simplified for now

      // Send safety command response
      let safetyResponse: ChatMessage;
      if (safetyCheck.response) {
        safetyResponse = safetyCheck.response;
        await sendMessage(safetyResponse);
      } else {
        safetyResponse = await processSafetyCommand(
          safetyCheck.command,
          sessionId,
          playerInput,
          aiResponseText,
          currentSessionState,
        );
        await sendMessage(safetyResponse);
      }

      // Store safety event in memory
      await extractMemories(
        `${aiResponseText ? 'Auto-triggered safety' : 'Safety'} command ${safetyCheck.command.type} activated: ${safetyCheck.command.context}`,
        {
          importance: aiResponseText ? 8 : 9,
          tags: [
            'safety',
            safetyCheck.command.type,
            safetyCheck.command.autoTriggered ? 'auto-triggered' : 'manual',
            ...(aiResponseText ? ['ai-response'] : []),
          ],
          type: 'game_event',
          context_id: sessionId,
        },
      );

      // Handle pause/resume state changes
      if (safetyCheck.shouldPause) {
        await updateGameSessionState((prev: ExtendedGameSession) => ({
          ...prev,
          is_paused: true,
        }));
      } else if (safetyCheck.shouldResume) {
        await updateGameSessionState((prev: ExtendedGameSession) => ({
          ...prev,
          is_paused: false,
        }));
      }

      return { isSafetyCommand: true };
    }

    return { isSafetyCommand: false };
  };

  const handleDiceCommand = async (playerInput: string): Promise<{ isDiceCommand: boolean }> => {
    const diceCommand = parseDiceCommand(playerInput);
    if (!diceCommand) {
      return { isDiceCommand: false };
    }

    if (!diceCommand.isValid) {
      const errorMessage: ChatMessage = {
        text: diceCommand.error || 'Invalid dice command',
        sender: 'system',
        context: { intent: 'dice_command_error' },
      };
      await sendMessage(errorMessage);
      return { isDiceCommand: true };
    }

    try {
      const rollResult = rollDice(diceCommand.dieType, diceCommand.count, diceCommand.modifier, {
        advantage: diceCommand.advantage,
        disadvantage: diceCommand.disadvantage,
      });

      const diceRollMessage: ChatMessage = {
        text: `Rolled ${diceCommand.formula}${diceCommand.label ? ` for ${diceCommand.label}` : ''}`,
        sender: 'player',
        characterName: character?.name,
        characterAvatar: character?.avatar_url,
        context: {
          intent: 'dice_roll',
          diceRoll: {
            formula: diceCommand.formula,
            count: diceCommand.count,
            dieType: diceCommand.dieType,
            modifier: diceCommand.modifier,
            advantage: diceCommand.advantage,
            disadvantage: diceCommand.disadvantage,
            results: rollResult.results,
            keptResults: rollResult.keptResults,
            total: rollResult.total,
            naturalRoll: rollResult.naturalRoll,
            critical: rollResult.critical,
            label: diceCommand.label,
            timestamp: new Date().toISOString(),
          },
        },
      };

      await sendMessage(diceRollMessage);

      const aiResponseMessage = await getAIResponse(
        [...messagesRef.current, diceRollMessage],
        sessionId,
      );

      await sendMessage(aiResponseMessage);

      if (onAIResponse) {
        try {
          await onAIResponse(aiResponseMessage);
        } catch (combatError) {
          handleAsyncError(combatError, {
            userMessage: 'Failed to process combat response after dice roll',
            logLevel: 'warn',
            showToast: false,
            context: { location: 'MessageHandler.diceRoll.combatDetection' },
          });
        }
      }

      return { isDiceCommand: true };
    } catch (rollError) {
      handleAsyncError(rollError, {
        userMessage: 'Failed to execute dice roll',
        context: { location: 'MessageHandler.diceCommand', command: playerInput },
      });
      const errorMessage: ChatMessage = {
        text: 'Failed to execute dice roll. Please try again.',
        sender: 'system',
        context: { intent: 'dice_roll_error' },
      };
      await sendMessage(errorMessage);
      return { isDiceCommand: true };
    }
  };

  return {
    handleSafetyCommand,
    handleDiceCommand,
  };
};
