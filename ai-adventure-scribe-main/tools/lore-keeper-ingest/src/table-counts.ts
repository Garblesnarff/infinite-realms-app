/**
 * Rows handed to a table versus rows the database accepted. An ingest that drops rows has to say
 * so, because a bare "success" is what hid #2360.
 */
export interface TableCount {
  table: string;
  attempted: number;
  written: number;
}

export function formatTableCounts(counts: TableCount[]): string {
  return counts
    .map(({ table, attempted, written }) => `${table}: attempted ${attempted}, written ${written}`)
    .join('; ');
}
