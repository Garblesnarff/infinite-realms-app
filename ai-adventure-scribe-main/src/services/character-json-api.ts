import { fetchWithAuth } from '@/infrastructure/api/rest-client';

export const CHARACTER_EXPORT_FORMAT = 'infinite-realms.character';
export const CHARACTER_EXPORT_VERSION = 1;

export interface CharacterExportFile {
  format: typeof CHARACTER_EXPORT_FORMAT;
  version: typeof CHARACTER_EXPORT_VERSION;
  exported_at?: string;
  character: Record<string, unknown>;
}

export interface ImportedCharacterResponse {
  id: string;
  name?: string;
}

async function responseError(response: Response): Promise<Error> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error) return new Error(body.error);
  } catch {
    // Use the status below when the server did not return JSON.
  }
  return new Error(`Request failed (${response.status})`);
}

export async function exportCharacterJson(characterId: string): Promise<{
  blob: Blob;
  filename: string;
}> {
  const response = await fetchWithAuth(`/v1/characters/${encodeURIComponent(characterId)}/export`);
  if (!response.ok) throw await responseError(response);

  const disposition = response.headers.get('content-disposition');
  const filename = disposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? 'character.json';
  return { blob: await response.blob(), filename };
}

export async function importCharacterJson(
  file: CharacterExportFile,
): Promise<ImportedCharacterResponse> {
  const response = await fetchWithAuth('/v1/characters/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(file),
  });
  if (!response.ok) throw await responseError(response);
  return (await response.json()) as ImportedCharacterResponse;
}
