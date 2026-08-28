/* ============================================================================
   DATA LAYER BARU — REST API ke Express + SQL Server (Fase 5)

   Pengganti src/supabase.ts dan src/firebase.ts untuk SEMUA komponen UI.
   Nama fungsi & bentuk return value SENGAJA identik dengan versi lama
   (lihat CLAUDE.md) supaya komponen di src/views/* dan src/components/*
   tidak perlu diubah — cukup ganti sumber import ke './api' / '../api'.

   File lama (supabase.ts, firebase.ts) dipertahankan sebagai referensi,
   tidak lagi di-import oleh UI.
   ============================================================================ */

import type {
  AppUser,
  MasterItem,
  TransactionRecord,
  DoOpenRecord,
  RequestDoRecord,
  ContainerRecord,
  ItemCatalogPhoto,
} from "./types";
import { loadLocalCache, saveLocalCache } from "./utils/localCache";

// Re-export supaya import lama `from '../supabase'` yang ikut mengambil
// loadLocalCache/saveLocalCache tetap jalan setelah diganti ke '../api'
export { loadLocalCache, saveLocalCache };

// ============================================================================
// HTTP CLIENT + TOKEN
// ============================================================================

const TOKEN_KEY = "gudang_api_token";

export function getApiToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setApiToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage penuh/di-block — abaikan */ }
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  const token = getApiToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });
  let body: any = null;
  try { body = await res.json(); } catch { /* response tanpa body */ }

  if (!res.ok) {
    const message = body?.error || `HTTP ${res.status}`;
    if (res.status === 401) setApiToken(null);
    throw Object.assign(new Error(message), { status: res.status });
  }
  return body;
}

// Wrapper untuk fungsi bergaya lama yang return boolean (bukan throw)
async function tryBool(fn: () => Promise<any>): Promise<boolean> {
  try { await fn(); return true; } catch (e: any) {
    console.warn("[api] operasi gagal:", e?.message || e);
    return false;
  }
}

// ============================================================================
// AUTH & USERS
// ============================================================================

export async function verifyLoginSupabase(p_nik: string, p_password: string): Promise<AppUser | null> {
  try {
    const data = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ nik: p_nik.trim().toLowerCase(), password: p_password }),
    });
    setApiToken(data.token);
    return data.user as AppUser;
  } catch (e: any) {
    console.warn("Login gagal:", e?.message || e);
    return null;
  }
}

export async function fetchUsersSupabase(): Promise<AppUser[]> {
  try { return await apiFetch("/api/users"); } catch { return []; }
}

export async function addUserSupabase(user: { nik: string; displayName: string; password?: string; role: string; isApproved: boolean }): Promise<boolean> {
  // Dipanggil dari 2 konteks: register publik (LoginView, isApproved=false)
  // dan Admin menambah user (UserManagementView)
  const payload = JSON.stringify({
    nik: user.nik,
    displayName: user.displayName,
    password: user.password || "",
    role: user.role,
    isApproved: user.isApproved,
  });
  if (getApiToken()) {
    const ok = await tryBool(() => apiFetch("/api/users", { method: "POST", body: payload }));
    if (ok) return true;
  }
  return tryBool(() => apiFetch("/api/auth/register", { method: "POST", body: payload }));
}

export async function approveUserSupabase(nik: string, isApproved: boolean): Promise<boolean> {
  return tryBool(() =>
    apiFetch(`/api/users/${encodeURIComponent(nik)}/approve`, {
      method: "PATCH",
      body: JSON.stringify({ isApproved }),
    })
  );
}

export async function deleteUserSupabase(nik: string): Promise<boolean> {
  return tryBool(() => apiFetch(`/api/users/${encodeURIComponent(nik)}`, { method: "DELETE" }));
}

export async function resetUserPassword(nik: string, newPassword: string): Promise<boolean> {
  return tryBool(() =>
    apiFetch(`/api/users/${encodeURIComponent(nik)}/reset-password`, {
      method: "PATCH",
      body: JSON.stringify({ newPassword }),
    })
  );
}

