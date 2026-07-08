import type { CharacterSubclass } from '@/types/character';

export const classSubclasses: Record<string, CharacterSubclass[]> = {
  barbarian: [{
    id: 'berserker', name: 'Path of the Berserker',
    description: 'A path of untrammeled fury, slick with blood.',
    features: [
      { id: 'frenzy', name: 'Frenzy', level: 3, description: 'While raging, make one melee weapon attack as a bonus action; suffer one exhaustion level when the rage ends.' },
      { id: 'mindless-rage', name: 'Mindless Rage', level: 6, description: 'You cannot be charmed or frightened while raging.' },
      { id: 'intimidating-presence', name: 'Intimidating Presence', level: 10, description: 'Use your action to frighten a creature that can see or hear you.' },
      { id: 'retaliation', name: 'Retaliation', level: 14, description: 'Use your reaction to make a melee weapon attack against a creature that damages you within 5 feet.' },
    ],
  }],
  bard: [{
    id: 'lore', name: 'College of Lore', description: 'Bards who collect knowledge from sources as diverse as scholarly tomes and peasant tales.',
    features: [
      { id: 'bonus-proficiencies', name: 'Bonus Proficiencies', level: 3, description: 'Gain proficiency with three skills of your choice.' },
      { id: 'cutting-words', name: 'Cutting Words', level: 3, description: 'Spend Bardic Inspiration as a reaction to reduce a creature’s attack, ability check, or damage roll.' },
      { id: 'additional-magical-secrets', name: 'Additional Magical Secrets', level: 6, description: 'Learn two spells from any class.' },
      { id: 'peerless-skill', name: 'Peerless Skill', level: 14, description: 'Spend Bardic Inspiration to add its roll to your own ability check.' },
    ],
  }],
  cleric: [{
    id: 'life-domain', name: 'Life Domain', description: 'The domain of vitality and healing.',
    features: [
      { id: 'disciple-of-life', name: 'Disciple of Life', level: 1, description: 'Healing spells restore 2 + the spell level additional hit points.' },
      { id: 'preserve-life', name: 'Channel Divinity: Preserve Life', level: 2, description: 'Restore hit points equal to five times your cleric level among nearby creatures.' },
      { id: 'blessed-healer', name: 'Blessed Healer', level: 6, description: 'Healing another creature with a spell also heals you.' },
      { id: 'divine-strike', name: 'Divine Strike', level: 8, description: 'Once per turn, deal extra radiant weapon damage.' },
      { id: 'supreme-healing', name: 'Supreme Healing', level: 17, description: 'Use maximum values for dice rolled by your healing spells.' },
    ],
  }],
  druid: [{
    id: 'land', name: 'Circle of the Land', description: 'Mystics and sages who safeguard ancient knowledge through oral tradition.',
    features: [
      { id: 'bonus-cantrip', name: 'Bonus Cantrip', level: 2, description: 'Learn one additional druid cantrip.' },
      { id: 'natural-recovery', name: 'Natural Recovery', level: 2, description: 'Recover expended spell slots during a short rest once per long rest.' },
      { id: 'lands-stride', name: 'Land’s Stride', level: 6, description: 'Move through nonmagical difficult terrain and plants without penalty.' },
      { id: 'natures-ward', name: 'Nature’s Ward', level: 10, description: 'Become immune to poison and disease and resist charm and fear from elementals and fey.' },
      { id: 'natures-sanctuary', name: 'Nature’s Sanctuary', level: 14, description: 'Beasts and plants must save before attacking you.' },
    ],
  }],
  fighter: [{
    id: 'champion', name: 'Champion', description: 'A martial archetype focused on raw physical power and deadly precision.',
    features: [
      { id: 'improved-critical', name: 'Improved Critical', level: 3, description: 'Weapon attacks score a critical hit on a roll of 19 or 20.' },
      { id: 'remarkable-athlete', name: 'Remarkable Athlete', level: 7, description: 'Add half proficiency to physical checks that do not already use proficiency; increase running jump distance.' },
      { id: 'additional-fighting-style', name: 'Additional Fighting Style', level: 10, description: 'Choose a second Fighting Style.' },
      { id: 'superior-critical', name: 'Superior Critical', level: 15, description: 'Weapon attacks score a critical hit on a roll of 18–20.' },
      { id: 'survivor', name: 'Survivor', level: 18, description: 'At the start of your turn, regain hit points while below half maximum HP.' },
    ],
  }],
  monk: [{
    id: 'open-hand', name: 'Way of the Open Hand', description: 'Masters of martial arts combat who manipulate ki in themselves and their enemies.',
    features: [
      { id: 'open-hand-technique', name: 'Open Hand Technique', level: 3, description: 'Flurry of Blows can knock prone, push, or suppress reactions.' },
      { id: 'wholeness-of-body', name: 'Wholeness of Body', level: 6, description: 'Use an action to regain hit points once per long rest.' },
      { id: 'tranquility', name: 'Tranquility', level: 11, description: 'Gain the effect of sanctuary after a long rest.' },
      { id: 'quivering-palm', name: 'Quivering Palm', level: 17, description: 'Spend ki to set up lethal vibrations that you can later trigger.' },
    ],
  }],
  paladin: [{
    id: 'devotion', name: 'Oath of Devotion', description: 'The ideal of the knight in shining armor acting with honor and compassion.',
    features: [
      { id: 'sacred-weapon', name: 'Channel Divinity: Sacred Weapon', level: 3, description: 'Imbue a weapon, adding Charisma to attack rolls and making it magical.' },
      { id: 'turn-the-unholy', name: 'Channel Divinity: Turn the Unholy', level: 3, description: 'Turn fiends and undead that fail a Wisdom save.' },
      { id: 'aura-of-devotion', name: 'Aura of Devotion', level: 7, description: 'You and nearby allies cannot be charmed.' },
      { id: 'purity-of-spirit', name: 'Purity of Spirit', level: 15, description: 'You are always under protection from evil and good.' },
      { id: 'holy-nimbus', name: 'Holy Nimbus', level: 20, description: 'Emanate sunlight that damages enemies and grants advantage on saves against fiends and undead.' },
    ],
  }],
  ranger: [{
    id: 'hunter', name: 'Hunter', description: 'A specialized warrior trained to confront the threats of the wilderness.',
    features: [
      { id: 'hunters-prey', name: 'Hunter’s Prey', level: 3, description: 'Choose Colossus Slayer, Giant Killer, or Horde Breaker.' },
      { id: 'defensive-tactics', name: 'Defensive Tactics', level: 7, description: 'Choose Escape the Horde, Multiattack Defense, or Steel Will.' },
      { id: 'multiattack', name: 'Multiattack', level: 11, description: 'Choose Volley or Whirlwind Attack.' },
      { id: 'superior-hunters-defense', name: 'Superior Hunter’s Defense', level: 15, description: 'Choose Evasion, Stand Against the Tide, or Uncanny Dodge.' },
    ],
  }],
  rogue: [{
    id: 'thief', name: 'Thief', description: 'Burglars, bandits, cutpurses, and adventurers who prize agility and stealth.',
    features: [
      { id: 'fast-hands', name: 'Fast Hands', level: 3, description: 'Use Cunning Action for Sleight of Hand, thieves’ tools, or Use an Object.' },
      { id: 'second-story-work', name: 'Second-Story Work', level: 3, description: 'Climb at full speed and jump farther.' },
      { id: 'supreme-sneak', name: 'Supreme Sneak', level: 9, description: 'Gain advantage on Stealth checks while moving at half speed.' },
      { id: 'use-magic-device', name: 'Use Magic Device', level: 13, description: 'Ignore class, race, and level requirements on magic items.' },
      { id: 'thiefs-reflexes', name: 'Thief’s Reflexes', level: 17, description: 'Take two turns during the first round of combat.' },
    ],
  }],
  sorcerer: [{
    id: 'draconic-bloodline', name: 'Draconic Bloodline', description: 'Innate magic flowing from draconic ancestry.',
    features: [
      { id: 'dragon-ancestor', name: 'Dragon Ancestor', level: 1, description: 'Choose a dragon type and learn Draconic.' },
      { id: 'draconic-resilience', name: 'Draconic Resilience', level: 1, description: 'Gain additional maximum HP and an unarmored AC of 13 + Dexterity.' },
      { id: 'elemental-affinity', name: 'Elemental Affinity', level: 6, description: 'Add Charisma to one matching damage roll and spend sorcery points for resistance.' },
      { id: 'dragon-wings', name: 'Dragon Wings', level: 14, description: 'Manifest wings and gain a flying speed.' },
      { id: 'draconic-presence', name: 'Draconic Presence', level: 18, description: 'Spend sorcery points to create an aura of awe or fear.' },
    ],
  }],
  warlock: [{
    id: 'fiend', name: 'The Fiend', description: 'A pact with a lower-plane entity whose aims are evil even when you oppose them.',
    features: [
      { id: 'dark-ones-blessing', name: 'Dark One’s Blessing', level: 1, description: 'Gain temporary HP when you reduce a hostile creature to 0 HP.' },
      { id: 'dark-ones-own-luck', name: 'Dark One’s Own Luck', level: 6, description: 'Add 1d10 to an ability check or saving throw once per rest.' },
      { id: 'fiendish-resilience', name: 'Fiendish Resilience', level: 10, description: 'Choose one damage type to resist after each rest.' },
      { id: 'hurl-through-hell', name: 'Hurl Through Hell', level: 14, description: 'After a hit, send the target through the lower planes for psychic damage.' },
    ],
  }],
  wizard: [{
    id: 'evocation', name: 'School of Evocation', description: 'Arcane scholars who shape destructive energy and protect allies from it.',
    features: [
      { id: 'evocation-savant', name: 'Evocation Savant', level: 2, description: 'Copying evocation spells costs half the normal gold and time.' },
      { id: 'sculpt-spells', name: 'Sculpt Spells', level: 2, description: 'Protect chosen creatures from your area evocation spells.' },
      { id: 'potent-cantrip', name: 'Potent Cantrip', level: 6, description: 'Creatures that save against your damaging cantrips still take half damage.' },
      { id: 'empowered-evocation', name: 'Empowered Evocation', level: 10, description: 'Add Intelligence to one damage roll of a wizard evocation spell.' },
      { id: 'overchannel', name: 'Overchannel', level: 14, description: 'Maximize damage of a 1st–5th level wizard spell, risking necrotic damage on repeated use.' },
    ],
  }],
};
