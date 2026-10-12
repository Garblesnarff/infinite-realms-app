import { Upload } from 'lucide-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  CHARACTER_EXPORT_FORMAT,
  CHARACTER_EXPORT_VERSION,
  importCharacterJson,
} from '@/services/character-json-api';

const INVALID_FILE_MESSAGE =
  'This is not a valid Infinite Realms character JSON file. Choose a file exported from a character sheet.';

function parseCharacterFile(contents: string): {
  format: typeof CHARACTER_EXPORT_FORMAT;
  version: typeof CHARACTER_EXPORT_VERSION;
  exported_at?: string;
  character: Record<string, unknown>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(INVALID_FILE_MESSAGE);
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as { format?: unknown }).format !== CHARACTER_EXPORT_FORMAT ||
    (parsed as { version?: unknown }).version !== CHARACTER_EXPORT_VERSION ||
    !(parsed as { character?: unknown }).character ||
    typeof (parsed as { character: unknown }).character !== 'object' ||
    typeof (parsed as { character: { name?: unknown } }).character.name !== 'string' ||
    !(parsed as { character: { name: string } }).character.name.trim()
  ) {
    throw new Error(INVALID_FILE_MESSAGE);
  }

  return parsed as {
    format: typeof CHARACTER_EXPORT_FORMAT;
    version: typeof CHARACTER_EXPORT_VERSION;
    exported_at?: string;
    character: Record<string, unknown>;
  };
}

export const ImportCharacterButton: React.FC = () => {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [error, setError] = React.useState<string | null>(null);
  const [isImporting, setIsImporting] = React.useState(false);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError(null);
    setIsImporting(true);
    try {
      const imported = await importCharacterJson(parseCharacterFile(await file.text()));
      if (!imported.id) throw new Error('The server did not return the imported character id.');
      toast({ title: 'Character imported', description: 'Opening your new character copy.' });
      navigate(`/app/character/${encodeURIComponent(imported.id)}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : INVALID_FILE_MESSAGE);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={isImporting}
      >
        <Upload />
        {isImporting ? 'Importing…' : 'Import character'}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        onChange={(event) => void handleFileChange(event)}
        className="sr-only"
        aria-label="Import character JSON file"
      />
      {error && (
        <p role="alert" className="max-w-xs text-center text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
};
