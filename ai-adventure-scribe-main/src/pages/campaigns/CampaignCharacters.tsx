import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import CampaignCharacterList from './CampaignCharacterList';

import { Button } from '@/components/ui/button';

const CampaignCharacters: React.FC = () => {
  const { id: campaignId } = useParams();
  const navigate = useNavigate();

  const handleCreateCharacter = () => {
    if (!campaignId) {
      return;
    }
    // Navigate to full-page character wizard with campaign pre-selected
    navigate(`/app/characters/new?campaign=${campaignId}`);
  };

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Characters</h2>
        <Button onClick={handleCreateCharacter} disabled={!campaignId}>
          Create Character
        </Button>
      </div>
      <CampaignCharacterList />
    </div>
  );
};

export default CampaignCharacters;
