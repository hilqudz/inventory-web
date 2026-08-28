import { createClient } from '@supabase/supabase-js';
import { MasterItem, TransactionRecord, DoOpenRecord, RequestDoRecord, AppUser, ContainerRecord, ContainerStatusType, ItemCatalogPhoto } from './types';
import { deduplicateMasterItems, deduplicateTransactions, deduplicateDoOpen, deduplicateRequestDoOpen } from './utils/deduplicate';
import { saveLocalCache, loadLocalCache, loadCatalogPhotosIndexedDB, saveCatalogPhotosIndexedDB } from './utils/localCache';
export { saveLocalCache, loadLocalCache, loadCatalogPhotosIndexedDB, saveCatalogPhotosIndexedDB };

// ============================================================================
// SUPABASE CLIENT INITIALIZATION
// ============================================================================
export function sanitizeSupabaseUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  let clean = rawUrl.trim();
  // Remove /rest/v1 or /rest/v1/ suffix if user pasted the API endpoint URL
  clean = clean.replace(/\/rest\/v1\/?$/i, '');
  // Remove trailing slashes
  clean = clean.replace(/\/+$/, '');
  return clean;
}

export function getSupabaseCredentials() {
  const savedUrl = typeof window !== 'undefined' && window.localStorage ? localStorage.getItem('CUSTOM_SUPABASE_URL') : null;
  const savedKey = typeof window !== 'undefined' && window.localStorage ? localStorage.getItem('CUSTOM_SUPABASE_ANON_KEY') : null;
  let url = (savedUrl && savedUrl.trim()) || ((import.meta as any).env?.VITE_SUPABASE_URL) || 'https://cevaowpizcqikbxquweh.supabase.co';
  url = sanitizeSupabaseUrl(url);
  const key = (savedKey && savedKey.trim()) || ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY) || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNldmFvd3BpemNxaWtieHF1d2VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4NTM5NTAsImV4cCI6MjEwMDQyOTk1MH0.72OIdK2KcE2Ya0plTdVAcggB0SoS2qFBTWgKJ7wzBy8';
  return { url, key: key.trim() };
}

export function saveSupabaseCredentials(url: string, key: string) {
  const cleanUrl = sanitizeSupabaseUrl(url);
  const cleanKey = key.trim();
  if (cleanUrl) localStorage.setItem('CUSTOM_SUPABASE_URL', cleanUrl);
  if (cleanKey) localStorage.setItem('CUSTOM_SUPABASE_ANON_KEY', cleanKey);
  // Re-create singleton
  const creds = getSupabaseCredentials();
  supabase = createClient(creds.url, creds.key);
}

const initialCreds = getSupabaseCredentials();
export let supabase = createClient(initialCreds.url, initialCreds.key);

// ============================================================================
// 1. UPLOAD FOTO BARANG (Supabase Storage Bucket: "foto-barang")
// ============================================================================
/**
 * Mengunggah file foto barang ke Supabase Storage bucket "foto-barang"
 * @param file File image yang diupload
 * @param itemCode Kode barang untuk penamaan file
 * @returns Public URL gambar yang tersimpan
 */
export async function uploadFotoBarang(file: File, itemCode: string): Promise<string | null> {
  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${itemCode.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.${fileExt}`;
    const filePath = `items/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('foto-barang')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true
      });

    if (uploadError) {
      console.error('Error upload foto ke Supabase Storage:', uploadError.message);
      return null;
    }

    const { data } = supabase.storage.from('foto-barang').getPublicUrl(filePath);
    return data.publicUrl;
  } catch (err) {
    console.error('Upload foto exception:', err);
    return null;
  }
}

// Helper function with retries for fetching range from Supabase
async function fetchPageWithRetry(
  tableName: string,
  orderBy: string,
  secOrder: string | undefined,
  from: number,
  to: number,
  retries = 3
): Promise<{ data: any[] | null; error: any }> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      let query = supabase
        .from(tableName)
        .select('*')
        .order(orderBy, { ascending: false });

      if (secOrder && secOrder !== orderBy) {
        query = query.order(secOrder, { ascending: true });
      }

      const res = await query.range(from, to);
      if (!res.error) {
        return res;
      }
      if (res.error.message && (res.error.message.includes('schema cache') || res.error.message.includes('find the table'))) {
        return res;
      }
      console.warn(`[Supabase Fetch Retry ${attempt}/${retries}] ${tableName} page range ${from}-${to}:`, res.error.message);
    } catch (err: any) {
      console.warn(`[Supabase Fetch Exception Retry ${attempt}/${retries}] ${tableName} range ${from}-${to}:`, err?.message || err);
    }
    if (attempt < retries) {
      await new Promise(resolve => setTimeout(resolve, 350 * attempt));
    }
  }
  return { data: null, error: { message: `Gagal terhubung ke Supabase tabel '${tableName}' setelah ${retries} percobaan.` } };
}

// Helper for fetching all rows without PostgREST 1000 row limit
async function fetchAllRowsFromTable(tableName: string, orderBy: string = 'created_at', secondaryOrderBy?: string): Promise<any[] | null> {
  let allRows: any[] = [];
  let page = 0;
  const pageSize = 1000;
  let hasMore = true;

  // Secondary order tie-breaker for stable pagination across pages when created_at timestamps are identical
  const fallbackSecondary = tableName === 'master_item' ? 'kode' : (tableName === 'users' ? 'nik' : 'id');
  const secOrder = secondaryOrderBy || (orderBy !== fallbackSecondary ? fallbackSecondary : undefined);

  while (hasMore) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const { data, error } = await fetchPageWithRetry(tableName, orderBy, secOrder, from, to, 3);

    if (error) {
      if (error.message && (error.message.includes('schema cache') || error.message.includes('find the table'))) {
        console.warn(`Tabel '${tableName}' tidak ditemukan di Supabase schema. Menggunakan data lokal.`);
      } else {
        console.warn(`Fetch ${tableName} terhenti pada halaman ${page + 1}: ${error.message || 'Network error'}. Menggunakan ${allRows.length} data terunduh.`);
      }
      return allRows.length > 0 ? allRows : null;
    }

    if (data && data.length > 0) {
      allRows = allRows.concat(data);
      if (data.length < pageSize) {
        hasMore = false;
      } else {
        page++;
      }
    } else {
      hasMore = false;
    }
  }

  return allRows;
}

// ============================================================================
// 2. CRUD OPERATIONS: MASTER ITEM (master_item)
// ============================================================================
function toIsoDateString(dateStr?: string): string {
  if (!dateStr) return new Date().toISOString();
  try {
    const dt = new Date(dateStr);
    if (!isNaN(dt.getTime())) {
      return dt.toISOString();
    }
  } catch {}
  return new Date().toISOString();
}

export async function fetchMasterItems(): Promise<MasterItem[]> {
  const data = await fetchAllRowsFromTable('master_item', 'created_at');

  const items = (data || []).map(row => {
    const rawCreatedDate = row.created_date || row.createdDate || row.CreatedDate;
    let createdDateStr = rawCreatedDate;
    if (!createdDateStr && row.created_at) {
      createdDateStr = String(row.created_at).slice(0, 10);
    }

    return {
      id: row.kode,
      itemCode: row.kode,
      itemName: row.nama_barang,
      groupName: row.group_name,
      hargaJual: Number(row.harga_jual || 0),
      hargaBeli: Number(row.harga_beli || 0),
      createdDate: createdDateStr || undefined,
      createdAt: row.created_at
    };
  });

  return deduplicateMasterItems(items);
}

export async function addMasterItem(item: MasterItem): Promise<boolean> {
  const row: Record<string, any> = {
    kode: item.itemCode,
    nama_barang: item.itemName,
    group_name: item.groupName,
    harga_jual: item.hargaJual,
    harga_beli: item.hargaBeli,
    created_at: toIsoDateString(item.createdDate)
  };
  if (item.createdDate) {
    row.created_date = item.createdDate;
  }

  let res = await supabase.from('master_item').insert(row);
  if (res.error && res.error.message?.includes('created_date')) {
    delete row.created_date;
    res = await supabase.from('master_item').insert(row);
  }

  if (res.error) {
    console.error('Error add master_item:', res.error.message);
    return false;
  }
  return true;
}

export async function updateMasterItem(itemCode: string, item: Partial<MasterItem>): Promise<boolean> {
  const payload: Record<string, any> = {};
  if (item.itemName !== undefined) payload.nama_barang = item.itemName;
  if (item.groupName !== undefined) payload.group_name = item.groupName;
  if (item.hargaJual !== undefined) payload.harga_jual = item.hargaJual;
  if (item.hargaBeli !== undefined) payload.harga_beli = item.hargaBeli;
  if (item.createdDate !== undefined) {
    payload.created_date = item.createdDate;
    payload.created_at = toIsoDateString(item.createdDate);
  }

  let res = await supabase.from('master_item').update(payload).eq('kode', itemCode);
  if (res.error && res.error.message?.includes('created_date')) {
    delete payload.created_date;
    if (Object.keys(payload).length > 0) {
      res = await supabase.from('master_item').update(payload).eq('kode', itemCode);
    } else {
      return true;
    }
  }

  if (res.error) {
    console.error('Error update master_item:', res.error.message);
    return false;
  }
  return true;
}

