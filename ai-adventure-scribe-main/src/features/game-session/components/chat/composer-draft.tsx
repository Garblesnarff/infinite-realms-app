import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * The text an option click places in the composer (#760).
 * A new id on every stage so a second click replaces the text even when the words match.
 */
interface ComposerDraft {
  id: number;
  text: string;
}

interface ComposerDraftApi {
  draft: ComposerDraft | null;
  stage: (text: string) => void;
  clear: () => void;
}

const ComposerDraftContext = createContext<ComposerDraftApi | null>(null);

/**
 * Shares one composer draft between the option buttons and the chat box (#760).
 * An option click stages text here. Send and Enter are what submit it.
 */
export function ComposerDraftProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [draft, setDraft] = useState<ComposerDraft | null>(null);
  const stage = useCallback((text: string) => {
    setDraft((current) => ({ id: (current?.id ?? 0) + 1, text }));
  }, []);
  const clear = useCallback(() => {
    setDraft(null);
  }, []);
  const value = useMemo(() => ({ draft, stage, clear }), [draft, stage, clear]);
  return <ComposerDraftContext.Provider value={value}>{children}</ComposerDraftContext.Provider>;
}

export function useComposerDraft(): ComposerDraft | null {
  return useContext(ComposerDraftContext)?.draft ?? null;
}

/**
 * Null when this tree has no composer. Callers then keep their previous send.
 */
export function useStageComposerDraft(): ((text: string) => void) | null {
  return useContext(ComposerDraftContext)?.stage ?? null;
}

/** Null when this tree has no composer. */
export function useClearComposerDraft(): (() => void) | null {
  return useContext(ComposerDraftContext)?.clear ?? null;
}
