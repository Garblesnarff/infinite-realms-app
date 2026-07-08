import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const source = (name) => new URL(`dnd-5e-mcp-server/data/5e-database/src/2014/${name}`, root);
const target = (name) => new URL(`ai-adventure-scribe-main/src/data/srd/${name}`, root);

const spells = JSON.parse(readFileSync(source('5e-SRD-Spells.json'), 'utf8')).map((spell) => ({
  id: spell.index,
  name: spell.name,
  level: spell.level,
  school: spell.school.name,
  casting_time: spell.casting_time,
  range_text: spell.range,
  components: spell.components.join(', '),
  components_verbal: spell.components.includes('V'),
  components_somatic: spell.components.includes('S'),
  components_material: spell.components.includes('M'),
  ...(spell.material ? { material_components: spell.material } : {}),
  duration: spell.duration,
  description: spell.desc.join('\n\n'),
  ...(spell.higher_level?.length ? { higher_level_text: spell.higher_level.join('\n\n') } : {}),
  ...(spell.damage?.damage_at_slot_level
    ? { damage: Object.values(spell.damage.damage_at_slot_level)[0] }
    : spell.damage?.damage_at_character_level
      ? { damage: Object.values(spell.damage.damage_at_character_level)[0] }
      : {}),
  ritual: spell.ritual,
  concentration: spell.concentration,
  ...(spell.attack_type ? { attack_type: spell.attack_type } : {}),
  ...(spell.dc ? { save_ability: spell.dc.dc_type.index, save_success: spell.dc.dc_success } : {}),
  ...(spell.damage?.damage_type ? { damage_type: spell.damage.damage_type.index } : {}),
  damage_by_level: spell.damage?.damage_at_slot_level ?? spell.damage?.damage_at_character_level ?? {},
  classes: spell.classes.map(({ index }) => index),
}));

const monsters = JSON.parse(readFileSync(source('5e-SRD-Monsters.json'), 'utf8')).map((monster) => ({
  id: `srd:${monster.index}`,
  name: monster.name,
  cr: monster.challenge_rating,
  xp: monster.xp,
  tags: [monster.type, monster.subtype].filter(Boolean),
  size: monster.size,
  type: monster.type,
  alignment: monster.alignment,
  armorClass: Math.max(...monster.armor_class.map(({ value }) => value)),
  hitPoints: monster.hit_points,
  hitDice: monster.hit_dice,
  speed: monster.speed,
  abilities: {
    strength: monster.strength,
    dexterity: monster.dexterity,
    constitution: monster.constitution,
    intelligence: monster.intelligence,
    wisdom: monster.wisdom,
    charisma: monster.charisma,
  },
  resistances: monster.damage_resistances,
  immunities: monster.damage_immunities,
  vulnerabilities: monster.damage_vulnerabilities,
  conditionImmunities: monster.condition_immunities.map(({ name }) => name),
  senses: monster.senses,
  languages: monster.languages,
  proficiencyBonus: monster.proficiency_bonus,
  specialAbilities: monster.special_abilities ?? [],
  actions: monster.actions ?? [],
  legendaryActions: monster.legendary_actions ?? [],
}));

writeFileSync(target('spells.json'), `${JSON.stringify(spells, null, 2)}\n`);
writeFileSync(target('monsters.json'), `${JSON.stringify(monsters, null, 2)}\n`);
console.log(`Imported ${spells.length} spells and ${monsters.length} monsters.`);