export async function upsertMasterItem(item: Partial<MasterItem> & { itemCode: string }): Promise<boolean> {
  const cleanCode = (item.itemCode || '').toString().trim().toUpperCase();
  if (!cleanCode) return false;

  const payload: Record<string, any> = {
    kode: cleanCode,
    nama_barang: item.itemName || cleanCode,
    group_name: item.groupName || 'Umum',
    harga_jual: Number(item.hargaJual) || 0,
    harga_beli: Number(item.hargaBeli) || 0,
    created_at: toIsoDateString(item.createdDate)
  };
  if (item.createdDate) {
    payload.created_date = item.createdDate;
  }

  let res = await supabase.from('master_item').upsert(payload, { onConflict: 'kode' });
  if (res.error && res.error.message?.includes('created_date')) {
    delete payload.created_date;
    res = await supabase.from('master_item').upsert(payload, { onConflict: 'kode' });
  }

  if (res.error) {
    console.error('Error upsert master_item:', res.error.message);
    return false;
  }
  return true;
}

export async function deleteMasterItem(itemCode: string): Promise<boolean> {
  const { error } = await supabase
    .from('master_item')
    .delete()
    .eq('kode', itemCode);

  if (error) {
    console.error('Error delete master_item:', error.message);
    return false;
  }
  return true;
}

export async function bulkAddMasterItems(
  items: MasterItem[],
  onProgress?: (processed: number, total: number) => void
): Promise<boolean> {
  if (!items.length) return true;
  const payload = items.map(item => {
    const row: Record<string, any> = {
      kode: item.itemCode,
      nama_barang: item.itemName,
      group_name: item.groupName,
      harga_jual: item.hargaJual,
      harga_beli: item.hargaBeli,
      created_at: toIsoDateString(item.createdDate)
    };
    if (item.createdDate) {
      row.created_date = item.createdDate;
    }
    return row;
  });

  const CHUNK_SIZE = 1000;
  let processed = 0;

  for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
    const chunk = payload.slice(i, i + CHUNK_SIZE);
    let res = await supabase.from('master_item').upsert(chunk, { onConflict: 'kode' });

    if (res.error && res.error.message?.includes('created_date')) {
      const strippedChunk = chunk.map(r => {
        const copy = { ...r };
        delete copy.created_date;
        return copy;
      });
      res = await supabase.from('master_item').upsert(strippedChunk, { onConflict: 'kode' });
    }

    if (res.error) {
      console.error('Error bulk master_item chunk:', res.error.message);
    }
    processed += chunk.length;
    if (onProgress) onProgress(Math.min(processed, items.length), items.length);
  }

  return true;
}

// ============================================================================
// 3. CRUD OPERATIONS: TRANSAKSI MASUK (transaksi_masuk)
// ============================================================================
export async function fetchTransaksiMasuk(): Promise<TransactionRecord[]> {
  const data = await fetchAllRowsFromTable('transaksi_masuk', 'created_at');

  const records = (data || []).map(row => ({
    id: row.id,
    postingDate: row.posting_date || '',
    entryName: row.entry_remark || '',
    documentNo: row.document_no || '',
    itemCode: row.item_code || '',
    category: row.category || '',
    remark: row.entry_remark || '',
    qty: Number(row.qty || 0),
    fromLocation: row.from_location || '',
    toLocation: row.to_location || '',
    createdAt: row.created_at
  }));

  return deduplicateTransactions(records);
}

export async function addTransaksiMasuk(record: Omit<TransactionRecord, 'id'>): Promise<boolean> {
  const { error } = await supabase
    .from('transaksi_masuk')
    .insert({
      posting_date: record.postingDate,
      document_no: record.documentNo,
      item_code: record.itemCode,
      category: record.category,
      qty: record.qty,
      from_location: record.fromLocation,
      to_location: record.toLocation,
      entry_remark: record.remark || record.entryName || '',
      aksi: 'MASUK',
      created_at: new Date().toISOString()
    });

  if (error) {
    console.error('Error add transaksi_masuk:', error.message);
    return false;
  }
  return true;
}

export async function updateTransaksiMasuk(id: string, record: Partial<TransactionRecord>): Promise<boolean> {
  const payload: Record<string, any> = {};
  if (record.postingDate !== undefined) payload.posting_date = record.postingDate;
  if (record.documentNo !== undefined) payload.document_no = record.documentNo;
  if (record.itemCode !== undefined) payload.item_code = record.itemCode;
  if (record.category !== undefined) payload.category = record.category;
  if (record.qty !== undefined) payload.qty = record.qty;
  if (record.fromLocation !== undefined) payload.from_location = record.fromLocation;
  if (record.toLocation !== undefined) payload.to_location = record.toLocation;
  if (record.remark !== undefined) payload.entry_remark = record.remark;

  const { error } = await supabase
    .from('transaksi_masuk')
    .update(payload)
    .eq('id', id);

  if (error) {
    console.error('Error update transaksi_masuk:', error.message);
    return false;
  }
  return true;
}

export async function deleteTransaksiMasuk(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('transaksi_masuk')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error delete transaksi_masuk:', error.message);
    return false;
  }
  return true;
}

export async function bulkAddTransaksiMasuk(
  records: Omit<TransactionRecord, 'id'>[],
  onProgress?: (processed: number, total: number) => void
): Promise<boolean> {
  if (!records.length) return true;

  // Auto-upsert referenced itemCodes into master_item
  const allItemCodes = Array.from(new Set(records.map(r => (r.itemCode || '-').toString().trim().toUpperCase()).filter(Boolean)));
  if (allItemCodes.length > 0) {
    const missingMasterPayloads = allItemCodes.map(code => ({
      kode: code,
      nama_barang: code === '-' ? 'GENERAL ITEM' : code,
      group_name: 'Umum',
      harga_jual: 0,
      harga_beli: 0
    }));
    for (let i = 0; i < missingMasterPayloads.length; i += 1000) {
      await supabase.from('master_item').upsert(missingMasterPayloads.slice(i, i + 1000), { onConflict: 'kode', ignoreDuplicates: true });
    }
  }

  const payload = records.map(r => ({
    posting_date: r.postingDate,
    document_no: r.documentNo,
    item_code: r.itemCode || '-',
    category: r.category,
    qty: r.qty,
    from_location: r.fromLocation,
    to_location: r.toLocation,
    entry_remark: r.remark || r.entryName || '',
    aksi: 'MASUK',
    created_at: new Date().toISOString()
  }));

  const CHUNK_SIZE = 1000;
  const CONCURRENCY = 4;
  let processed = 0;

  for (let i = 0; i < payload.length; i += CHUNK_SIZE * CONCURRENCY) {
    const promises = [];
    for (let c = 0; c < CONCURRENCY; c++) {
      const start = i + c * CHUNK_SIZE;
      if (start < payload.length) {
        const chunk = payload.slice(start, start + CHUNK_SIZE);
        promises.push(supabase.from('transaksi_masuk').insert(chunk));
      }
    }
    const results = await Promise.all(promises);
    for (const res of results) {
      if (res.error) console.error('Error bulk transaksi_masuk chunk:', res.error.message);
    }
    processed += CHUNK_SIZE * promises.length;
    if (onProgress) onProgress(Math.min(processed, records.length), records.length);
  }

  return true;
}

// ============================================================================
// 4. CRUD OPERATIONS: TRANSAKSI KELUAR (transaksi_keluar)
// ============================================================================
export async function fetchTransaksiKeluar(): Promise<TransactionRecord[]> {
  const data = await fetchAllRowsFromTable('transaksi_keluar', 'created_at');

  const records = (data || []).map(row => ({
    id: row.id,
    postingDate: row.posting_date || '',
    entryName: row.entry_remark || '',
    documentNo: row.document_no || '',
    itemCode: row.item_code || '',
    category: row.category || '',
    remark: row.entry_remark || '',
    qty: Number(row.qty || 0),
    fromLocation: row.from_location || '',
    toLocation: row.to_location || '',
    createdAt: row.created_at
  }));

  return deduplicateTransactions(records);
}

export async function addTransaksiKeluar(record: Omit<TransactionRecord, 'id'>): Promise<boolean> {
  const { error } = await supabase
    .from('transaksi_keluar')
    .insert({
      posting_date: record.postingDate,
      document_no: record.documentNo,
      item_code: record.itemCode,
      category: record.category,
      qty: record.qty,
      from_location: record.fromLocation,
      to_location: record.toLocation,
      entry_remark: record.remark || record.entryName || '',
      aksi: 'KELUAR',
      created_at: new Date().toISOString()
    });

  if (error) {
    console.error('Error add transaksi_keluar:', error.message);
    return false;
  }
  return true;
}

