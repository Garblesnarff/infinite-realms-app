import React, { useMemo } from 'react';

import { DMBubbleVoiceSection } from './DMBubbleVoiceSection';
import { formatNarrative } from '../message-list/formatNarrative';

import type { NarrationSegment } from '@/hooks/use-ai-response';
import type { ChatMessage } from '@/services/ai-service';

import { ActionOptions } from '@/components/game/ActionOptions';
import { TooltipProvider } from '@/components/ui/tooltip';
import { convertNarrationToAISegments } from '@/features/game-session/components/audio/voice-utils';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { useProgressiveVoice } from '@/hooks/use-progressive-voice';
import logger from '@/lib/logger';
import { DiceEngine } from '@/services/dice/DiceEngine';
import {
  parseMessageOptions,
  extractNarrativeContent,
  createPlayerMessageFromOption,
} from '@/utils/parseMessageOptions';

interface DMChatBubbleProps {
  message: ChatMessage;
  narrationSegments?: NarrationSegment[];
  onOptionSelect?: (optionText: string) => void;
}

export const DMChatBubble: React.FC<DMChatBubbleProps> = React.memo(
  ({ message, narrationSegments, onOptionSelect }) => {
    // Parse message content to separate narrative from options
    const parsedMessage = useMemo(() => {
      return parseMessageOptions(message.content);
    }, [message.content]);

    // Parse dice expressions from the message content
    const diceExpressions = useMemo(() => {
      return DiceEngine.findDiceExpressions(message.content);
    }, [message.content]);

    // Render message content with deduplication via formatNarrative
    const renderMessageContent = useMemo(() => {
      const content = parsedMessage.content || message.content;

      // Apply formatNarrative for deduplication and proper paragraph handling
      const { content: formattedContent } = formatNarrative(content);

      // If we have dice expressions, we need to handle them specially
      // For now, prioritize deduplication - dice embeds can be added later if needed
      if (diceExpressions.length > 0) {
        logger.debug('Dice expressions detected but using formatNarrative for deduplication');
      }

      return <div className="text-sm leading-relaxed mb-3">{formattedContent}</div>;
    }, [parsedMessage.content, message.content, diceExpressions]);
    const {
      segments,
      currentSegmentIndex,
      isPlaying,
      isProcessing,
      volume: _volume,
      isMuted,
      isVoiceEnabled,
      error,
      speakAISegments,
      speakPlainText,
      stopPlayback,
      toggleMute,
      initializeAudioContext,
    } = useProgressiveVoice();

    const [hasUserInteracted, setHasUserInteracted] = useLocalStorage<boolean>(
      'progressive-voice-user-interacted',
      false,
    );

    // Handle option selection
    const handleOptionSelect = React.useCallback(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (option: any) => {
        if (onOptionSelect) {
          const playerMessage = createPlayerMessageFromOption(option);
          onOptionSelect(playerMessage);
        }
      },
      [onOptionSelect],
    );

    // Check if this message is currently playing
    const isThisMessagePlaying = React.useMemo(() => {
      if (!isPlaying || segments.length === 0) return false;
      // Simple check: if we have segments and one is playing, assume it's this message
      // In a more complex system, we'd track which message's segments are active
      return segments.some((segment) => segment.isPlaying);
    }, [isPlaying, segments]);

    const handlePlayPause = React.useCallback(() => {
      // Initialize audio context during user interaction
      initializeAudioContext();

      // Mark that user has interacted
      if (!hasUserInteracted) {
        setHasUserInteracted(true);
      }

      if (isThisMessagePlaying) {
        stopPlayback();
      } else if (!isProcessing) {
        logger.info('🎵 Playing message:', message.id);

        if (narrationSegments && narrationSegments.length > 0) {
          logger.debug('🎭 Using AI segments for message playback');
          const aiSegments = convertNarrationToAISegments(narrationSegments);
          speakAISegments(aiSegments);
        } else {
          logger.debug('📝 Using plain text fallback for message playback');
          // Use only narrative content for TTS (exclude options)
          const narrativeContent = extractNarrativeContent(message.content);
          speakPlainText(narrativeContent);
        }
      }
    }, [
      isThisMessagePlaying,
      isProcessing,
      stopPlayback,
      speakAISegments,
      speakPlainText,
      message.content,
      message.id,
      narrationSegments,
      hasUserInteracted,
      setHasUserInteracted,
      initializeAudioContext,
    ]);

    return (
      <div className="flex justify-start animate-in slide-in-from-left-2 duration-500">
        <TooltipProvider>
          <div className="flex max-w-[85%] flex-row items-start">
            {/* Enhanced DM Avatar */}
            <div className="flex-shrink-0 mr-4 relative" aria-label="Dungeon Master">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold bg-gradient-to-br from-infinite-purple to-infinite-teal text-white shadow-lg border-2 border-white/20 hover-glow transition-all duration-300"
                aria-hidden="true"
              >
                <span className="text-xs">🎭</span>
              </div>
              <div
                className="absolute -bottom-1 -right-1 w-4 h-4 bg-infinite-gold rounded-full flex items-center justify-center border-2 border-background"
                aria-label="DM Badge"
              >
                <span className="text-[8px] font-bold text-infinite-dark" aria-hidden="true">
                  DM
                </span>
              </div>
            </div>

            {/* Enhanced Message Bubble */}
            <div className="flex flex-col items-start space-y-3">
              <div
                className={`relative px-6 py-4 rounded-2xl transition-all duration-300 glass-strong shadow-lg hover:shadow-xl ${
                  isThisMessagePlaying
                    ? 'ring-2 ring-infinite-purple/70 shadow-2xl bg-gradient-to-br from-card/90 to-card/60 backdrop-blur-xl'
                    : 'hover:bg-card/80'
                }`}
              >
                {/* Speech Bubble Tail */}
                <div className="absolute left-[-8px] top-6 w-0 h-0 border-t-8 border-t-transparent border-b-8 border-b-transparent border-r-8 border-r-card/90"></div>
                <div className="absolute left-[-6px] top-6 w-0 h-0 border-t-8 border-t-transparent border-b-8 border-b-transparent border-r-8 border-r-card"></div>
                {/* Enhanced Message Content */}
                <div className="text-narrative text-foreground-secondary">
                  {renderMessageContent}
                </div>

                <DMBubbleVoiceSection
                  isVoiceEnabled={isVoiceEnabled}
                  isProcessing={isProcessing}
                  isThisMessagePlaying={isThisMessagePlaying}
                  isMuted={isMuted}
                  error={error}
                  hasUserInteracted={hasUserInteracted}
                  segments={segments}
                  currentSegmentIndex={currentSegmentIndex}
                  handlePlayPause={handlePlayPause}
                  toggleMute={toggleMute}
                />
              </div>

              {/* Enhanced Action Options */}
              {parsedMessage.hasOptions && (
                <div className="w-full animate-in slide-in-from-bottom-2 duration-500">
                  <ActionOptions
                    options={parsedMessage.options}
                    onOptionSelect={handleOptionSelect}
                    delay={10000} // 10 second delay
                  />
                </div>
              )}

              {/* Enhanced Timestamp */}
              <div
                className="text-xs text-muted-foreground/60 px-2 font-mono bg-card/30 rounded px-2 py-1"
                aria-label={
                  message.timestamp
                    ? `Sent at ${new Date(message.timestamp).toLocaleTimeString()}`
                    : undefined
                }
              >
                {message.timestamp
                  ? new Date(message.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : ''}
              </div>
            </div>
          </div>
        </TooltipProvider>
      </div>
    );
  },
);
