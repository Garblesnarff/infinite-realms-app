import { render, screen } from '@testing-library/react';
import React from 'react';
import { expect, test, vi } from 'vitest';

import { MoveCharactersDialog } from '../MoveCharactersDialog';

// Mock TRPC and other hooks
vi.mock('@/infrastructure/api/trpc-hooks', () => ({
  useTRPC: () => ({
    characterFolders: {
      list: { useQuery: () => ({ data: [{ id: 'folder-1', name: 'Magic Folder' }] }) },
      moveCharacter: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: vi.fn(),
        }),
      },
    },
    characters: {
      list: { invalidate: vi.fn() },
    },
  }),
  useTRPCUtils: () => ({
    characterFolders: { list: { invalidate: vi.fn() } },
    characters: { list: { invalidate: vi.fn() } },
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

test('MoveCharactersDialog renders dialog components and has correct accessible attributes', () => {
  render(
    <MoveCharactersDialog
      open={true}
      onOpenChange={() => {}}
      characterIds={['char-1', 'char-2']}
    />,
  );

  // Assert Title and Description are rendered correctly with the plural suffix
  expect(screen.getByRole('heading', { name: 'Move Characters', level: 2 })).toBeDefined();
  expect(screen.getByText(/Select a destination folder for 2 characters\./)).toBeDefined();

  // Find Select and label association
  const selectLabel = screen.getByText('Destination Folder');
  const selectTrigger = screen.getByRole('combobox', { name: /destination folder/i });
  expect(selectLabel.getAttribute('for')).toBe(selectTrigger.getAttribute('id'));
});

test('MoveCharactersDialog renders cancel and move action buttons with tooltips', async () => {
  render(
    <MoveCharactersDialog
      open={true}
      onOpenChange={() => {}}
      characterIds={['char-1']}
    />,
  );

  // Check the Cancel button
  const cancelButton = screen.getByRole('button', { name: /cancel/i });
  expect(cancelButton).toBeDefined();

  // Check the Move button with specific singular context aria-label
  const moveButton = screen.getByRole('button', {
    name: 'Move 1 character to destination folder',
  });
  expect(moveButton).toBeDefined();
  expect(moveButton.getAttribute('aria-label')).toBe('Move 1 character to destination folder');
});
