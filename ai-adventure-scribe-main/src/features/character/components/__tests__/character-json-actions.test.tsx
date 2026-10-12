import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CharacterListHeroHeader } from '../list/CharacterListHeroHeader';
import { CharacterSheetHeader } from '../sheet/CharacterSheetHeader';

const mockToast = vi.fn();

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast, toasts: [], dismiss: vi.fn() }),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { deleteCharacter: vi.fn() },
}));

const sheetCharacter = (): Record<string, unknown> => ({
  id: 'char-scholar-copy-1',
  name: 'The Scholar',
  level: 1,
  race: { name: 'Human' },
  class: { name: 'Wizard' },
  character_stats: [{ max_hit_points: 8, current_hit_points: 8, armor_class: 12 }],
});

const LocationProbe = (): JSX.Element => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

function makeFile(contents: string): File {
  const file = new File([contents], 'character.json', { type: 'application/json' });
  if (!file.text) {
    Object.defineProperty(file, 'text', { value: async () => contents });
  }
  return file;
}

describe('character JSON actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:character-export'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('exports the real route response from the character sheet', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          format: 'infinite-realms.character',
          version: 1,
          exported_at: '2026-10-11T12:00:00.000Z',
          character: { name: 'The Scholar', stats: { intelligence: 16 }, inventory_items: [] },
        }),
        {
          status: 200,
          headers: { 'content-disposition': 'attachment; filename="character-char-sch.json"' },
        },
      ),
    );

    render(
      <MemoryRouter>
        <CharacterSheetHeader character={sheetCharacter() as never} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8888/v1/characters/char-scholar-copy-1/export',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(click.mock.instances[0]).toHaveProperty('download', 'character-char-sch.json');
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Character exported' }),
    );
  });

  it('imports the route envelope and opens the new character copy', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 'char-imported-2', name: 'Imported Hero' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(
      <MemoryRouter initialEntries={['/app/characters']}>
        <Routes>
          <Route
            path="/app/characters"
            element={
              <>
                <CharacterListHeroHeader onCreateNew={vi.fn()} />
                <LocationProbe />
              </>
            }
          />
          <Route path="/app/character/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Import character JSON file'), {
      target: {
        files: [
          makeFile(
            JSON.stringify({
              format: 'infinite-realms.character',
              version: 1,
              exported_at: '2026-10-11T12:00:00.000Z',
              character: { name: 'Imported Hero', level: 3 },
            }),
          ),
        ],
      },
    });

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/app/character/char-imported-2'),
    );
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8888/v1/characters/import',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"format":"infinite-realms.character"'),
      }),
    );
  });

  it('shows a clear error and does not call the route for a bad file', async () => {
    render(
      <MemoryRouter>
        <CharacterListHeroHeader onCreateNew={vi.fn()} />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Import character JSON file'), {
      target: { files: [makeFile('{not json')] },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This is not a valid Infinite Realms character JSON file',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
