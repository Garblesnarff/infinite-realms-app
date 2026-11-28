/**
 * #1344: a premade (starter template) create body, and the template row it names.
 *
 * The client builder (buildStarterCharacterSeed) must send the same starter_template_id and
 * the same class, race and level as the row. The real-route tests post this body and the
 * client test asserts the builder agrees with it.
 */
export const PREMADE_TEMPLATE_ID = '5b1d0c7e-2a4f-4e8b-9c3d-1f2e3a4b5c6d';

export const PREMADE_TEMPLATE_ROW = {
  name: 'Gate Champion',
  race: 'Human',
  class: 'Fighter',
  level: 3,
  background: 'Soldier',
  abilityScores: {
    strength: 16,
    dexterity: 14,
    constitution: 14,
    intelligence: 10,
    wisdom: 12,
    charisma: 8,
  },
  skills: ['Athletics', 'Perception'],
  languages: ['Common'],
};

/** #1741: the name a player typed at hero choice (the template row keeps its own name). */
export const PREMADE_TYPED_HERO_NAME = 'Mara';

/**
 * The body the premade path posts for PREMADE_TEMPLATE_ROW, naming the template id.
 * `name` is the hero's name on the player's copy; it defaults to the template's name.
 */
export function premadeCreateBody(
  templateId: string = PREMADE_TEMPLATE_ID,
  name: string = PREMADE_TEMPLATE_ROW.name,
): Record<string, unknown> {
  return {
    name,
    race: PREMADE_TEMPLATE_ROW.race,
    subrace: null,
    class: PREMADE_TEMPLATE_ROW.class,
    subclass: null,
    level: PREMADE_TEMPLATE_ROW.level,
    background: PREMADE_TEMPLATE_ROW.background,
    backstory_elements: null,
    description: null,
    image_url: null,
    avatar_url: null,
    background_image: null,
    equipment: [],
    campaign_id: null,
    starter_template_id: templateId,
    skill_proficiencies: PREMADE_TEMPLATE_ROW.skills.join(', '),
    languages: PREMADE_TEMPLATE_ROW.languages,
    cantrips: '',
    known_spells: '',
    prepared_spells: '',
    total_level: PREMADE_TEMPLATE_ROW.level,
    stats: { ...PREMADE_TEMPLATE_ROW.abilityScores },
  };
}
