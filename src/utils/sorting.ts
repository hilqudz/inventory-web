export type SortDirection = 'asc' | 'desc' | null;

export interface SortConfig<T = any> {
  key: string | null;
  direction: SortDirection;
}

export function sortData<T>(data: T[], sortConfig: SortConfig<T>, customResolvers?: Record<string, (item: T) => any>): T[] {
  if (!sortConfig.key || !sortConfig.direction) return data;

  const key = sortConfig.key;
  const dir = sortConfig.direction === 'asc' ? 1 : -1;

  return [...data].sort((a, b) => {
    let valA: any;
    let valB: any;

    if (customResolvers && customResolvers[key]) {
      valA = customResolvers[key](a);
      valB = customResolvers[key](b);
    } else {
      valA = (a as any)[key];
      valB = (b as any)[key];
    }

    if (valA === undefined || valA === null) valA = '';
    if (valB === undefined || valB === null) valB = '';

    if (typeof valA === 'number' && typeof valB === 'number') {
      return (valA - valB) * dir;
    }

    const strA = String(valA).toLowerCase();
    const strB = String(valB).toLowerCase();

    return strA.localeCompare(strB, 'id', { numeric: true }) * dir;
  });
}
