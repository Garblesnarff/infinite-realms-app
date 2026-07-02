import { Plus } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';

interface CharacterListHeroHeaderProps {
  onCreateNew: () => void;
  disabled?: boolean;
}

export const CharacterListHeroHeader: React.FC<CharacterListHeroHeaderProps> = ({
  onCreateNew,
  disabled = false,
}) => (
  <div
    className="relative bg-cover bg-no-repeat py-24 px-4"
    style={{
      backgroundImage: "url('/character_page_hero_header.png')",
      backgroundPosition: '50% 36%',
    }}
  >
    <div className="absolute inset-0 bg-black/20"></div>
    <div className="relative max-w-7xl mx-auto text-center">
      <div className="mb-10 md:mb-14 h-24 md:h-28"></div>
      <p className="text-xl text-white/90 mb-8 max-w-2xl mx-auto drop-shadow-md">
        Select a character to embark on epic adventures or forge a new legend
      </p>
      <div className="flex justify-center">
        <Button
          onClick={onCreateNew}
          variant="fantasy"
          className="flex items-center gap-2 shadow-lg"
          disabled={disabled}
        >
          <Plus className="w-4 h-4" />
          Forge New Hero
        </Button>
      </div>
    </div>
  </div>
);
