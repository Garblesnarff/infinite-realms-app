import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const source = (name) => new URL(`dnd-5e-mcp-server/data/5e-database/src/2014/${name}`, root);
const target = (name) => new URL(`ai-adventure-scribe-main/src/data/srd/${name}`, root);
const read = (name) => JSON.parse(readFileSync(source(name), 'utf8'));
const byId = (a, b) => String(a.id ?? a.index).localeCompare(String(b.id ?? b.index));

const spells = read('5e-SRD-Spells.json').map((spell) => ({
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

const monsters = read('5e-SRD-Monsters.json').map((monster) => ({
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
  savingThrows: Object.fromEntries((monster.proficiencies ?? [])
    .filter(({ proficiency }) => proficiency.index.startsWith('saving-throw-'))
    .map(({ proficiency, value }) => [proficiency.index.replace('saving-throw-', ''), value])),
  specialAbilities: monster.special_abilities ?? [],
  actions: monster.actions ?? [],
  legendaryActions: monster.legendary_actions ?? [],
}));

const propertyFlags = {
  ammunition: 'ammunition', finesse: 'finesse', heavy: 'heavy', light: 'light',
  loading: 'loading', reach: 'reach', special: 'special', thrown: 'thrown',
  'two-handed': 'twoHanded', versatile: 'versatile',
};
const equipmentSource = read('5e-SRD-Equipment.json');
const weapons = equipmentSource
  .filter((item) => item.equipment_category?.index === 'weapon')
  .map((item) => {
    const flags = Object.fromEntries(item.properties
      .map(({ index }) => propertyFlags[index])
      .filter(Boolean)
      .map((key) => [key, true]));
    return {
      id: item.index, name: item.name, category: 'weapon',
      subcategory: item.category_range.toLowerCase(),
      weaponType: item.weapon_category.toLowerCase(),
      cost: { amount: item.cost.quantity, currency: item.cost.unit },
      ...(item.weight != null ? { weight: item.weight } : {}),
      description: item.desc?.join('\n\n') || `${item.category_range} weapon.`,
      properties: item.properties.map(({ name }) => name),
      ...(item.damage ? { damage: { dice: item.damage.damage_dice, type: item.damage.damage_type.index } } : {}),
      attackBonus: 0,
      ...(item.range ? { range: { normal: item.range.normal, ...(item.range.long ? { long: item.range.long } : {}) } } : {}),
      weaponProperties: flags,
      ...(item.two_handed_damage?.damage_dice ? { versatileDamage: item.two_handed_damage.damage_dice } : {}),
    };
  }).sort(byId);

const rarityMap = { 'Very Rare': 'very_rare' };
const inferMagicEffects = (item) => {
  const text = item.desc.join(' ');
  const effects = {};
  const bonus = text.match(/(?:a|an) \+(\d+) bonus to attack and damage rolls/i);
  const ac = text.match(/\+(\d+) bonus to AC/i);
  const saves = text.match(/\+(\d+) bonus to saving throws/i);
  if (bonus) effects.attackBonus = effects.damageBonus = Number(bonus[1]);
  if (ac) effects.acBonus = Number(ac[1]);
  if (saves) effects.saveBonus = Number(saves[1]);
  effects.specialProperties = item.desc.slice(1);
  return effects;
};
const magicItems = read('5e-SRD-Magic-Items.json').map((item) => {
  const text = item.desc.join(' ');
  const attunement = /requires attunement/i.test(text);
  const category = item.equipment_category?.index;
  return {
    id: item.index, name: item.name,
    category: category === 'weapon' ? 'weapon' : category === 'armor' ? 'armor' : 'gear',
    cost: { amount: 0, currency: 'gp' }, description: item.desc.join('\n\n'),
    isMagic: true, requiresAttunement: attunement,
    ...(attunement ? { attunementRequirements: text.match(/requires attunement(?: by ([^)]+))?/i)?.[1] || 'Any creature' } : {}),
    magicItemRarity: rarityMap[item.rarity.name] || item.rarity.name.toLowerCase(),
    magicItemType: category === 'weapon' || category === 'armor' ? category : 'wondrous',
    magicEffects: inferMagicEffects(item),
  };
}).sort(byId);

const featureByIndex = new Map(read('5e-SRD-Features.json').map((feature) => [feature.index, feature]));
const progressions = {};
for (const row of read('5e-SRD-Levels.json')) {
  if (!row.class || row.subclass) continue;
  const classId = row.class.index;
  progressions[classId] ??= [];
  for (const ref of row.features) {
    const feature = featureByIndex.get(ref.index);
    progressions[classId].push({
      level: row.level, featureName: ref.name,
      description: feature?.desc?.join('\n\n') || ref.name,
      ...(ref.name === 'Ability Score Improvement' ? { abilityScoreImprovement: true } : {}),
    });
  }
}
for (const entries of Object.values(progressions)) entries.sort((a, b) => a.level - b.level || a.featureName.localeCompare(b.featureName));

const matchesEquipmentCategory = (item, category) => {
  if (category === 'musical-instruments') return item.tool_category === 'Musical Instrument';
  if (item.gear_category?.index === category) return true;
  if (!category.includes('weapon')) return false;
  const martial = item.weapon_category?.toLowerCase() === 'martial';
  const melee = item.weapon_range?.toLowerCase() === 'melee';
  return (!category.includes('martial') || martial)
    && (!category.includes('simple') || !martial)
    && (!category.includes('melee') || melee)
    && (!category.includes('ranged') || !melee);
};
const expandEquipmentCategories = (value) => {
  if (Array.isArray(value)) return value.map(expandEquipmentCategories);
  if (!value || typeof value !== 'object') return value;
  if (value.option_set_type === 'equipment_category') {
    const category = value.equipment_category.index;
    return {
      option_set_type: 'options_array',
      options: equipmentSource.filter((item) => matchesEquipmentCategory(item, category)).sort(byId).map((item) => ({
        option_type: 'counted_reference', count: 1, of: { index: item.index, name: item.name },
      })),
    };
  }
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, expandEquipmentCategories(nested)]));
};
const startingEquipment = read('5e-SRD-Classes.json').map((klass) => ({
  id: klass.index, name: klass.name,
  fixed: klass.starting_equipment.map(({ equipment, quantity }) => ({ id: equipment.index, name: equipment.name, quantity })),
  choices: expandEquipmentCategories(klass.starting_equipment_options),
})).sort(byId);

for (const [name, data] of Object.entries({ spells, monsters, weapons, 'magic-items': magicItems, progressions, 'starting-equipment': startingEquipment })) {
  writeFileSync(target(`${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
}
console.log(`Imported ${spells.length} spells, ${monsters.length} monsters, ${weapons.length} weapons, ${magicItems.length} magic items, ${Object.keys(progressions).length} class progressions, and ${startingEquipment.length} starting-equipment tables.`);
