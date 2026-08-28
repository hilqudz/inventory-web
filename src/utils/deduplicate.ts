import { MasterItem, TransactionRecord, DoOpenRecord, RequestDoRecord } from '../types';

/**
 * Deduplicates Master Items based on itemCode
 */
export function deduplicateMasterItems(items: MasterItem[]): MasterItem[] {
  if (!items || items.length === 0) return [];
  const map = new Map<string, MasterItem>();

  for (const item of items) {
    if (!item.itemCode) continue;
    const key = item.itemCode.trim().toUpperCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...item });
    } else {
      map.set(key, {
        ...existing,
        ...item,
        itemName: item.itemName || existing.itemName,
        groupName: item.groupName || existing.groupName,
        hargaJual: item.hargaJual || existing.hargaJual,
        hargaBeli: item.hargaBeli || existing.hargaBeli,
        createdDate: item.createdDate || existing.createdDate,
        createdAt: item.createdAt || existing.createdAt
      });
    }
  }

  return Array.from(map.values());
}

/**
 * Deduplicates Transaction Records (Masuk / Keluar)
 * Preserves all distinct rows from database (unique ID) or CSV lines.
 * Multiple lines with the same itemCode and documentNo are all kept intact.
 */
export function deduplicateTransactions(records: TransactionRecord[]): TransactionRecord[] {
  if (!records || records.length === 0) return [];
  const seenIds = new Set<string>();
  const result: TransactionRecord[] = [];

  for (const record of records) {
    if (record.id) {
      if (!seenIds.has(record.id)) {
        seenIds.add(record.id);
        result.push(record);
      }
    } else {
      result.push(record);
    }
  }

  return result;
}

/**
 * Deduplicates DO OPEN records based on unique record ID
 */
export function deduplicateDoOpen(records: DoOpenRecord[]): DoOpenRecord[] {
  if (!records || records.length === 0) return [];
  const seenIds = new Set<string>();
  const result: DoOpenRecord[] = [];

  for (const record of records) {
    if (record.id) {
      if (!seenIds.has(record.id)) {
        seenIds.add(record.id);
        result.push(record);
      }
    } else {
      result.push(record);
    }
  }

  return result;
}

/**
 * Deduplicates Request DO OPEN records based on unique record ID
 */
export function deduplicateRequestDoOpen(records: RequestDoRecord[]): RequestDoRecord[] {
  if (!records || records.length === 0) return [];
  const seenIds = new Set<string>();
  const result: RequestDoRecord[] = [];

  for (const record of records) {
    if (record.id) {
      if (!seenIds.has(record.id)) {
        seenIds.add(record.id);
        result.push(record);
      }
    } else {
      result.push(record);
    }
  }

  return result;
}

