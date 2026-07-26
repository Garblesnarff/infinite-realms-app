export interface SpellFilters {
  schools: string[];
  components: {
    verbal: boolean;
    somatic: boolean;
    material: boolean;
  };
  properties: {
    concentration: boolean;
    ritual: boolean;
    damage: boolean;
  };
}
