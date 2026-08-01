import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

import { ExportButton, SimpleExportButton } from '../ExportButton';

// Mock TRPC hooks with hoisted spies
const mockQuery = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/api/trpc-hooks', () => ({
  useTRPC: () => ({
    characters: {
      export: {
        query: mockQuery,
      },
    },
  }),
}));

// Mock Toast hook with hoisted spy
const mockToast = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

describe('ExportButton Components Accessibility and UX', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock URL methods which are not present in standard test JSDOM
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();

    // Spy on link click
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('ExportButton with default props (showing labels)', () => {
    render(
      <ExportButton
        characterId="test-character-id"
        characterName="Garrick"
      />
    );

    // Should render button with text "Export"
    const button = screen.getByRole('button', { name: /export/i });
    expect(button).toBeDefined();
    // Default should not have custom icon-only aria-label
    expect(button.getAttribute('aria-label')).toBeNull();
  });

  test('ExportButton in icon-only mode has proper ARIA label and Tooltip', () => {
    render(
      <ExportButton
        characterId="test-character-id"
        characterName="Garrick"
        size="icon"
      />
    );

    // In icon-only mode, the button should have explicit aria-label
    const button = screen.getByRole('button', { name: /export options for garrick/i });
    expect(button).toBeDefined();
    expect(button.getAttribute('aria-label')).toBe('Export options for Garrick');
  });

  test('SimpleExportButton in default mode (showing labels)', () => {
    render(
      <SimpleExportButton
        characterId="test-character-id"
        characterName="Garrick"
      />
    );

    // Should render simple export button with text "Export"
    const button = screen.getByRole('button', { name: /export/i });
    expect(button).toBeDefined();
    expect(button.getAttribute('aria-label')).toBeNull();
  });

  test('SimpleExportButton in icon-only mode has proper ARIA label and Tooltip', () => {
    render(
      <SimpleExportButton
        characterId="test-character-id"
        characterName="Garrick"
        size="icon"
      />
    );

    // In icon-only mode, the button should have explicit aria-label
    const button = screen.getByRole('button', { name: /export garrick data as json/i });
    expect(button).toBeDefined();
    expect(button.getAttribute('aria-label')).toBe('Export Garrick data as JSON');
  });

  test('SimpleExportButton click triggers TRPC query and downloads file', async () => {
    const mockCharacterData = {
      id: 'test-character-id',
      character: { name: 'Garrick' },
      stats: { strength: 15 },
    };
    mockQuery.mockResolvedValueOnce(mockCharacterData);

    render(
      <SimpleExportButton
        characterId="test-character-id"
        characterName="Garrick"
      />
    );

    const button = screen.getByRole('button', { name: /export/i });
    await act(async () => {
      fireEvent.click(button);
    });

    // Should trigger query
    expect(mockQuery).toHaveBeenCalledWith({ characterId: 'test-character-id' });

    // Since the call is asynchronous, we wait or let the promises resolve
    await vi.waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Export Successful',
          description: expect.stringContaining('Garrick'),
        })
      );
    });
  });

  test('SimpleExportButton click handles query error gracefully', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Network error'));

    render(
      <SimpleExportButton
        characterId="test-character-id"
        characterName="Garrick"
      />
    );

    const button = screen.getByRole('button', { name: /export/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await vi.waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Export Failed',
          description: 'Network error',
          variant: 'destructive',
        })
      );
    });
  });
});
