import { Sword, MessageCircle, Eye, Zap, User } from 'lucide-react';
import React, { useState, useEffect, useId, useRef } from 'react';

import type { ActionOption } from '@/utils/parseMessageOptions';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import logger from '@/lib/logger';
import { cn } from '@/lib/utils';

interface ActionOptionsProps {
  options: ActionOption[];
  onOptionSelect: (option: ActionOption) => void | Promise<void>;
  resetSelectionAfterCompletion?: boolean;
  delay?: number; // Delay in milliseconds before showing options
  disabled?: boolean;
  className?: string;
  /**
   * Replaces the default "submit it immediately" line. Free-text options fill
   * the composer and wait for Send (#760). Combat chips keep the default.
   */
  instructions?: string;
  /**
   * Explicit loading signal from the caller (#118). While true, an empty options
   * array means a refresh is in flight (e.g. the legal-action re-fetch between
   * combat turns): the last options stay on screen but disabled. When false, an
   * empty array is final-empty and the controls clear immediately.
   */
  isLoading?: boolean;
}

/**
 * Get an appropriate icon for an option based on its text content
 */
function getOptionIcon(text: string): React.ComponentType<{ className?: string }> {
  const lowerText = text.toLowerCase();

  // Combat/Action keywords
  if (
    lowerText.includes('attack') ||
    lowerText.includes('fight') ||
    lowerText.includes('weapon') ||
    lowerText.includes('sword') ||
    lowerText.includes('strike')
  ) {
    return Sword;
  }

  // Social/Dialogue keywords
  if (
    lowerText.includes('speak') ||
    lowerText.includes('talk') ||
    lowerText.includes('say') ||
    lowerText.includes('ask') ||
    lowerText.includes('converse') ||
    lowerText.includes('greet')
  ) {
    return MessageCircle;
  }

  // Investigation/Observation keywords
  if (
    lowerText.includes('look') ||
    lowerText.includes('observe') ||
    lowerText.includes('examine') ||
    lowerText.includes('search') ||
    lowerText.includes('investigate') ||
    lowerText.includes('peer')
  ) {
    return Eye;
  }

  // Magic/Ability keywords
  if (
    lowerText.includes('cast') ||
    lowerText.includes('spell') ||
    lowerText.includes('magic') ||
    lowerText.includes('ability') ||
    lowerText.includes('power')
  ) {
    return Zap;
  }

  // Default to character/person icon
  return User;
}

function areOptionsEqual(a: ActionOption[], b: ActionOption[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const optA = a[i];
    const optB = b[i];
    if (
      optA.id !== optB.id ||
      optA.number !== optB.number ||
      optA.text !== optB.text ||
      optA.fullText !== optB.fullText ||
      optA.title !== optB.title ||
      optA.description !== optB.description
    ) {
      return false;
    }
  }
  return true;
}

/**
 * ActionOptions component displays clickable option buttons with a configurable delay
 * Encourages player roleplay before showing suggested actions
 */
