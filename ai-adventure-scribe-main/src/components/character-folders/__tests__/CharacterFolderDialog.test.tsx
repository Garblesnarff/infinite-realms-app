import { render, screen } from '@testing-library/react';
import React from 'react';
import { expect, test, vi } from 'vitest';

import { CreateFolderDialog } from '../CreateFolderDialog';
import { DeleteFolderDialog } from '../DeleteFolderDialog';
import { EditFolderDialog } from '../EditFolderDialog';

// Mock TRPC and other hooks
vi.mock('@/infrastructure/api/trpc-hooks', () => ({
  useTRPC: () => ({
    characterFolders: {
      list: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ isPending: false }) },
      update: { useMutation: () => ({ isPending: false }) },
      delete: { useMutation: () => ({ isPending: false }) },
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

test('CreateFolderDialog has accessible Cancel and Create Folder buttons with tooltips', () => {
  render(<CreateFolderDialog open={true} onOpenChange={() => {}} />);

  const cancelButton = screen.getByRole('button', { name: /cancel/i });
  expect(cancelButton).toBeDefined();

  const createButton = screen.getByRole('button', { name: /create folder/i });
  expect(createButton).toBeDefined();
  expect(createButton.getAttribute('aria-label')).toBe('Create Folder');
});

test('EditFolderDialog has accessible Cancel and Update Folder buttons with tooltips', () => {
  render(
    <EditFolderDialog
      open={true}
      onOpenChange={() => {}}
      folderId="test-folder-id"
      currentName="My Folder"
    />,
  );

  const cancelButton = screen.getByRole('button', { name: /cancel/i });
  expect(cancelButton).toBeDefined();

  const updateButton = screen.getByRole('button', { name: /update folder/i });
  expect(updateButton).toBeDefined();
  expect(updateButton.getAttribute('aria-label')).toBe('Update Folder - My Folder');
});

test('DeleteFolderDialog has accessible Cancel and Delete Folder buttons with WCAG-compliant attributes', () => {
  render(
    <DeleteFolderDialog
      open={true}
      onOpenChange={() => {}}
      folderId="test-folder-id"
      folderName="NPCs"
    />,
  );

  const cancelButton = screen.getByRole('button', { name: /cancel/i });
  expect(cancelButton).toBeDefined();

  const deleteButton = screen.getByRole('button', { name: /delete folder/i });
  expect(deleteButton).toBeDefined();
  expect(deleteButton.getAttribute('aria-label')).toBe('Delete Folder - Confirm deleting NPCs folder');
});
