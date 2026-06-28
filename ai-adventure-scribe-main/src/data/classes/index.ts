import { barbarian } from './barbarian';
import { bard } from './bard';
import { cleric } from './cleric';
import { druid } from './druid';
import { fighter } from './fighter';
import { monk } from './monk';
import { paladin } from './paladin';
import { ranger } from './ranger';
import { rogue } from './rogue';
import { sorcerer } from './sorcerer';
import { warlock } from './warlock';
import { wizard } from './wizard';

import type { CharacterClass } from '@/types/character';

export const classes: CharacterClass[] = [
  fighter,
  wizard,
  rogue,
  cleric,
  bard,
  barbarian,
  druid,
  monk,
  paladin,
  ranger,
  sorcerer,
  warlock,
];