export async function updateTransaksiKeluar(id: string, record: Partial<TransactionRecord>): Promise<boolean> {
  const payload: Record<string, any> = {};
  if (record.postingDate !== undefined) payload.posting_date = record.postingDate;
  if (record.documentNo !== undefined) payload.document_no = record.documentNo;
  if (record.itemCode !== undefined) payload.item_code = record.itemCode;
  if (record.category !== undefined) payload.category = record.category;
  if (record.qty !== undefined) payload.qty = record.qty;
  if (record.fromLocation !== undefined) payload.from_location = record.fromLocation;
  if (record.toLocation !== undefined) payload.to_location = record.toLocation;
  if (record.remark !== undefined) payload.entry_remark = record.remark;

  const { error } = await supabase
    .from('transaksi_keluar')
    .update(payload)
    .eq('id', id);

  if (error) {
    console.error('Error update transaksi_keluar:', error.message);
    return false;
  }
  return true;
}

export async function deleteTransaksiKeluar(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('transaksi_keluar')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error delete transaksi_keluar:', error.message);
    return false;
  }
  return true;
}

export async function bulkAddTransaksiKeluar(
  records: Omit<TransactionRecord, 'id'>[],
  onProgress?: (processed: number, total: number) => void
): Promise<boolean> {
  if (!records.length) return true;

  // Auto-upsert referenced itemCodes into master_item
  const allItemCodes = Array.from(new Set(records.map(r => (r.itemCode || '-').toString().trim().toUpperCase()).filter(Boolean)));
  if (allItemCodes.length > 0) {
    const missingMasterPayloads = allItemCodes.map(code => ({
      kode: code,
      nama_barang: code === '-' ? 'GENERAL ITEM' : code,
      group_name: 'Umum',
      harga_jual: 0,
      harga_beli: 0
    }));
    for (let i = 0; i < missingMasterPayloads.length; i += 1000) {
      await supabase.from('master_item').upsert(missingMasterPayloads.slice(i, i + 1000), { onConflict: 'kode', ignoreDuplicates: true });
    }
  }

  const payload = records.map(r => ({
    posting_date: r.postingDate,
    document_no: r.documentNo,
    item_code: r.itemCode || '-',
    category: r.category,
    qty: r.qty,
    from_location: r.fromLocation,
    to_location: r.toLocation,
    entry_remark: r.remark || r.entryName || '',
    aksi: 'KELUAR',
    created_at: new Date().toISOString()
  }));

  const CHUNK_SIZE = 1000;
  const CONCURRENCY = 4;
  let processed = 0;

  for (let i = 0; i < payload.length; i += CHUNK_SIZE * CONCURRENCY) {
    const promises = [];
    for (let c = 0; c < CONCURRENCY; c++) {
      const start = i + c * CHUNK_SIZE;
      if (start < payload.length) {
        const chunk = payload.slice(start, start + CHUNK_SIZE);
        promises.push(supabase.from('transaksi_keluar').insert(chunk));
      }
    }
    const results = await Promise.all(promises);
    for (const res of results) {
      if (res.error) console.error('Error bulk transaksi_keluar chunk:', res.error.message);
    }
    processed += CHUNK_SIZE * promises.length;
    if (onProgress) onProgress(Math.min(processed, records.length), records.length);
  }

  return true;
}

// ============================================================================
// 5. CRUD OPERATIONS: DO OPEN (do_open)
// ============================================================================
export async function fetchDoOpen(): Promise<DoOpenRecord[]> {
  const data = await fetchAllRowsFromTable('do_open', 'created_at');

  const records = (data || []).map(row => ({
    id: row.id,
    postingDate: row.posting_date || '',
    entryName: row.area_rm_opr || '',
    documentNo: row.document_no || '',
    noDosl: row.no_dosl || row.nodosl || row.noDosl || '',
    itemCode: row.item_code || '',
    category: row.status_do_open || '',
    remark: row.area_spv_opr || '',
    qty: Number(row.qty || 0),
    fromLocation: row.from_location || '',
    toLocation: row.to_location || '',
    keterangan: row.keterangan || '',
    createdAt: row.created_at
  }));

  return deduplicateDoOpen(records);
}

export async function addDoOpen(record: Omit<DoOpenRecord, 'id'>): Promise<boolean> {
  const itemCode = record.itemCode || '-';
  try {
    await supabase.from('master_item').upsert([{
      kode: itemCode,
      nama_barang: itemCode === '-' ? 'GENERAL ITEM' : itemCode,
      group_name: 'Umum',
      harga_jual: 0,
      harga_beli: 0
    }], { onConflict: 'kode', ignoreDuplicates: true });
  } catch (mErr) {
    console.warn('Master item auto-upsert notice:', mErr);
  }

  const payload: Record<string, any> = {
    posting_date: record.postingDate,
    area_rm_opr: record.entryName || '',
    document_no: record.documentNo,
    no_dosl: record.noDosl || '',
    item_code: itemCode,
    status_do_open: record.category,
    area_spv_opr: record.remark || '',
    qty: record.qty,
    from_location: record.fromLocation,
    to_location: record.toLocation,
    keterangan: record.keterangan || '',
    aksi: 'DO_OPEN',
    created_at: new Date().toISOString()
  };

  let { error } = await supabase.from('do_open').insert(payload);

  if (error && error.message && (error.message.includes('schema cache') || error.message.includes('column'))) {
    if (error.message.includes('no_dosl')) delete payload.no_dosl;
    if (error.message.includes('keterangan')) delete payload.keterangan;
    const res2 = await supabase.from('do_open').insert(payload);
    error = res2.error;
  }

  if (error) {
    console.error('Error add do_open:', error.message);
    return false;
  }
  return true;
}

export async function updateDoOpen(id: string, record: Partial<DoOpenRecord>): Promise<boolean> {
  const payload: Record<string, any> = {};
  if (record.postingDate !== undefined) payload.posting_date = record.postingDate;
  if (record.entryName !== undefined) payload.area_rm_opr = record.entryName;
  if (record.documentNo !== undefined) payload.document_no = record.documentNo;
  if (record.noDosl !== undefined) payload.no_dosl = record.noDosl;
  if (record.itemCode !== undefined) {
    payload.item_code = record.itemCode;
    try {
      await supabase.from('master_item').upsert([{
        kode: record.itemCode,
        nama_barang: record.itemCode === '-' ? 'GENERAL ITEM' : record.itemCode,
        group_name: 'Umum',
        harga_jual: 0,
        harga_beli: 0
      }], { onConflict: 'kode', ignoreDuplicates: true });
    } catch (e) {}
  }
  if (record.category !== undefined) payload.status_do_open = record.category;
  if (record.remark !== undefined) payload.area_spv_opr = record.remark;
  if (record.qty !== undefined) payload.qty = record.qty;
  if (record.fromLocation !== undefined) payload.from_location = record.fromLocation;
  if (record.toLocation !== undefined) payload.to_location = record.toLocation;
  if (record.keterangan !== undefined) payload.keterangan = record.keterangan;

  let { error } = await supabase
    .from('do_open')
    .update(payload)
    .eq('id', id);

  if (error && error.message && (error.message.includes('schema cache') || error.message.includes('column'))) {
    if (error.message.includes('no_dosl')) delete payload.no_dosl;
    if (error.message.includes('keterangan')) delete payload.keterangan;
    const res2 = await supabase.from('do_open').update(payload).eq('id', id);
    error = res2.error;
  }

  if (error) {
    console.error('Error update do_open:', error.message);
    return false;
  }
  return true;
}

export async function deleteDoOpen(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('do_open')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error delete do_open:', error.message);
    return false;
  }
  return true;
}

