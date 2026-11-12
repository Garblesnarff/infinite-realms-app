import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImportCharacterButton } from '../ImportCharacterButton';

const importCharacterJson = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), useNavigate: () => vi.fn() };
});
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/services/character-json-api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, importCharacterJson };
});

const exportFile = (): File =>
  // jsdom's File has no text(); the component reads the file through it.
  ({
    name: 'ada.json',
    text: async () =>
      JSON.stringify({
        format: 'infinite-realms.character',
        version: 1,
        character: { name: 'Ada' },
      }),
  }) as unknown as File;

const chooseFile = (container: HTMLElement) => {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [exportFile()] } });
};

describe('Import character shows the Legend gate on LEGEND_REQUIRED (#1344)', () => {
  it('replaces the import control with the existing Legend gate', async () => {
    importCharacterJson.mockRejectedValueOnce(
      Object.assign(new Error('Creating your own hero is a Legend feature'), {
        code: 'LEGEND_REQUIRED',
      }),
    );
    const { container } = render(<ImportCharacterButton />);
    chooseFile(container);
    expect(
      await screen.findByRole('heading', { name: 'Creating your own hero is a Legend feature' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade to Legend' })).toBeInTheDocument();
  });

  it('still shows a plain error for any other refusal', async () => {
    importCharacterJson.mockRejectedValueOnce(new Error('Request failed (500)'));
    const { container } = render(<ImportCharacterButton />);
    chooseFile(container);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Request failed (500)'),
    );
    expect(screen.queryByRole('heading', { name: /Legend feature/ })).toBeNull();
  });
});