export interface LoginAttempt {
  nik: string | null;
  ipAddress: string | null;
  success: boolean;
  failReason: string | null;
  attemptedAt: string;
}
export interface SuspiciousIp {
  ipAddress: string | null;
  failCount: number;
  distinctNikTried: number;
  lastAttempt: string;
}
export async function fetchLoginAttempts(hours = 24): Promise<{
  windowHours: number;
  recentAttempts: LoginAttempt[];
  suspiciousIps: SuspiciousIp[];
}> {
  return apiFetch(`/api/security/login-attempts?hours=${hours}`);
}

// ============================================================================
// MASTER ITEM
// ============================================================================

export async function fetchMasterItems(): Promise<MasterItem[]> {
  try { return await apiFetch("/api/master-items"); } catch { return []; }
}

export async function addMasterItem(item: MasterItem): Promise<boolean> {
  return tryBool(() => apiFetch("/api/master-items", { method: "POST", body: JSON.stringify(item) }));
}

export async function updateMasterItem(itemCode: string, item: Partial<MasterItem>): Promise<boolean> {
  return tryBool(() =>
    apiFetch(`/api/master-items/${encodeURIComponent(itemCode)}`, { method: "PUT", body: JSON.stringify(item) })
  );
}

export async function upsertMasterItem(item: MasterItem): Promise<boolean> {
  return tryBool(() =>
    apiFetch(`/api/master-items/${encodeURIComponent(item.itemCode)}/upsert`, {
      method: "PUT",
      body: JSON.stringify(item),
    })
  );
}

export async function deleteMasterItem(itemCode: string): Promise<boolean> {
  return tryBool(() => apiFetch(`/api/master-items/${encodeURIComponent(itemCode)}`, { method: "DELETE" }));
}

export async function bulkAddMasterItems(
  items: MasterItem[],
  onProgress?: (processed: number, total: number) => void
): Promise<boolean> {
  if (!items.length) return true;
  const ok = await tryBool(() =>
    apiFetch("/api/master-items/bulk", { method: "POST", body: JSON.stringify({ records: items }) })
  );
  if (onProgress) onProgress(items.length, items.length);
  return ok;
}

// ============================================================================
// TRANSAKSI MASUK / KELUAR
// ============================================================================

function transaksiApi(kind: "masuk" | "keluar") {
  const base = `/api/transaksi-${kind}`;
  return {
    fetch: async (): Promise<TransactionRecord[]> => {
      try { return await apiFetch(base); } catch { return []; }
    },
    add: (record: Omit<TransactionRecord, "id">) =>
      tryBool(() => apiFetch(base, { method: "POST", body: JSON.stringify(record) })),
    update: (id: string, record: Partial<TransactionRecord>) =>
      tryBool(() => apiFetch(`${base}/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(record) })),
    remove: (id: string) => tryBool(() => apiFetch(`${base}/${encodeURIComponent(id)}`, { method: "DELETE" })),
    bulkAdd: async (
      records: Omit<TransactionRecord, "id">[],
      onProgress?: (processed: number, total: number) => void
    ): Promise<boolean> => {
      if (!records.length) return true;
      const ok = await tryBool(() => apiFetch(`${base}/bulk`, { method: "POST", body: JSON.stringify({ records }) }));
      if (onProgress) onProgress(records.length, records.length);
      return ok;
    },
  };
}

const masukApi = transaksiApi("masuk");
const keluarApi = transaksiApi("keluar");

export const fetchTransaksiMasuk = masukApi.fetch;
export const addTransaksiMasuk = masukApi.add;
export const updateTransaksiMasuk = masukApi.update;
export const deleteTransaksiMasuk = masukApi.remove;
export const bulkAddTransaksiMasuk = masukApi.bulkAdd;

export const fetchTransaksiKeluar = keluarApi.fetch;
export const addTransaksiKeluar = keluarApi.add;
export const updateTransaksiKeluar = keluarApi.update;
export const deleteTransaksiKeluar = keluarApi.remove;
export const bulkAddTransaksiKeluar = keluarApi.bulkAdd;

// ============================================================================
// DO OPEN
// ============================================================================

export async function fetchDoOpen(): Promise<DoOpenRecord[]> {
  try { return await apiFetch("/api/do-open"); } catch { return []; }
}

export async function addDoOpen(record: Omit<DoOpenRecord, "id">): Promise<boolean> {
  return tryBool(() => apiFetch("/api/do-open", { method: "POST", body: JSON.stringify(record) }));
}

export async function updateDoOpen(id: string, record: Partial<DoOpenRecord>): Promise<boolean> {
  return tryBool(() => apiFetch(`/api/do-open/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(record) }));
}