export async function bulkAddOrUpdateDoOpen(
  items: Partial<DoOpenRecord>[],
  onProgress?: (processed: number, total: number) => void
): Promise<{ updatedCount: number; insertedCount: number }> {
  if (!items.length) return { updatedCount: 0, insertedCount: 0 };

  try {
    // 1. Ensure all itemCodes referenced exist in master_item to satisfy foreign key constraint do_open_item_code_fkey
    const allItemCodes = Array.from(new Set(items.map(i => (i.itemCode || '-').toString().trim().toUpperCase()).filter(Boolean)));
    if (allItemCodes.length > 0) {
      const { data: existingMasters } = await supabase
        .from('master_item')
        .select('kode, nama_barang, group_name, harga_jual, harga_beli')
        .in('kode', allItemCodes);

      const existingMasterMap = new Map((existingMasters || []).map(m => [m.kode.toUpperCase(), m]));

      const masterPayloads = allItemCodes.map(code => {
        const sample = items.find(i => (i.itemCode || '').toString().trim().toUpperCase() === code);
        const existing = existingMasterMap.get(code);

        const namaBarang = (sample?.itemName && sample.itemName !== code)
          ? sample.itemName
          : (existing?.nama_barang || (code === '-' ? 'GENERAL ITEM' : code));

        const groupName = (sample?.groupName && sample.groupName !== 'Umum')
          ? sample.groupName
          : (existing?.group_name || 'Umum');

        const hargaJual = Number(sample?.hargaJual) || Number(existing?.harga_jual) || 0;
        const hargaBeli = Number(sample?.hargaBeli) || Number(existing?.harga_beli) || 0;

        return {
          kode: code,
          nama_barang: namaBarang,
          group_name: groupName,
          harga_jual: hargaJual,
          harga_beli: hargaBeli
        };
      });

      for (let i = 0; i < masterPayloads.length; i += 1000) {
        await supabase.from('master_item').upsert(masterPayloads.slice(i, i + 1000), { onConflict: 'kode' });
      }
    }

    const existingRecords = await fetchDoOpen();
    const poolFullMap = new Map<string, DoOpenRecord[]>();
    const poolDocMap = new Map<string, DoOpenRecord[]>();

    (existingRecords || []).forEach(rec => {
      const docKey = (rec.documentNo || '').toString().trim().toUpperCase();
      const itemKey = (rec.itemCode || '').toString().trim().toUpperCase();
      if (docKey) {
        const fullKey = `${docKey}_${itemKey}`;
        const list = poolFullMap.get(fullKey) || [];
        list.push(rec);
        poolFullMap.set(fullKey, list);

        const docList = poolDocMap.get(docKey) || [];
        docList.push(rec);
        poolDocMap.set(docKey, docList);
      }
    });

    let updatedCount = 0;
    let insertedCount = 0;
    const toUpdatePayloads: any[] = [];
    const toInsertPayloads: any[] = [];

    for (const item of items) {
      const docNoKey = (item.documentNo || '').toString().trim().toUpperCase();
      const itemCodeKey = (item.itemCode || '').toString().trim().toUpperCase();
      if (!docNoKey) continue;

      const fullKey = `${docNoKey}_${itemCodeKey}`;
      let matchedRecord: DoOpenRecord | null = null;

      // 1. Try exact match by DocumentNo + ItemCode
      if (itemCodeKey && itemCodeKey !== '-') {
        const list = poolFullMap.get(fullKey);
        if (list && list.length > 0) {
          matchedRecord = list.shift()!;
          const docList = poolDocMap.get(docNoKey);
          if (docList) {
            const idx = docList.findIndex(r => r.id === matchedRecord!.id);
            if (idx >= 0) docList.splice(idx, 1);
          }
        }
      }

      // 2. Fallback match by DocumentNo ONLY if no exact match was found
      if (!matchedRecord) {
        const docList = poolDocMap.get(docNoKey);
        if (docList && docList.length > 0) {
          matchedRecord = docList.shift()!;
          const recItemKey = (matchedRecord.itemCode || '').toString().trim().toUpperCase();
          const fk = `${docNoKey}_${recItemKey}`;
          const list = poolFullMap.get(fk);
          if (list) {
            const idx = list.findIndex(r => r.id === matchedRecord.id);
            if (idx >= 0) list.splice(idx, 1);
          }
        }
      }

      if (matchedRecord) {
        // Update matched record via bulk upsert payload
        const updatePayload: Record<string, any> = {
          id: matchedRecord.id
        };
        if (item.category) updatePayload.status_do_open = item.category;
        if (item.remark && item.remark !== '-') updatePayload.area_spv_opr = item.remark;
        if (item.postingDate) updatePayload.posting_date = item.postingDate;
        if (item.noDosl && item.noDosl !== '-') updatePayload.no_dosl = item.noDosl;
        if (item.qty !== undefined && item.qty >= 0) updatePayload.qty = item.qty;
        if (item.fromLocation && item.fromLocation !== '-') updatePayload.from_location = item.fromLocation;
        if (item.toLocation && item.toLocation !== '-') updatePayload.to_location = item.toLocation;
        if (item.keterangan && item.keterangan !== '-') updatePayload.keterangan = item.keterangan;
        if (item.entryName && item.entryName !== 'System') updatePayload.area_rm_opr = item.entryName;
        if (item.itemCode && item.itemCode !== '-') updatePayload.item_code = item.itemCode;

        if (Object.keys(updatePayload).length > 1) {
          toUpdatePayloads.push(updatePayload);
        }
      } else {
        // Insert new line item for DO OPEN
        toInsertPayloads.push({
          id: generateUUID(),
          posting_date: item.postingDate || new Date().toISOString().split('T')[0],
          area_rm_opr: item.entryName || 'System',
          document_no: item.documentNo,
          no_dosl: item.noDosl || '-',
          item_code: item.itemCode || '-',
          status_do_open: item.category || 'DO SUDAH DI LOGISTIK',
          area_spv_opr: item.remark || '-',
          qty: item.qty || 0,
          from_location: item.fromLocation || '-',
          to_location: item.toLocation || '-',
          keterangan: item.keterangan || '-',
          aksi: 'DO_OPEN',
          created_at: new Date().toISOString()
        });
      }
    }

    // Ensure all referenced item codes exist in master_item to satisfy FK constraints
    const extraCodes = Array.from(new Set(
      toInsertPayloads.map(i => (i.item_code || '-').toString().trim().toUpperCase())
        .concat(toUpdatePayloads.map(u => (u.item_code || '-').toString().trim().toUpperCase()))
        .filter(Boolean)
    ));
    if (extraCodes.length > 0) {
      const extraPayloads = extraCodes.map(code => ({
        kode: code,
        nama_barang: code === '-' ? 'GENERAL ITEM' : code,
        group_name: 'Umum',
        harga_jual: 0,
        harga_beli: 0
      }));
      for (let i = 0; i < extraPayloads.length; i += 1000) {
        await supabase.from('master_item').upsert(extraPayloads.slice(i, i + 1000), { onConflict: 'kode', ignoreDuplicates: true });
      }
    }

    // Process bulk updates in chunks
    const CHUNK_SIZE = 500;
    const CONCURRENCY = 3;

    if (toUpdatePayloads.length > 0) {
      for (let i = 0; i < toUpdatePayloads.length; i += CHUNK_SIZE * CONCURRENCY) {
        const batchChunks: { chunk: any[] }[] = [];
        const promises = [];
        for (let c = 0; c < CONCURRENCY; c++) {
          const start = i + c * CHUNK_SIZE;
          if (start < toUpdatePayloads.length) {
            const chunk = toUpdatePayloads.slice(start, start + CHUNK_SIZE);
            batchChunks.push({ chunk });
            promises.push(supabase.from('do_open').upsert(chunk, { onConflict: 'id' }));
          }
        }
        const results = await Promise.all(promises);
        results.forEach((res, idx) => {
          if (!res.error) {
            updatedCount += batchChunks[idx].chunk.length;
          } else {
            console.error('Error in bulk update do_open chunk:', res.error.message);
          }
        });
        if (onProgress) onProgress(Math.min(updatedCount, items.length), items.length);
      }
      updatedCount = Math.min(updatedCount, toUpdatePayloads.length);
    }

    // Process bulk inserts in chunks
    if (toInsertPayloads.length > 0) {
      for (let i = 0; i < toInsertPayloads.length; i += CHUNK_SIZE * CONCURRENCY) {
        const batchChunks: { chunk: any[] }[] = [];
        const promises = [];
        for (let c = 0; c < CONCURRENCY; c++) {
          const start = i + c * CHUNK_SIZE;
          if (start < toInsertPayloads.length) {
            const chunk = toInsertPayloads.slice(start, start + CHUNK_SIZE);
            batchChunks.push({ chunk });
            promises.push(supabase.from('do_open').insert(chunk));
          }
        }
        const results = await Promise.all(promises);
        results.forEach((res, idx) => {
          if (!res.error) {
            insertedCount += batchChunks[idx].chunk.length;
          } else {
            console.error('Error in bulk insert do_open chunk:', res.error.message);
          }
        });
        if (onProgress) onProgress(Math.min(updatedCount + insertedCount, items.length), items.length);
      }
      insertedCount = Math.min(insertedCount, toInsertPayloads.length);
    }

    return { updatedCount, insertedCount };
  } catch (err: any) {
    console.error('Error bulkAddOrUpdateDoOpen Supabase:', err);
    return { updatedCount: 0, insertedCount: 0 };
  }
}

