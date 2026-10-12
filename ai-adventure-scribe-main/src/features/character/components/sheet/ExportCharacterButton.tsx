import { Download, Loader2 } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { exportCharacterJson } from '@/services/character-json-api';

interface ExportCharacterButtonProps {
  characterId: string;
}

export const ExportCharacterButton: React.FC<ExportCharacterButtonProps> = ({ characterId }) => {
  const { toast } = useToast();
  const [isExporting, setIsExporting] = React.useState(false);

  const handleExport = async (): Promise<void> => {
    setIsExporting(true);
    try {
      const { blob, filename } = await exportCharacterJson(characterId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast({ title: 'Character exported', description: 'Your JSON file is ready to keep.' });
    } catch (error) {
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'Could not export this character.',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => void handleExport()}
      disabled={isExporting}
    >
      {isExporting ? <Loader2 className="animate-spin" /> : <Download />}
      {isExporting ? 'Exporting…' : 'Export JSON'}
    </Button>
  );
};
