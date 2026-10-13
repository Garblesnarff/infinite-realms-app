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
    const body = (await response.json()) as {
      error?: unknown;
      message?: unknown;
      issues?: Array<{ path?: unknown; message?: unknown }>;
    };
    if (Array.isArray(body.issues) && body.issues.length > 0) {
      const issueDetails = body.issues
        .map((issue) => {
          const path = typeof issue?.path === 'string' ? issue.path : '';
          const msg = typeof issue?.message === 'string' ? issue.message : '';
          return [path, msg].filter(Boolean).join(' ');
        })
        .filter(Boolean);
      if (issueDetails.length > 0) {
        const prefix = typeof body.error === 'string' && body.error ? `${body.error}: ` : '';
        return new Error(`${prefix}${issueDetails.join('; ')}`);
      }
    }
    if (typeof body.error === 'string' && body.error) {
      return new Error(body.error);
    }
    if (typeof body.message === 'string' && body.message) {
      return new Error(body.message);
    }
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