// ============================================================================
// 6. CRUD OPERATIONS: REQUEST DO OPEN (request_do_open)
// ============================================================================
export function isUuid(val?: string): boolean {
  return !!val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function fetchRequestDoOpen(): Promise<RequestDoRecord[]> {
  const data = await fetchAllRowsFromTable('request_do_open', 'created_at');

  const records = (data || []).map(row => ({
    id: row.id,
    doOpenId: row.id,
    postingDate: row.tanggal_request || '',
    entryName: row.area_rm_opr || '',
    documentNo: row.document_no || '',
    itemCode: row.item_code || '',
    category: 'DO_OPEN',
    remark: row.area_spv_opr || '',
    qty: Number(row.qty || 0),
    fromLocation: '',
    toLocation: row.to_location || '',
    requestedBy: row.pengajuan || '',
    requestedAt: row.created_at || '',
    status: (row.status_approval as 'PENDING' | 'APPROVED' | 'REJECTED') || 'PENDING',
    approvedBy: row.aksi_pic_gudang || undefined,
    approvedAt: row.created_at || undefined,
    rejectionReason: row.aksi_pic_gudang || undefined
  }));

  return deduplicateRequestDoOpen(records);
}

export async function addRequestDoOpen(record: Omit<RequestDoRecord, 'id'> & { id?: string }): Promise<boolean> {
  const recordId = isUuid(record.id) ? record.id : generateUUID();
  const { error } = await supabase
    .from('request_do_open')
    .insert({
      id: recordId,
      tanggal_request: record.postingDate || new Date().toISOString().split('T')[0],
      document_no: record.documentNo,
      item_code: record.itemCode,
      qty: record.qty,
      area_rm_opr: record.entryName || '',
      area_spv_opr: record.remark || '',
      to_location: record.toLocation,
      pengajuan: record.requestedBy || 'OPR',
      status_approval: record.status || 'PENDING',
      aksi_pic_gudang: '',
      created_at: new Date().toISOString()
    });

  if (error) {
    console.error('Error add request_do_open:', error.message);
    return false;
  }
  return true;
}

export async function bulkAddRequestDoOpen(records: (Omit<RequestDoRecord, 'id'> & { id?: string })[]): Promise<boolean> {
  if (!records.length) return true;
  const nowStr = new Date().toISOString();
  const todayStr = nowStr.split('T')[0];

  const payload = records.map(record => ({
    id: isUuid(record.id) ? record.id! : generateUUID(),
    tanggal_request: record.postingDate || todayStr,
    document_no: record.documentNo,
    item_code: record.itemCode,
    qty: Number(record.qty) || 0,
    area_rm_opr: record.entryName || '',
    area_spv_opr: record.remark || '',
    to_location: record.toLocation || '',
    pengajuan: record.requestedBy || 'OPR',
    status_approval: record.status || 'PENDING',
    aksi_pic_gudang: '',
    created_at: nowStr
  }));

  for (let i = 0; i < payload.length; i += 500) {
    const chunk = payload.slice(i, i + 500);
    const { error } = await supabase.from('request_do_open').upsert(chunk, { onConflict: 'id', ignoreDuplicates: true });
    if (error) {
      console.error('Error bulk add request_do_open:', error.message);
      return false;
    }
  }
  return true;
}

export async function updateRequestDoOpenStatus(id: string, status: 'APPROVED' | 'REJECTED', picAction: string, documentNo?: string): Promise<boolean> {
  const targetCol = isUuid(id) ? 'id' : 'document_no';
  const targetVal = isUuid(id) ? id : (documentNo || id);

  const { error } = await supabase
    .from('request_do_open')
    .update({
      status_approval: status,
      aksi_pic_gudang: picAction
    })
    .eq(targetCol, targetVal);

  if (error) {
    console.error('Error update request_do_open status:', error.message);
    return false;
  }
  return true;
}

export async function deleteRequestDoOpen(id: string, documentNo?: string): Promise<boolean> {
  const targetCol = isUuid(id) ? 'id' : 'document_no';
  const targetVal = isUuid(id) ? id : (documentNo || id);

  const { error } = await supabase
    .from('request_do_open')
    .delete()
    .eq(targetCol, targetVal);

  if (error) {
    console.error('Error delete request_do_open:', error.message);
    return false;
  }
  return true;
}

// ============================================================================
// 7. REAL-TIME SUBSCRIPTION: TRANSAKSI MASUK
// ============================================================================
/**
 * Langganan Real-Time perubahan data pada tabel transaksi_masuk di Supabase
 * @param onUpdate Callback function yang dipanggil setiap ada data Masuk baru / terupdate / terhapus
 * @returns Unsubscribe function untuk menghentikan listener
 */
export function subscribeTransaksiMasuk(onUpdate: () => void) {
  const channel = supabase
    .channel('public:transaksi_masuk_changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'transaksi_masuk' },
      (payload) => {
        console.log('Real-time update transaksi_masuk received:', payload.eventType);
        onUpdate();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ============================================================================
// 8. QUERY SISA STOK: sisa_stok = sum(masuk) - sum(keluar)
// ============================================================================
export interface SisaStokResult {
  itemCode: string;
  totalMasuk: number;
  totalKeluar: number;
  sisaStok: number;
}

/**
 * Menghitung sisa stok barang untuk 1 Kode Item secara langsung dari Supabase
 * sisa_stok = sum(masuk) - sum(keluar)
 */
export async function getSisaStokByItemCode(itemCode: string): Promise<SisaStokResult> {
  // Sum Transaksi Masuk
  const { data: masukData } = await supabase
    .from('transaksi_masuk')
    .select('qty')
    .eq('item_code', itemCode);

  const totalMasuk = (masukData || []).reduce((acc, row) => acc + (Number(row.qty) || 0), 0);

  // Sum Transaksi Keluar
  const { data: keluarData } = await supabase
    .from('transaksi_keluar')
    .select('qty')
    .eq('item_code', itemCode);

  const totalKeluar = (keluarData || []).reduce((acc, row) => acc + (Number(row.qty) || 0), 0);

  const sisaStok = totalMasuk - totalKeluar;

  return {
    itemCode,
    totalMasuk,
    totalKeluar,
    sisaStok
  };
}

/**
 * Mengambil data Sisa Stock langsung dari View SQL "sisa_stock" di Supabase
 */
export async function fetchSisaStockView() {
  const { data, error } = await supabase
    .from('sisa_stock')
    .select('*');

  if (error) {
    console.error('Error fetch sisa_stock view:', error.message);
    return [];
  }
  return data;
}

/**
 * Mengambil data Rekonsiliasi Stock dari View SQL "rekonsiliasi_stock" di Supabase
 */
export async function fetchRekonsiliasiStockView() {
  const { data, error } = await supabase
    .from('rekonsiliasi_stock')
    .select('*');

  if (error) {
    console.error('Error fetch rekonsiliasi_stock view:', error.message);
    return [];
  }
  return data;
}

// ============================================================================
// 9. USERS / USER ROLE MANAGEMENT (users)
// ============================================================================
export async function verifyLoginSupabase(p_nik: string, p_password: string): Promise<AppUser | null> {
  const cleanNik = p_nik.trim().toLowerCase();
  try {
    const { data, error } = await supabase.rpc('verify_login', {
      p_nik: cleanNik,
      p_password: p_password
    });

    if (error) {
      console.warn('Error verify_login RPC:', error.message);
      return null;
    }

    if (!data) return null;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;

    return {
      id: row.id || row.nik || cleanNik,
      nik: row.nik || cleanNik,
      displayName: row.nama_lengkap || row.display_name || row.displayName || row.nik || cleanNik,
      password: row.password || p_password,
      role: row.role || 'Team Gudang',
      isApproved: row.is_approved !== undefined ? Boolean(row.is_approved) : (row.isApproved !== undefined ? Boolean(row.isApproved) : true),
      createdAt: row.created_at || row.createdAt
    };
  } catch (err: any) {
    console.warn('Exception in verifyLoginSupabase RPC:', err);
    return null;
  }
}

export async function fetchUsersSupabase(): Promise<AppUser[]> {
  const data = await fetchAllRowsFromTable('users', 'created_at');

  return (data || []).map(u => ({
    id: u.nik,
    nik: u.nik,
    displayName: u.nama_lengkap || u.displayName || u.nik,
    password: u.password,
    role: u.role,
    isApproved: u.is_approved !== undefined ? Boolean(u.is_approved) : (u.isApproved !== undefined ? Boolean(u.isApproved) : false),
    createdAt: u.created_at || u.createdAt
  }));
}

export async function addUserSupabase(user: { nik: string; displayName: string; password?: string; role: string; isApproved: boolean }): Promise<boolean> {
  const cleanNik = user.nik.trim().toLowerCase();
  const payload = {
    nik: cleanNik,
    nama_lengkap: user.displayName,
    password: user.password || '',
    role: user.role,
    is_approved: user.isApproved,
    created_at: new Date().toISOString()
  };

  const { error } = await supabase.from('users').insert(payload);
  if (error) {
    console.warn('Notice insert user to Supabase:', error.message);
    // Fallback: update if existing record with same NIK
    await supabase.from('users').update({
      nama_lengkap: user.displayName,
      password: user.password || '',
      role: user.role,
      is_approved: user.isApproved
    }).eq('nik', cleanNik);
    return false;
  }
  return true;
}

export async function approveUserSupabase(nik: string, isApproved: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('users')
    .update({ is_approved: isApproved })
    .eq('nik', nik);

  if (error) {
    console.error('Error approve user:', error.message);
    return false;
  }
  return true;
}

export async function deleteUserSupabase(nik: string): Promise<boolean> {
  const { error } = await supabase
    .from('users')
    .delete()
    .eq('nik', nik);

  if (error) {
    console.error('Error delete user:', error.message);
    return false;
  }
  return true;
}

export async function clearSupabaseTable(tableName: string): Promise<boolean> {
  let { error } = await supabase
    .from(tableName)
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (error) {
    const { error: err2 } = await supabase
      .from(tableName)
      .delete()
      .neq('kode', '__DUMMY_NONE__');
    if (err2) {
      console.error(`Error clear ${tableName}:`, err2.message);
      return false;
    }
  }
  return true;
}

export async function deleteSupabaseRows(tableName: string, keys: string[], keyField: string = 'id'): Promise<boolean> {
  if (!keys || keys.length === 0) return true;
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const { error } = await supabase.from(tableName).delete().in(keyField, chunk);
    if (error) {
      console.error(`Error deleting from ${tableName}:`, error.message);
    }
  }
  return true;
}

// ============================================================================
// 8. CRUD OPERATIONS: CONTAINER STATUS (container_status)
// ============================================================================
export async function fetchContainerStatus(): Promise<ContainerRecord[]> {
  const data = await fetchAllRowsFromTable('container_status', 'created_at');

  if (data === null) {
    // Supabase query failed or table missing -> Fallback to localCache
    return loadLocalCache<ContainerRecord>('container_status');
  }

  const records = data.map(row => {
    let status: ContainerStatusType = 'Container Belum OTW';
    const rawStatus = (row.status_container || row.statusContainer || row.status || '').toString().trim();
    const rawLower = rawStatus.toLowerCase();
    if (rawLower.includes('tiba di bintara') || rawLower.includes('sudah tiba')) {
      status = 'Barang Sudah Tiba di Bintara';
    } else if (rawLower.includes('belum otw') || rawLower.includes('belum')) {
      status = 'Container Belum OTW';
    } else if (rawLower.includes('masih otw') || rawLower.includes('otw')) {
      status = 'Container Masih OTW';
    }

    return {
      id: row.id || `cnt_${Math.random().toString(36).substring(2, 9)}`,
      noContainer: row.no_container || row.noContainer || row.container_no || '',
      category: row.category || row.kategori || '',
      tglTibaPriuk: row.tgl_tiba_priuk || row.tglTibaPriuk || row.tiba_priuk || '',
      tglTibaBintara: row.tgl_tiba_bintara || row.tglTibaBintara || row.tiba_bintara || '',
      itemCategoryBarang: row.item_category_barang || row.itemCategoryBarang || row.category_barang || '',
      statusContainer: status,
      totalQty: Number(row.total_qty || row.totalQty || row.qty || 0),
      totalCost: Number(row.total_cost || row.totalCost || row.cost || row.nilai_cost || 0),
      totalPrice: Number(row.total_price || row.totalPrice || row.price || row.nilai_price || 0),
      remark: row.remark || row.keterangan || '',
      createdAt: row.created_at || row.createdAt || ''
    };
  });

  saveLocalCache('container_status', records, true);
  return records;
}

export async function addContainerStatus(record: Omit<ContainerRecord, 'id'>): Promise<boolean> {
  const newId = `cnt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const payload = {
    no_container: record.noContainer,
    category: record.category || '',
    tgl_tiba_priuk: record.tglTibaPriuk || '',
    tgl_tiba_bintara: record.tglTibaBintara || '',
    item_category_barang: record.itemCategoryBarang || '',
    status_container: record.statusContainer,
    total_qty: record.totalQty || 0,
    total_cost: record.totalCost || 0,
    total_price: record.totalPrice || 0,
    remark: record.remark || '',
    created_at: new Date().toISOString()
  };

  const { error } = await supabase.from('container_status').insert(payload);
  if (error) {
    console.warn('Insert container_status ke Supabase error/exists, mencoba update jika no_container ada:', error.message);
    await supabase.from('container_status').update(payload).eq('no_container', record.noContainer);
  }

  // Always sync local cache for smooth user experience
  const existing = loadLocalCache<ContainerRecord>('container_status');
  const filtered = existing.filter(e => e.noContainer.toUpperCase() !== record.noContainer.toUpperCase());
  const newRecord: ContainerRecord = { id: newId, ...record, createdAt: new Date().toISOString() };
  saveLocalCache('container_status', [newRecord, ...filtered], true);

  return true;
}

export async function updateContainerStatus(id: string, record: Partial<ContainerRecord>): Promise<boolean> {
  const payload: Record<string, any> = {};
  if (record.noContainer !== undefined) payload.no_container = record.noContainer;
  if (record.category !== undefined) payload.category = record.category;
  if (record.tglTibaPriuk !== undefined) payload.tgl_tiba_priuk = record.tglTibaPriuk;
  if (record.tglTibaBintara !== undefined) payload.tgl_tiba_bintara = record.tglTibaBintara;
  if (record.itemCategoryBarang !== undefined) payload.item_category_barang = record.itemCategoryBarang;
  if (record.statusContainer !== undefined) payload.status_container = record.statusContainer;
  if (record.totalQty !== undefined) payload.total_qty = record.totalQty;
  if (record.totalCost !== undefined) payload.total_cost = record.totalCost;
  if (record.totalPrice !== undefined) payload.total_price = record.totalPrice;
  if (record.remark !== undefined) payload.remark = record.remark;

  const { error: err1 } = await supabase.from('container_status').update(payload).eq('id', id);
  if (err1 || record.noContainer) {
    const existingList = loadLocalCache<ContainerRecord>('container_status');
    const matched = existingList.find(c => c.id === id);
    const targetNo = record.noContainer || (matched ? matched.noContainer : '');
    if (targetNo) {
      await supabase.from('container_status').update(payload).eq('no_container', targetNo);
    }
  }

  // Always sync local cache
  const existing = loadLocalCache<ContainerRecord>('container_status');
  const updated = existing.map(item => item.id === id ? { ...item, ...record } : item);
  saveLocalCache('container_status', updated, true);

  return true;
}

export async function deleteContainerStatus(id: string): Promise<boolean> {
  const existing = loadLocalCache<ContainerRecord>('container_status');
  const target = existing.find(item => item.id === id);

  await supabase.from('container_status').delete().eq('id', id);
  if (target && target.noContainer) {
    await supabase.from('container_status').delete().eq('no_container', target.noContainer);
  }

  const updated = existing.filter(item => item.id !== id);
  saveLocalCache('container_status', updated, true);

  return true;
}

export async function saveBatchContainerStatus(records: Omit<ContainerRecord, 'id'>[]): Promise<{ insertedCount: number; updatedCount: number }> {
  if (!records || records.length === 0) return { insertedCount: 0, updatedCount: 0 };

  let insertedCount = 0;
  let updatedCount = 0;

  try {
    const existingRows = await fetchAllRowsFromTable('container_status', 'created_at');
    const existingSet = new Set<string>();
    if (existingRows) {
      existingRows.forEach(row => {
        const noCnt = (row.no_container || row.noContainer || row.container_no || '').toString().trim().toUpperCase();
        if (noCnt) existingSet.add(noCnt);
      });
    }

    for (const r of records) {
      const cleanNo = (r.noContainer || '').toString().trim().toUpperCase();
      if (!cleanNo) continue;

      const payload = {
        no_container: r.noContainer,
        category: r.category || 'IMPORT',
        tgl_tiba_priuk: r.tglTibaPriuk || '',
        tgl_tiba_bintara: r.tglTibaBintara || '',
        item_category_barang: r.itemCategoryBarang || '',
        status_container: r.statusContainer,
        total_qty: r.totalQty || 0,
        total_cost: r.totalCost || 0,
        total_price: r.totalPrice || 0,
        remark: r.remark || '',
        created_at: new Date().toISOString()
      };

      if (existingSet.has(cleanNo)) {
        const { error } = await supabase.from('container_status').update(payload).eq('no_container', r.noContainer);
        if (!error) updatedCount++;
      } else {
        const { error } = await supabase.from('container_status').insert(payload);
        if (!error) {
          insertedCount++;
          existingSet.add(cleanNo);
        } else {
          await supabase.from('container_status').update(payload).eq('no_container', r.noContainer);
          updatedCount++;
        }
      }
    }
  } catch (err: any) {
    console.warn('Batch container sync to Supabase error/warning:', err.message);
  }

  // Sync Local Cache
  const existingCache = loadLocalCache<ContainerRecord>('container_status');
  const cacheMap = new Map<string, ContainerRecord>();
  existingCache.forEach(c => cacheMap.set(c.noContainer.toUpperCase(), c));

  records.forEach((r, i) => {
    const key = r.noContainer.toUpperCase();
    const prev = cacheMap.get(key);
    cacheMap.set(key, {
      id: prev?.id || `cnt_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 5)}`,
      ...r,
      createdAt: prev?.createdAt || new Date().toISOString()
    });
  });

  const updatedCache = Array.from(cacheMap.values());
  saveLocalCache('container_status', updatedCache, true);

  return { insertedCount, updatedCount };
}

/**
 * Cleans up duplicate records in Supabase tables (transaksi_masuk, transaksi_keluar, do_open)
 * Keeps the first instance and deletes all duplicate rows based on exact content match.
 */
export async function cleanupDuplicateTransactionsInSupabase(): Promise<{ deletedMasuk: number; deletedKeluar: number; deletedDoOpen: number }> {
  let deletedMasuk = 0;
  let deletedKeluar = 0;
  let deletedDoOpen = 0;

  try {
    // 1. Clean transaksi_masuk
    const masukRows = await fetchAllRowsFromTable('transaksi_masuk', 'created_at');
    if (masukRows && masukRows.length > 0) {
      const seenMap = new Map<string, string>();
      const duplicateIds: string[] = [];

      for (const row of masukRows) {
        const docNo = (row.document_no || '').trim().toUpperCase();
        const itemCode = (row.item_code || '').trim().toUpperCase();
        const date = (row.posting_date || '').slice(0, 10);
        const qty = row.qty || 0;
        const fromLoc = (row.from_location || '').trim().toUpperCase();
        const toLoc = (row.to_location || '').trim().toUpperCase();

        const sig = `${docNo}_${itemCode}_${date}_${qty}_${fromLoc}_${toLoc}`;
        if (seenMap.has(sig)) {
          duplicateIds.push(row.id);
        } else {
          seenMap.set(sig, row.id);
        }
      }

      if (duplicateIds.length > 0) {
        for (let i = 0; i < duplicateIds.length; i += 100) {
          const chunk = duplicateIds.slice(i, i + 100);
          await supabase.from('transaksi_masuk').delete().in('id', chunk);
        }
        deletedMasuk = duplicateIds.length;
        console.log(`[Deduplicate Supabase] Deleted ${deletedMasuk} duplicate rows from transaksi_masuk`);
      }
    }

    // 2. Clean transaksi_keluar
    const keluarRows = await fetchAllRowsFromTable('transaksi_keluar', 'created_at');
    if (keluarRows && keluarRows.length > 0) {
      const seenMap = new Map<string, string>();
      const duplicateIds: string[] = [];

      for (const row of keluarRows) {
        const docNo = (row.document_no || '').trim().toUpperCase();
        const itemCode = (row.item_code || '').trim().toUpperCase();
        const date = (row.posting_date || '').slice(0, 10);
        const qty = row.qty || 0;
        const fromLoc = (row.from_location || '').trim().toUpperCase();
        const toLoc = (row.to_location || '').trim().toUpperCase();

        const sig = `${docNo}_${itemCode}_${date}_${qty}_${fromLoc}_${toLoc}`;
        if (seenMap.has(sig)) {
          duplicateIds.push(row.id);
        } else {
          seenMap.set(sig, row.id);
        }
      }

      if (duplicateIds.length > 0) {
        for (let i = 0; i < duplicateIds.length; i += 100) {
          const chunk = duplicateIds.slice(i, i + 100);
          await supabase.from('transaksi_keluar').delete().in('id', chunk);
        }
        deletedKeluar = duplicateIds.length;
        console.log(`[Deduplicate Supabase] Deleted ${deletedKeluar} duplicate rows from transaksi_keluar`);
      }
    }

    // 3. Clean do_open duplicates (same document_no & item_code, or same document_no if item_code is empty)
    const doRows = await fetchAllRowsFromTable('do_open', 'created_at');
    if (doRows && doRows.length > 0) {
      const retainedMap = new Map<string, any>();
      const updatedRowsMap = new Map<string, any>();
      const duplicateIds: string[] = [];

      for (const row of doRows) {
        const docNo = (row.document_no || '').trim().toUpperCase();
        const itemCode = (row.item_code || '').trim().toUpperCase();

        if (docNo) {
          const sig = itemCode && itemCode !== '-' ? `${docNo}_${itemCode}` : docNo;
          if (retainedMap.has(sig)) {
            const retained = retainedMap.get(sig);
            retained.qty = (Number(retained.qty) || 0) + (Number(row.qty) || 0);
            updatedRowsMap.set(retained.id, retained);
            duplicateIds.push(row.id);
          } else {
            retainedMap.set(sig, { ...row });
          }
        }
      }

      for (const [id, updatedRow] of updatedRowsMap.entries()) {
        await supabase.from('do_open').update({ qty: updatedRow.qty }).eq('id', id);
      }

      if (duplicateIds.length > 0) {
        for (let i = 0; i < duplicateIds.length; i += 100) {
          const chunk = duplicateIds.slice(i, i + 100);
          await supabase.from('do_open').delete().in('id', chunk);
        }
        deletedDoOpen = duplicateIds.length;
        console.log(`[Deduplicate Supabase] Merged Qty and deleted ${deletedDoOpen} duplicate rows from do_open`);
      }
    }
  } catch (err) {
    console.error('Error in cleanupDuplicateTransactionsInSupabase:', err);
  }

  return { deletedMasuk, deletedKeluar, deletedDoOpen };
}

/**
 * Menyinkronkan seluruh data status container dari memori/lokal ke tabel Supabase SQL (container_status)
 */
export async function syncAllContainerStatusToSupabase(records: ContainerRecord[]): Promise<{ success: boolean; total: number; inserted: number; updated: number; message: string }> {
  if (!records || records.length === 0) {
    return { success: true, total: 0, inserted: 0, updated: 0, message: 'Tidak ada data container untuk disinkronkan.' };
  }

  try {
    const preparedRecords: Omit<ContainerRecord, 'id'>[] = records.map(r => ({
      noContainer: r.noContainer,
      category: r.category,
      tglTibaPriuk: r.tglTibaPriuk,
      tglTibaBintara: r.tglTibaBintara,
      itemCategoryBarang: r.itemCategoryBarang,
      statusContainer: r.statusContainer,
      totalQty: r.totalQty,
      totalCost: r.totalCost,
      totalPrice: r.totalPrice,
      remark: r.remark
    }));

    const result = await saveBatchContainerStatus(preparedRecords);

    // Re-fetch from Supabase to confirm synchronization
    const latestFromSupabase = await fetchContainerStatus();
    if (latestFromSupabase && latestFromSupabase.length > 0) {
      saveLocalCache('container_status', latestFromSupabase, true);
    }

    return {
      success: true,
      total: records.length,
      inserted: result.insertedCount,
      updated: result.updatedCount,
      message: `Berhasil menyinkronkan ${records.length} data container ke Supabase SQL (${result.insertedCount} baru, ${result.updatedCount} terupdate).`
    };
  } catch (err: any) {
    console.error('Error syncAllContainerStatusToSupabase:', err);
    return {
      success: false,
      total: records.length,
      inserted: 0,
      updated: 0,
      message: `Gagal sinkronisasi: ${err.message}`
    };
  }
}

// ============================================================================
// 10. CRUD OPERATIONS: KATALOG FOTO BARANG (katalog_foto)
// ============================================================================
export async function fetchCatalogPhotosSupabase(): Promise<ItemCatalogPhoto[]> {
  const possibleTables = ['katalog_foto', 'item_photos', 'catalog_photos', 'photos'];
  let rawData: any[] = [];

  for (const tName of possibleTables) {
    try {
      let page = 0;
      let pageSize = 20; // Small page size to prevent base64 payload size errors in HTTP response
      let hasMore = true;
      let tableRows: any[] = [];

      while (hasMore && page < 200) {
        const from = page * pageSize;
        const to = from + pageSize - 1;

        let res = await supabase.from(tName).select('*').range(from, to);
        if (res.error && pageSize > 5) {
          // If page fetch failed, retry with smaller chunk size (5 items)
          console.warn(`[Supabase Catalog Photos] Retrying table '${tName}' with smaller page size...`);
          pageSize = 5;
          const retryFrom = page * pageSize;
          const retryTo = retryFrom + pageSize - 1;
          res = await supabase.from(tName).select('*').range(retryFrom, retryTo);
        }

        if (res.error) {
          console.warn(`[Supabase Catalog Photos] Notice fetching from '${tName}' page ${page}:`, res.error.message);
          if (tableRows.length > 0) break;
          page++;
          continue;
        }

        if (res.data && res.data.length > 0) {
          tableRows = tableRows.concat(res.data);
          if (res.data.length < pageSize) {
            hasMore = false;
          } else {
            page++;
          }
        } else {
          hasMore = false;
        }
      }

      if (tableRows.length > 0) {
        rawData = tableRows;
        console.log(`[Supabase Catalog Photos] Successfully fetched ${tableRows.length} records from table '${tName}'`);
        break;
      }
    } catch (err) {
      console.warn(`[Supabase Catalog Photos] Try table '${tName}' error:`, err);
    }
  }

  const supabasePhotos: ItemCatalogPhoto[] = (rawData || []).map((row, idx) => {
    const rawPhoto = row.photo_url || row.photoUrl || row.photo || row.foto_url || row.fotoUrl || row.foto || row.photo_data || row.image || row.image_url || row.photourl || row.url || row.data || '';
    const photoUrl = (rawPhoto && String(rawPhoto).trim() !== 'null' && String(rawPhoto).trim() !== 'undefined') ? String(rawPhoto).trim() : '';
    const itemCode = String(
      row.item_code || row.itemCode || row.kode || row.kode_barang || row.kodebarang || row.item_id || row.itemId || ''
    ).trim();
    const itemName = String(
      row.item_name || row.itemName || row.nama_barang || row.namabarang || ''
    ).trim();
    const groupName = String(
      row.group_name || row.groupName || row.kategori || row.group || ''
    ).trim();
    const id = row.id 
      ? String(row.id) 
      : (row.id_foto ? String(row.id_foto) : `photo_${itemCode || 'item'}_${idx}_${Math.random().toString(36).substring(2, 6)}`);

    return {
      id: String(id),
      itemCode,
      itemName,
      groupName,
      photoUrl,
      notes: row.notes || row.keterangan || '',
      createdAt: row.created_at || row.createdAt || new Date().toISOString()
    };
  }).filter(p => p.photoUrl);

  const localCached = loadLocalCache('katalog_foto') || [];
  const idbCached = await loadCatalogPhotosIndexedDB();
  const mergedMap = new Map<string, ItemCatalogPhoto>();

  const addPhotoToMap = (p: ItemCatalogPhoto) => {
    if (!p || !p.photoUrl) return;
    const key = p.id || `${(p.itemCode || 'NO_CODE').trim().toUpperCase()}___${(p.photoUrl || '').trim().slice(-80)}`;
    mergedMap.set(key, p);
  };

  localCached.forEach(addPhotoToMap);
  idbCached.forEach(addPhotoToMap);
  supabasePhotos.forEach(addPhotoToMap);

  const finalPhotos = Array.from(mergedMap.values());
  if (finalPhotos.length > 0) {
    saveLocalCache('katalog_foto', finalPhotos, true);
  }
  return finalPhotos;
}

// Helper to convert Google Drive shareable URLs to direct high-resolution image CDN URLs
export function extractGDriveFileId(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  const fileDMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileDMatch && fileDMatch[1]) return fileDMatch[1];
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch && idParamMatch[1]) return idParamMatch[1];
  const lh3Match = trimmed.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
  if (lh3Match && lh3Match[1]) return lh3Match[1];
  return null;
}

export async function fetchGDriveFileName(urlOrFileId: string): Promise<string | null> {
  const fileId = extractGDriveFileId(urlOrFileId) || urlOrFileId.trim();
  if (!fileId || fileId.length < 10) return null;

  const targetGdriveUrl = `https://drive.google.com/file/d/${fileId}/view`;

  const proxies = [
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetGdriveUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetGdriveUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(targetGdriveUrl)}`
  ];

  for (const proxyUrl of proxies) {
    try {
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const html = await res.text();
        if (html && html.length > 100) {
          const titlePatterns = [
            /<meta\s+property="og:title"\s+content="([^"]+)"/i,
            /<meta\s+name="twitter:title"\s+content="([^"]+)"/i,
            /itemprop="name"\s+content="([^"]+)"/i,
            /"title":"([^"]+)"/i,
            /\[null,"([^"]+\.(?:jpg|jpeg|png|webp|gif|bmp))"/i,
            /<title>([^<]+)<\/title>/i
          ];

          for (const pattern of titlePatterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
              let filename = match[1].replace(/\s*-\s*Google Drive$/i, '').trim();
              if (filename && filename !== 'Google Drive' && !filename.startsWith('Drive - ') && !filename.includes('Virus scan')) {
                const codeWithoutExt = filename.replace(/\.(jpg|jpeg|png|webp|gif|bmp)$/i, '').trim();
                if (codeWithoutExt) {
                  return codeWithoutExt;
                }
              }
            }
          }
        }
      }
    } catch {
      // try next proxy
    }
  }
  return null;
}

export function convertGoogleDriveUrl(url: string): string {
  if (!url) return '';
  const fileId = extractGDriveFileId(url);
  if (fileId) {
    return `https://lh3.googleusercontent.com/d/${fileId}`;
  }
  return url.trim();
}