// Update Keterangan untuk SEMUA baris DoOpen dengan DocumentNo yang sama
// sekaligus — 1 catatan berlaku untuk seluruh No DO, bukan per-item.
export async function updateDoOpenKeteranganByDocumentNo(documentNo: string, keterangan: string): Promise<boolean> {
  return tryBool(() =>
    apiFetch(`/api/do-open/keterangan-by-document/${encodeURIComponent(documentNo)}`, {
      method: "PUT",
      body: JSON.stringify({ keterangan }),
    })
  );
}

export async function deleteDoOpen(id: string): Promise<boolean> {
  return tryBool(() => apiFetch(`/api/do-open/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

export async function bulkAddOrUpdateDoOpen(
  items: Partial<DoOpenRecord>[],
  onProgress?: (processed: number, total: number) => void
): Promise<{ updatedCount: number; insertedCount: number }> {
  if (!items.length) return { updatedCount: 0, insertedCount: 0 };
  try {
    const result = await apiFetch("/api/do-open/bulk-upsert", {
      method: "POST",
      body: JSON.stringify({ records: items }),
    });
    if (onProgress) onProgress(items.length, items.length);
    return { updatedCount: result.updatedCount || 0, insertedCount: result.insertedCount || 0 };
  } catch (e: any) {
    console.warn("bulkAddOrUpdateDoOpen gagal:", e?.message || e);
    return { updatedCount: 0, insertedCount: 0 };
  }
}

// Pengganti autoReconcileDoOpen dari firebase.ts — reconcile dihitung
// set-based di SQL Server, parameter cache lama diabaikan
export async function autoReconcileDoOpen(
  _cachedDoOpen?: DoOpenRecord[],
  _cachedKeluar?: TransactionRecord[]
): Promise<{ deletedCount: number; deletedDocs: string[]; deletedIds: string[] }> {
  try {
    return await apiFetch("/api/do-open/reconcile", { method: "POST" });
  } catch (e: any) {
    console.warn("autoReconcileDoOpen gagal:", e?.message || e);
    return { deletedCount: 0, deletedDocs: [], deletedIds: [] };
  }
}

export async function cleanupDuplicateTransactionsInSupabase(): Promise<{ deletedMasuk: number; deletedKeluar: number; deletedDoOpen: number }> {
  try {
    return await apiFetch("/api/do-open/cleanup-duplicates", { method: "POST" });
  } catch {
    return { deletedMasuk: 0, deletedKeluar: 0, deletedDoOpen: 0 };
  }
}

// ============================================================================
// REQUEST DO OPEN
// ============================================================================

export async function fetchRequestDoOpen(): Promise<RequestDoRecord[]> {
  try { return await apiFetch("/api/request-do-open"); } catch { return []; }
}

export async function addRequestDoOpen(record: Omit<RequestDoRecord, "id"> & { id?: string }): Promise<boolean> {
  return tryBool(() => apiFetch("/api/request-do-open", { method: "POST", body: JSON.stringify(record) }));
}

export async function bulkAddRequestDoOpen(records: (Omit<RequestDoRecord, "id"> & { id?: string })[]): Promise<boolean> {
  if (!records.length) return true;
  return tryBool(() => apiFetch("/api/request-do-open/bulk", { method: "POST", body: JSON.stringify({ records }) }));
}

export async function updateRequestDoOpenStatus(
  id: string,
  status: "APPROVED" | "REJECTED" | "PENDING",
  picAction: string,
  documentNo?: string
): Promise<boolean> {
  return tryBool(() =>
    apiFetch(`/api/request-do-open/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, picAction, documentNo }),
    })
  );
}

export async function deleteRequestDoOpen(id: string, documentNo?: string): Promise<boolean> {
  const qs = documentNo ? `?documentNo=${encodeURIComponent(documentNo)}` : "";
  return tryBool(() => apiFetch(`/api/request-do-open/${encodeURIComponent(id)}${qs}`, { method: "DELETE" }));
}