export const ActionOptions: React.FC<ActionOptionsProps> = React.memo(
  ({
    options: incomingOptions,
    onOptionSelect,
    delay = 10000, // 10 seconds default
    disabled = false,
    resetSelectionAfterCompletion = false,
    className = '',
    isLoading = false,
    instructions,
  }) => {
    const [visible, setVisible] = useState(false);
    const [selectedOption, setSelectedOption] = useState<string | null>(null);
    const [displayedOptions, setDisplayedOptions] = useState<ActionOption[]>(incomingOptions);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const instructionsId = useId();

    const previousIncomingRef = useRef<ActionOption[]>(incomingOptions);
    const previousLoadingRef = useRef<boolean>(isLoading);

    useEffect(() => {
      const incomingChanged = !areOptionsEqual(previousIncomingRef.current, incomingOptions);
      const loadingChanged = previousLoadingRef.current !== isLoading;
      if (!incomingChanged && !loadingChanged) {
        return;
      }
      previousIncomingRef.current = incomingOptions;
      previousLoadingRef.current = isLoading;

      if (incomingOptions.length > 0) {
        // Fresh options arrived: the initial load or a completed refresh. Show them
        // immediately without re-triggering the initial delay.
        setDisplayedOptions(incomingOptions);
        setIsRefreshing(false);
        if (!visible && delay === 0) {
          setVisible(true);
        }
      } else if (isLoading && displayedOptions.length > 0) {
        // The caller signals a refresh in flight (e.g. the legal-action re-fetch
        // between combat turns): keep the last options on screen but disabled, so a
        // stale option can never submit for another turn. They clear when loading
        // ends with the array still empty.
        setIsRefreshing(true);
      } else if (!isLoading) {
        // Settled and empty: final-empty. Clear immediately — no grace period (#118).
        setDisplayedOptions([]);
        setSelectedOption(null);
        setIsRefreshing(false);
      }
    }, [incomingOptions, isLoading, visible, delay, displayedOptions.length]);

    // Show options after delay
    useEffect((): (() => void) | void => {
      if (incomingOptions.length > 0) {
        if (visible) return; // Already visible, keep visible without resetting
        let mounted = true;
        const timer = setTimeout(() => {
          if (mounted) {
            setVisible(true);
          }
        }, delay);

        return () => {
          mounted = false;
          clearTimeout(timer);
        };
      }
    }, [incomingOptions.length, delay, visible]);

    // Handle option selection
    const handleOptionClick = (option: ActionOption): void => {
      if (disabled || isRefreshing || selectedOption) return;
      logger.info('[ActionOptions] Option clicked:', option.text);
      setSelectedOption(option.id);
      const completion = onOptionSelect(option);
      if (resetSelectionAfterCompletion) {
        void Promise.resolve(completion).then(
          () => setSelectedOption(null),
          () => setSelectedOption(null),
        );
      }
    };

    const optionsToRender = displayedOptions.length > 0 ? displayedOptions : incomingOptions;

    // Don't render if no options
    if (optionsToRender.length === 0) {
      return null;
    }

    return (
      <TooltipProvider>
        <div className={`transition-all duration-500 ${className}`}>
          {/* Show loading dots before options appear */}
          {!visible && (
            <div
              className="flex items-center justify-center py-4"
              role="status"
              aria-label="Loading suggested actions"
            >
              <div className="flex items-center gap-1">
                <div className="w-1 h-1 bg-muted-foreground/40 rounded-full animate-pulse [animation-delay:-0.3s]"></div>
                <div className="w-1 h-1 bg-muted-foreground/40 rounded-full animate-pulse [animation-delay:-0.15s]"></div>
                <div className="w-1 h-1 bg-muted-foreground/40 rounded-full animate-pulse"></div>
              </div>
            </div>
          )}

          {/* Option buttons with fade-in animation */}
          {visible && (
            <div className="space-y-3 animate-in fade-in-0 duration-500">
              <div id={instructionsId} className="text-xs text-muted-foreground text-center mb-3">
                {instructions ??
                  'What would you like to do? Select an option to submit it immediately.'}
              </div>

              <div
                className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                role="group"
                aria-labelledby={instructionsId}
              >
                {optionsToRender.map((option, index) => {
                  const IconComponent = getOptionIcon(option.text);
                  const isSelected = selectedOption === option.id;
                  const isDisabled =
                    disabled || isRefreshing || (selectedOption && selectedOption !== option.id);
                  // Numbered by position: the model's own numbers can repeat or be missing (#2256).
                  const displayNumber = index + 1;

                  return (
                    <Tooltip key={`option-${index}`} delayDuration={300}>
                      <TooltipTrigger asChild>
                        <span
                          className={cn('w-full block', isDisabled ? 'cursor-not-allowed' : '')}
                        >
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleOptionClick(option)}
                            disabled={isDisabled as boolean}
                            aria-pressed={isSelected}
                            aria-label={
                              isSelected
                                ? `Selected: Option ${displayNumber} - ${option.text}`
                                : `Option ${displayNumber} - ${option.text}`
                            }
                            className={`
                            flex items-start gap-3 p-4 h-full w-full text-left justify-start whitespace-normal
                            transition-all duration-200 border rounded-xl
                            bg-white/[0.02] border-white/10 text-foreground/90
                            hover:bg-infinite-gold/[0.07] hover:border-infinite-gold/40
                            focus:ring-2 focus:ring-infinite-gold/40 focus:border-infinite-gold/60
                            animate-in fade-in-0 slide-in-from-left-4 duration-300
                            ${isSelected ? 'bg-infinite-gold/10 border-infinite-gold/70' : ''}
                            ${isDisabled ? 'opacity-50 pointer-events-none' : ''}
                          `}
                            style={{
                              animationDelay: `${index * 100}ms`,
                            }}
                          >
                            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-infinite-gold/30 bg-infinite-gold/10">
                              <IconComponent
                                className="h-4 w-4 text-infinite-gold"
                                aria-hidden="true"
                              />
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="ir-display ir-text-min font-semibold uppercase tracking-[1.5px] text-infinite-gold/80 mb-1">
                                Option {displayNumber}
                              </div>
                              {/* The full bold action name, then the description, both wrapping:
                                  never cut off with an ellipsis (#2281). */}
                              {option.title ? (
                                <>
                                  <div className="text-sm font-semibold leading-snug break-words text-foreground">
                                    {option.title}
                                  </div>
                                  {option.description && (
                                    <div className="mt-1 text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground/75">
                                      {option.description}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <div className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
                                  {option.text}
                                </div>
                              )}
                            </div>

                            {isSelected && (
                              <div className="flex-shrink-0 mt-1">
                                <div
                                  className="w-2 h-2 bg-infinite-gold rounded-full animate-pulse"
                                  aria-hidden="true"
                                ></div>
                              </div>
                            )}
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>{isSelected ? `Selected` : `Select this option`}</p>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>

              {/* Help text */}
              {!selectedOption && (
                <div className="text-xs text-muted-foreground text-center pt-2 opacity-75">
                  Or describe your own action in the chat
                </div>
              )}
            </div>
          )}
        </div>
      </TooltipProvider>
    );
  },
);
