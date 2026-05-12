import { useState, useEffect, useRef, useCallback } from 'react';

import { useLocalStorage } from '@/hooks/use-local-storage';

export type GameSidePanelState = {
  isExpanded: boolean;
  activeTab: 'character' | 'memory' | 'combat';
  panelWidth: string;
};

/**
 * usePanelResize Hook
 * Extracted from MemoryPanel.tsx
 * Handles panel resizing, state persistence, and tab management
 */
export const usePanelResize = (): {
  isExpanded: boolean;
  setIsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  activeTab: 'character' | 'memory' | 'combat';
  setActiveTab: React.Dispatch<React.SetStateAction<'character' | 'memory' | 'combat'>>;
  panelWidth: string;
  panelRef: React.RefObject<HTMLDivElement>;
  dragHandleRef: React.RefObject<HTMLDivElement>;
  isDraggingRef: React.MutableRefObject<boolean>;
  startDrag: (e: React.MouseEvent) => void;
  handleDrag: (e: MouseEvent) => void;
  stopDrag: () => void;
} => {
  // Persistent state using type-safe localStorage hook
  const [panelState, setPanelState] = useLocalStorage<GameSidePanelState>('gameSidePanelState', {
    isExpanded: true,
    activeTab: 'character',
    panelWidth: '340px',
  });

  // Local state initialized from persistent state
  const [isExpanded, setIsExpanded] = useState(panelState.isExpanded);
  const [activeTab, setActiveTab] = useState<'character' | 'memory' | 'combat'>(
    panelState.activeTab,
  );
  const [panelWidth, setPanelWidth] = useState(panelState.panelWidth);

  // Refs for resizable functionality
  const panelRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Sync panel width with ref on mount
  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.style.width = panelWidth;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save state to localStorage on changes
  useEffect(() => {
    setPanelState((previousState) => {
      if (
        previousState?.isExpanded === isExpanded &&
        previousState?.activeTab === activeTab &&
        previousState?.panelWidth === panelWidth
      ) {
        return previousState;
      }

      return {
        isExpanded,
        activeTab,
        panelWidth,
      };
    });
  }, [isExpanded, activeTab, panelWidth, setPanelState]);

  // Resizable drag functionality
  const handleDrag = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current || !panelRef.current) {
      return;
    }

    const containerRect = panelRef.current.parentElement?.getBoundingClientRect();
    if (!containerRect) {
      return;
    }

    let newWidth = e.clientX - containerRect.left;
    // Enforce new constraints 280-400px
    newWidth = Math.max(280, Math.min(400, newWidth));

    setPanelWidth(`${newWidth}px`);
    panelRef.current.style.width = `${newWidth}px`;
  }, []);

  const stopDrag = useCallback(() => {
    isDraggingRef.current = false;
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('mouseup', stopDrag);
  }, [handleDrag]);

  const startDrag = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true;
    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', stopDrag);
    e.preventDefault();
  }, [handleDrag, stopDrag]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleDrag);
      document.removeEventListener('mouseup', stopDrag);
    };
  }, [handleDrag, stopDrag]);

  return {
    isExpanded,
    setIsExpanded,
    activeTab,
    setActiveTab,
    panelWidth,
    panelRef,
    dragHandleRef,
    isDraggingRef,
    startDrag,
    handleDrag,
    stopDrag,
  };
};