// Helper to automatically convert heavy Base64 Data URLs into lightweight Supabase Storage Public URLs
export async function uploadBase64ToStorage(base64DataUrl: string, itemCode: string): Promise<string> {
  const formattedUrl = convertGoogleDriveUrl(base64DataUrl);
  if (!formattedUrl || !formattedUrl.startsWith('data:')) {
    return formattedUrl; // Already a HTTP URL, Google Drive URL, or public Storage URL
  }

  try {
    const parts = base64DataUrl.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const bstr = atob(parts[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    const blob = new Blob([u8arr], { type: mime });
    const ext = mime.split('/')[1] || 'jpg';
    const cleanCode = (itemCode || 'item').replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `items/${cleanCode}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('foto-barang')
      .upload(fileName, blob, {
        contentType: mime,
        cacheControl: '31536000', // 1 Year Browser/CDN Cache to minimize Egress
        upsert: true
      });

    if (uploadError) {
      console.warn('Upload base64 ke Storage bucket notice, fallback ke url:', uploadError.message);
      return base64DataUrl;
    }

    const { data } = supabase.storage.from('foto-barang').getPublicUrl(fileName);
    return data.publicUrl || base64DataUrl;
  } catch (err) {
    console.warn('Exception converting base64 to Storage URL:', err);
    return base64DataUrl;
  }
}

export async function upsertCatalogPhotoSupabase(photo: ItemCatalogPhoto): Promise<boolean> {
  const photoId = photo.id || `photo_${photo.itemCode}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  // Convert base64 string to lightweight Storage Public URL before database insert
  const publicUrl = await uploadBase64ToStorage(photo.photoUrl, photo.itemCode);

  const payload = {
    id: photoId,
    item_code: photo.itemCode,
    item_name: photo.itemName || '',
    group_name: photo.groupName || '',
    photo_url: publicUrl,
    photo: publicUrl,
    notes: photo.notes || '',
    created_at: photo.createdAt || new Date().toISOString()
  };

  const { error } = await supabase
    .from('katalog_foto')
    .upsert(payload, { onConflict: 'id' });

  if (error && error.message && (error.message.includes('schema cache') || error.message.includes('table'))) {
    console.warn('Table katalog_foto notice in Supabase, using local cache / Firestore fallback:', error.message);
    return true;
  }

  if (error) {
    console.error('Error upsert katalog_foto:', error.message);
    return false;
  }
  return true;
}

export async function bulkUpsertCatalogPhotosSupabase(photos: ItemCatalogPhoto[]): Promise<boolean> {
  if (!photos.length) return true;

  // Process and upload base64 images to Storage in parallel (concurrency 5)
  const preparedPhotos: ItemCatalogPhoto[] = [];
  for (let i = 0; i < photos.length; i += 5) {
    const chunk = photos.slice(i, i + 5);
    const convertedChunk = await Promise.all(chunk.map(async (p) => {
      const storageUrl = await uploadBase64ToStorage(p.photoUrl, p.itemCode);
      return { ...p, photoUrl: storageUrl };
    }));
    preparedPhotos.push(...convertedChunk);
  }

  const payload = preparedPhotos.map((photo, idx) => ({
    id: photo.id || `photo_${photo.itemCode || 'item'}_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
    item_code: photo.itemCode || '',
    item_name: photo.itemName || '',
    group_name: photo.groupName || '',
    photo_url: photo.photoUrl,
    photo: photo.photoUrl,
    notes: photo.notes || '',
    created_at: photo.createdAt || new Date().toISOString()
  }));

  const CHUNK_SIZE = 10;
  for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
    const chunk = payload.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from('katalog_foto')
      .upsert(chunk, { onConflict: 'id' });

    if (error) {
      console.warn(`[Supabase Photo Upsert] Chunk ${i}-${i + chunk.length} notice: ${error.message}. Retrying items individually...`);
      for (const singleItem of chunk) {
        try {
          await supabase.from('katalog_foto').upsert([singleItem], { onConflict: 'id' });
        } catch (e) {
          console.warn('[Supabase Photo Upsert] Single item retry notice:', e);
        }
      }
    }
  }
  return true;
}

export async function deleteCatalogPhotoSupabase(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('katalog_foto')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error delete katalog_foto:', error.message);
    return false;
  }
  return true;
}

