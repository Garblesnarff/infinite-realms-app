ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS expertise_proficiencies text;

COMMENT ON COLUMN characters.expertise_proficiencies IS
  'Comma-separated skill names whose proficiency bonus is doubled by Expertise.';
