export type { Equipment } from './types';
export { weapons, getWeaponDamageDice } from './weapons';
export { armor } from './armor';
export { shields } from './shields';
export { adventuringGear } from './gear';

export {
  allEquipment,
  EQUIPMENT_LOOKUP,
  normalizeEquipmentLookupKey,
  resolveEquipmentById,
  resolveEquipmentByName,
} from './resolver';
export { magicItems } from './api';