// ============================================================================
// CONTAINER STATUS
// ============================================================================

export async function fetchContainerStatus(): Promise<ContainerRecord[]> {
  try { return await apiFetch("/api/containers"); } catch { return []; }
}

export async function addContainerStatus(record: Omit<ContainerRecord, "id">): Promise<boolean> {
  return tryBool(() => apiFetch("/api/containers", { method: "POST", body: JSON.stringify(record) }));
}

export async function updateContainerStatus(id: string, record: Partial<ContainerRecord>): Promise<boolean> {
  return tryBool(() => apiFetch(`/api/containers/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(record) }));
}

export async function deleteContainerStatus(id: string): Promise<boolean> {
  return tryBool(() => apiFetch(`/api/containers/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

export async function saveBatchContainerStatus(records: Omit<ContainerRecord, "id">[]): Promise<{ insertedCount: number; updatedCount: number }> {
  if (!records?.length) return { insertedCount: 0, updatedCount: 0 };
  try {
    return await apiFetch("/api/containers/batch", { method: "POST", body: JSON.stringify({ records }) });
  } catch {
    return { insertedCount: 0, updatedCount: 0 };
  }
}

export async function syncAllContainerStatusToSupabase(records: ContainerRecord[]): Promise<{ success: boolean; total: number; inserted: number; updated: number; message: string }> {
  if (!records?.length) {
    return { success: true, total: 0, inserted: 0, updated: 0, message: "Tidak ada data container untuk disinkronkan." };
  }
  const result = await saveBatchContainerStatus(records);
  return {
    success: true,
    total: records.length,
    inserted: result.insertedCount,
    updated: result.updatedCount,
    message: `Sinkron selesai: ${result.insertedCount} baru, ${result.updatedCount} update.`,
  };
}

// ============================================================================
// KATALOG FOTO
// ============================================================================

export async function fetchCatalogPhotosSupabase(): Promise<ItemCatalogPhoto[]> {
  try { return await apiFetch("/api/catalog-photos"); } catch { return []; }
}

export async function upsertCatalogPhotoSupabase(photo: ItemCatalogPhoto): Promise<boolean> {
  if (photo.id) {
    return tryBool(() =>
      apiFetch(`/api/catalog-photos/${encodeURIComponent(photo.id)}`, { method: "PUT", body: JSON.stringify(photo) })
    );
  }
  return tryBool(() => apiFetch("/api/catalog-photos/upload", { method: "POST", body: JSON.stringify(photo) }));
}

export async function bulkUpsertCatalogPhotosSupabase(photos: ItemCatalogPhoto[]): Promise<boolean> {
  if (!photos.length) return true;
  return tryBool(() => apiFetch("/api/catalog-photos/bulk", { method: "POST", body: JSON.stringify({ records: photos }) }));
}

export async function deleteCatalogPhotoSupabase(id: string): Promise<boolean> {
  return tryBool(() => apiFetch(`/api/catalog-photos/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

// ============================================================================
// CIF CONTAINER (dipakai CifBapContainerView — Admin/Audit only di server)
// ============================================================================

export async function upsertCifHeader(header: any): Promise<boolean> {
  return tryBool(() => apiFetch("/api/cif-container", { method: "POST", body: JSON.stringify(header) }));
}

export async function replaceRincianCif(noContainer: string, records: any[]): Promise<boolean> {
  return tryBool(() =>
    apiFetch(`/api/cif-container/${encodeURIComponent(noContainer)}/rincian-cif`, {
      method: "POST",
      body: JSON.stringify({ records }),
    })
  );
}

export async function replaceRincianNonCif(noContainer: string, records: any[]): Promise<boolean> {
  return tryBool(() =>
    apiFetch(`/api/cif-container/${encodeURIComponent(noContainer)}/rincian-non-cif`, {
      method: "POST",
      body: JSON.stringify({ records }),
    })
  );
}

export async function deleteCifContainer(noContainer: string): Promise<boolean> {
  return tryBool(() => apiFetch(`/api/cif-container/${encodeURIComponent(noContainer)}`, { method: "DELETE" }));
}

// ============================================================================
// REPORTS / VIEW AGREGAT
// ============================================================================

export async function fetchSisaStockView(startDate?: string, endDate?: string) {
  const qs = new URLSearchParams();
  if (startDate) qs.set("startDate", startDate);
  if (endDate) qs.set("endDate", endDate);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  try { return await apiFetch(`/api/reports/sisa-stock${suffix}`); } catch { return []; }
}

export async function fetchRekonsiliasiStockView(startDate?: string, endDate?: string) {
  const qs = new URLSearchParams();
  if (startDate) qs.set("startDate", startDate);
  if (endDate) qs.set("endDate", endDate);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  try { return await apiFetch(`/api/reports/rekonsiliasi${suffix}`); } catch { return []; }
}

export interface DashboardYearGroupRow {
  year: string;
  groupName: string;
  itemCount: number;
  totalQty: number;
  totalCost: number;
}

export async function fetchDashboardByYearGroup(): Promise<DashboardYearGroupRow[]> {
  try { return await apiFetch("/api/reports/dashboard-by-year-group"); } catch { return []; }
}

export async function getSisaStokByItemCode(itemCode: string): Promise<{ itemCode: string; totalMasuk: number; totalKeluar: number; sisaStok: number }> {
  try {
    return await apiFetch(`/api/stock/${encodeURIComponent(itemCode)}/sisa`);
  } catch {
    return { itemCode, totalMasuk: 0, totalKeluar: 0, sisaStok: 0 };
  }
}

// ============================================================================
// OPERASI TABEL GENERIK (dipakai fitur hapus-massal di UI)
// ============================================================================

// Nama tabel lama (snake_case) → path endpoint + field id
const TABLE_TO_ENDPOINT: Record<string, { base: string; encode?: (key: string) => string }> = {
  master_item: { base: "/api/master-items" },
  transaksi_masuk: { base: "/api/transaksi-masuk" },
  transaksi_keluar: { base: "/api/transaksi-keluar" },
  do_open: { base: "/api/do-open" },
  request_do_open: { base: "/api/request-do-open" },
  container_status: { base: "/api/containers" },
  katalog_foto: { base: "/api/catalog-photos" },
  users: { base: "/api/users" },
};

export async function deleteSupabaseRows(tableName: string, keys: string[], _keyField: string = "id"): Promise<boolean> {
  const target = TABLE_TO_ENDPOINT[tableName];
  if (!target) {
    console.warn(`deleteSupabaseRows: tabel '${tableName}' tidak dikenal.`);
    return false;
  }
  let allOk = true;
  for (const key of keys || []) {
    const ok = await tryBool(() => apiFetch(`${target.base}/${encodeURIComponent(key)}`, { method: "DELETE" }));
    if (!ok) allOk = false;
  }
  return allOk;
}

export async function clearSupabaseTable(tableName: string): Promise<boolean> {
  return tryBool(() => apiFetch("/api/admin/clear-table", { method: "POST", body: JSON.stringify({ table: tableName }) }));
}

export async function clearAllDatabaseDataPermanent(): Promise<void> {
  // Versi lama menghapus seluruh koleksi Firestore; sekarang UI memanggil
  // clearSupabaseTable per tabel — fungsi ini tinggal no-op kompatibilitas.
  console.warn("clearAllDatabaseDataPermanent: Firestore sudah tidak dipakai, tidak ada yang dihapus.");
}

// ============================================================================
// UTIL LAIN (dipertahankan dari versi lama, tanpa dependensi Supabase)
// ============================================================================

export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function extractGDriveFileId(url: string): string | null {
  if (!url) return null;
  const patterns = [/\/file\/d\/([a-zA-Z0-9_-]+)/, /[?&]id=([a-zA-Z0-9_-]+)/, /\/d\/([a-zA-Z0-9_-]+)/];
  for (const p of patterns) {
    const m = url.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function convertGoogleDriveUrl(url: string): string {
  if (!url) return "";
  const fileId = extractGDriveFileId(url);
  if (fileId) return `https://lh3.googleusercontent.com/d/${fileId}`;
  return url.trim();
}

export async function fetchGDriveFileName(_urlOrFileId: string): Promise<string | null> {
  // Versi lama scraping via proxy CORS publik — tidak direplikasi (foto
  // sudah pindah ke disk VPS, lihat CLAUDE.md). Return null = UI pakai fallback.
  return null;
}

// ============================================================================
// KOMPATIBILITAS firebase.ts (semua jalur Firestore mati permanen)
// ============================================================================

export const COLLECTIONS = {
  MASTER_ITEMS: "master_items",
  KATALOG_FOTO: "katalog_foto",
  TRANSAKSI_MASUK: "transaksi_masuk",
  TRANSAKSI_KELUAR: "transaksi_keluar",
  DO_OPEN: "do_open",
  REQUEST_DO_OPEN: "request_do_open",
  USERS: "users",
} as const;

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

// true permanen → semua blok `if (!isFirestoreQuotaExceeded)` di views di-skip
export const isFirestoreQuotaExceeded = true;

// Placeholder — tidak pernah benar-benar dipakai karena flag di atas
export const db: any = null;
export const auth: any = null;

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  return {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {},
  };
}

export async function bulkDeleteDocs(_collectionName: string, _docIds: string[]) { /* Firestore mati */ }
export async function clearCollectionDocs(_collectionName: string) { /* Firestore mati */ }
export async function bulkAddDocs<T extends object>(_collectionName: string, _docs: T[], _onProgress?: (p: number, t: number) => void) { /* Firestore mati */ }

// ============================================================================
// KOMPATIBILITAS objek `supabase` (client lama)
// ============================================================================

// Query-builder no-op: dipakai jalur legacy yang seharusnya sudah mati
// (sinkron Firestore→Supabase di App.tsx). Selalu resolve error lembut.
function deadQuery(): any {
  const result = Promise.resolve({ data: null, error: { message: "Supabase sudah tidak dipakai (migrasi SQL Server)." } });
  const chain: any = new Proxy(() => chain, {
    get: (_t, prop) => {
      if (prop === "then") return result.then.bind(result);
      if (prop === "catch") return result.catch.bind(result);
      if (prop === "finally") return result.finally.bind(result);
      return () => chain;
    },
    apply: () => chain,
  });
  return chain;
}

export const supabase = {
  // LoginView memanggil supabase.rpc('verify_login') langsung — arahkan ke API
  rpc: async (fnName: string, params?: any) => {
    if (fnName === "verify_login") {
      // Pakai apiFetch langsung (bukan verifyLoginSupabase) supaya pesan error asli
      // dari server (mis. "Akun belum di-approve Admin.") tidak hilang jadi pesan
      // generik — penting supaya user pending-approval tidak salah dikira NIK/password salah.
      try {
        const data = await apiFetch("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ nik: (params?.p_nik || "").trim().toLowerCase(), password: params?.p_password || "" }),
        });
        setApiToken(data.token);
        const user = data.user as AppUser;
        return {
          data: [{
            id: user.nik,
            nik: user.nik,
            nama_lengkap: user.displayName,
            role: user.role,
            is_approved: user.isApproved,
            created_at: user.createdAt,
          }],
          error: null,
        };
      } catch (e: any) {
        return { data: null, error: { message: e?.message || "NIK atau password salah." } };
      }
    }
    return { data: null, error: { message: `RPC '${fnName}' tidak tersedia lagi.` } };
  },
  from: (_table: string) => deadQuery(),
  storage: { from: (_bucket: string) => deadQuery() },
  channel: (_name: string) => ({ on: () => ({ subscribe: () => ({}) }) }),
  removeChannel: (_ch: any) => {},
};

// ============================================================================
// KOMPATIBILITAS DataMigrationModal (kredensial supabase legacy)
// ============================================================================

export function sanitizeSupabaseUrl(rawUrl: string): string {
  if (!rawUrl) return "";
  return rawUrl.trim().replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
}

export function getSupabaseCredentials() {
  // Tidak ada lagi kredensial Supabase — dikembalikan kosong supaya modal
  // migrasi legacy tidak crash kalau dibuka
  return { url: "", key: "" };
}

export function saveSupabaseCredentials(_url: string, _key: string) {
  console.warn("saveSupabaseCredentials: Supabase sudah tidak dipakai, kredensial tidak disimpan.");
}
