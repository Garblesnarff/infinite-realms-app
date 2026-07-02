/**
 * Keyboard shortcuts for the drawing tool: undo/redo and cancel-in-progress-drawing.
 *
 * @module hooks/drawing/use-drawing-tool-keyboard-shortcuts
 */

import { useEffect } from 'react';

export interface UseDrawingToolKeyboardShortcutsOptions {
  undo: () => void;
  redo: () => void;
  cancelDrawing: () => void;
  hasCurrentDrawing: boolean;
}

export function useDrawingToolKeyboardShortcuts({
  undo,
  redo,
  cancelDrawing,
  hasCurrentDrawing,
}: UseDrawingToolKeyboardShortcutsOptions): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Ctrl/Cmd+Z for undo
      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      }

      // Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y for redo
      if (
        ((event.ctrlKey || event.metaKey) && event.key === 'z' && event.shiftKey) ||
        ((event.ctrlKey || event.metaKey) && event.key === 'y')
      ) {
        event.preventDefault();
        redo();
      }

      // Escape to cancel current drawing
      if (event.key === 'Escape' && hasCurrentDrawing) {
        event.preventDefault();
        cancelDrawing();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, cancelDrawing, hasCurrentDrawing]);
}
