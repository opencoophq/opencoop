export type ColumnSortDirection = 'asc' | 'desc';

export interface ColumnSortState<TColumn extends string> {
  column: TColumn | null;
  direction: ColumnSortDirection;
}

export interface ColumnConfig<T> {
  accessor: (row: T) => string | number | boolean | Date | null | undefined;
}

function normalizeString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).toLowerCase();
}

function normalizeSortValue(value: unknown): string | number {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value;
  return String(value).toLowerCase();
}

export function toggleColumnSort<TColumn extends string>(
  current: ColumnSortState<TColumn>,
  column: TColumn,
): ColumnSortState<TColumn> {
  if (current.column !== column) {
    return { column, direction: 'asc' };
  }

  return {
    column,
    direction: current.direction === 'asc' ? 'desc' : 'asc',
  };
}

export function applyColumnFiltersAndSort<T, TColumn extends string>(
  rows: T[],
  columns: Record<TColumn, ColumnConfig<T>>,
  filters: Partial<Record<TColumn, string>>,
  sort: ColumnSortState<TColumn>,
): T[] {
  const filtered = rows.filter((row) =>
    Object.entries(filters).every(([column, rawFilter]) => {
      const filter = String(rawFilter ?? '').trim().toLowerCase();
      if (!filter) return true;
      const value = columns[column as TColumn]?.accessor(row);
      return normalizeString(value).includes(filter);
    }),
  );

  if (!sort.column) return filtered;

  const column = columns[sort.column];
  if (!column) return filtered;

  const directionMultiplier = sort.direction === 'asc' ? 1 : -1;
  return [...filtered].sort((a, b) => {
    const left = normalizeSortValue(column.accessor(a));
    const right = normalizeSortValue(column.accessor(b));

    if (typeof left === 'number' && typeof right === 'number') {
      return (left - right) * directionMultiplier;
    }

    return String(left).localeCompare(String(right), undefined, {
      numeric: true,
      sensitivity: 'base',
    }) * directionMultiplier;
  });
}
