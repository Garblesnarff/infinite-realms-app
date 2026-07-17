-- Preserve existing custom item rows while moving them to the first-class
-- trinket category. The starter backfill resolves any names that now have an
-- SRD match and leaves deliberately custom items untouched.
UPDATE character_equipment
SET item_type = 'trinket'
WHERE item_type = 'custom';
