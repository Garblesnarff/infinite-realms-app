import { BookOpen, Sword, Skull, Zap, Gavel, Anchor } from 'lucide-react';
import React from 'react';

export type GenreMeta = {
  value: string;
  label: string;
  description: string;
  themes: string[];
  icon: React.ReactNode;
  colorClass: string;
  backgroundImage?: string;
};

export const GENRES: GenreMeta[] = [
  {
    value: 'traditional-fantasy',
    label: 'Traditional Fantasy',
    description: 'Classic swords-and-sorcery with familiar races, kingdoms, and epic quests.',
    themes: ['Heroic', 'Exploration', 'Magic'],
    icon: <Sword className="h-5 w-5" />,
    colorClass: 'text-infinite-gold',
    backgroundImage:
      '/images/campaign-styles/traditional-fantasy-campaign-style-card-background.png',
  },
  {
    value: 'dark-fantasy',
    label: 'Dark Fantasy',
    description: 'Gritty worlds where power has a cost and hope is hard-won.',
    themes: ['Gritty', 'Horror', 'Moral Dilemmas'],
    icon: <Skull className="h-5 w-5" />,
    colorClass: 'text-destructive',
    backgroundImage: '/images/campaign-styles/dark-fantasy-campaign-style-card-background.png',
  },
  {
    value: 'high-fantasy',
    label: 'High Fantasy',
    description: 'Mythic stakes, ancient magic, and legendary heroes in sweeping sagas.',
    themes: ['Epic', 'Magic', 'Mythic'],
    icon: <Zap className="h-5 w-5" />,
    colorClass: 'text-infinite-purple',
    backgroundImage: '/images/campaign-styles/high-fantasy-campaign-style-card-background.png',
  },
  {
    value: 'science-fantasy',
    label: 'Science Fantasy',
    description: 'Where arcane forces meet advanced technology across strange worlds.',
    themes: ['Tech + Magic', 'Exploration', 'Weird'],
    icon: <Gavel className="h-5 w-5" />,
    colorClass: 'text-infinite-teal',
    backgroundImage: '/images/campaign-styles/science-fantasy-campaign-style-card-background.png',
  },
  {
    value: 'steampunk',
    label: 'Steampunk',
    description: 'Industrial wonders, airships, and intrigue powered by gears and steam.',
    themes: ['Invention', 'Intrigue', 'Airships'],
    icon: <Anchor className="h-5 w-5" />,
    colorClass: 'text-infinite-gold',
    backgroundImage: '/images/campaign-styles/steampunk-campaign-style-card-background.png',
  },
  {
    value: 'horror',
    label: 'Horror',
    description: 'Whispers in the dark, creeping dread, and the unknown beyond the veil.',
    themes: ['Supernatural', 'Mystery', 'Survival'],
    icon: <BookOpen className="h-5 w-5" />,
    colorClass: 'text-muted-foreground',
    backgroundImage: '/images/campaign-styles/horror-campaign-style-card-background.png',
  },
];
