import { render, screen } from '@testing-library/react';
import React from 'react';
import { expect, test, vi } from 'vitest';

import { CreateFolderDialog } from '../CreateFolderDialog';
import { EditFolderDialog } from '../EditFolderDialog';

// Mock TRPC and other hooks
vi.mock('@/infrastructure/api/trpc-hooks', () => ({
  useTRPC: () => ({
    characterFolders: {
      list: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ isPending: false }) },
      update: { useMutation: () => ({ isPending: false }) },
    },
  }),
  useTRPCUtils: () => ({
    characterFolders: { list: { invalidate: vi.fn() } },
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

test('CreateFolderDialog has accessible color buttons with keyboard focus rings', () => {
  render(<CreateFolderDialog open={true} onOpenChange={() => {}} />);

  // Find the color picker group
  const group = screen.getByRole('group', { name: /folder color/i });
  expect(group).toBeDefined();

  // Check that color buttons have aria-label and aria-pressed
  const purpleButton = screen.getByLabelText('Purple');
  expect(purpleButton).toBeDefined();
  expect(purpleButton.getAttribute('aria-pressed')).toBe('true'); // Purple is default
  expect(purpleButton.className).toContain('focus-visible:ring-2');
  expect(purpleButton.className).toContain('focus-visible:ring-infinite-purple');
  expect(purpleButton.className).toContain('outline-none');

  const goldButton = screen.getByLabelText('Gold');
  expect(goldButton.getAttribute('aria-pressed')).toBe('false');
  expect(goldButton.className).toContain('focus-visible:ring-2');
  expect(goldButton.className).toContain('focus-visible:ring-infinite-purple');
  expect(goldButton.className).toContain('outline-none');
});

test('EditFolderDialog has accessible color buttons with keyboard focus rings', () => {
  render(
    <EditFolderDialog
      open={true}
      onOpenChange={() => {}}
      folderId="test-folder-id"
      currentName="My Folder"
    />,
  );

  // Find the color picker group
  const group = screen.getByRole('group', { name: /folder color/i });
  expect(group).toBeDefined();

  // Check that color buttons have focus visible rings
  const purpleButton = screen.getByLabelText('Purple');
  expect(purpleButton).toBeDefined();
  expect(purpleButton.className).toContain('focus-visible:ring-2');
  expect(purpleButton.className).toContain('focus-visible:ring-infinite-purple');
  expect(purpleButton.className).toContain('outline-none');

  const goldButton = screen.getByLabelText('Gold');
  expect(goldButton.className).toContain('focus-visible:ring-2');
  expect(goldButton.className).toContain('focus-visible:ring-infinite-purple');
  expect(goldButton.className).toContain('outline-none');
});

test('CreateFolderDialog links parent folder label to select trigger', () => {
  render(<CreateFolderDialog open={true} onOpenChange={() => {}} />);

  const label = screen.getByText(/parent folder/i);
  // Using role and checking name because aria-label was removed in favor of direct association
  const selectTrigger = screen.getByRole('combobox', { name: /parent folder/i });

  expect(label.getAttribute('for')).toBe(selectTrigger.getAttribute('id'));
});
