export interface MasterItem {
  id?: string;
  itemCode: string;
  itemName: string;
  groupName: string;
  hargaJual: number;
  hargaBeli: number;
  createdDate?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TransactionRecord {
  id?: string;
  postingDate: string; // YYYY-MM-DD
  entryName: string;
  documentNo: string;
  itemCode: string;
  category: string;
  remark: string;
  qty: number;
  fromLocation: string;
  toLocation: string;
  createdAt?: string;
}

export interface DoOpenRecord {
  id?: string;
  postingDate: string;
  entryName: string;
  documentNo: string; // No DO
  noDosl?: string; // No DOSL
  itemCode: string;
  category: string;
  remark: string;
  qty: number;
  fromLocation: string;
  toLocation: string;
  keterangan?: string; // Keterangan
  itemName?: string;
  groupName?: string;
  hargaJual?: number;
  hargaBeli?: number;
  createdAt?: string;
  requestKirimDate?: string;
  requestKirimAt?: string;
  requestKirimBy?: string;
}

export interface SisaStockSummary {
  itemCode: string;
  itemName: string;
  groupName: string;
  hargaJual: number;
  hargaBeli: number;
  totalMasuk: number;
  totalKeluar: number;
  sisaStock: number;
  nilaiHargaJualSisaStock: number;
  nilaiHargaBeliSisaStock: number;
}

export interface RekonsiliasiSummary {
  itemCode: string;
  itemName: string;
  groupName: string;
  sisaStock: number;
  qtyDoOpen: number;
  qtyLepasan: number;
}

export interface RequestDoRecord {
  id?: string;
  doOpenId: string;
  postingDate: string;
  entryName: string; // Area RM OPR
  documentNo: string;
  noDosl?: string; // No DOSL
  itemCode: string;
  category: string; // Status DO OPEN
  remark: string; // Area SPV OPR
  qty: number;
  fromLocation: string;
  toLocation: string;
  keterangan?: string; // Keterangan
  requestedBy: string;
  requestedAt: string;
  requestKirimDate?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
}

export type DoOpenLogistikGroup = 'BARANG MASIH ADA DI AREA QC' | 'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)';

export function getDoOpenLogistikGroup(categoryStatus: string): DoOpenLogistikGroup {
  const norm = (categoryStatus || '').trim().toUpperCase();
  if (
    norm === 'NOT POSTING SHIPPING' || 
    norm === 'DO SUDAH DI LOGISTIK' || 
    norm === 'SUDAH DI LOGISTIK' || 
    norm === 'LOGISTIK' ||
    norm.includes('SIAP KIRIM') ||
    norm.includes('SUDAH DI LOGISTIK')
  ) {
    return 'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)';
  }
  return 'BARANG MASIH ADA DI AREA QC';
}

export type ContainerStatusType = 'Barang Sudah Tiba di Bintara' | 'Container Masih OTW' | 'Container Belum OTW';

export interface ContainerRecord {
  id?: string;
  noContainer: string;
  category: string;
  tglTibaPriuk: string;
  tglTibaBintara: string;
  itemCategoryBarang: string;
  statusContainer: ContainerStatusType;
  totalQty?: number;
  totalCost?: number;
  totalPrice?: number;
  remark?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CifRecord {
  id?: string;
  bulanKontJalan: string; // e.g. "Januari 2026"
  noContainer: string; // e.g. "TCNU1234567"
  tglFinalPembayaranPib: string; // YYYY-MM-DD
  desc: string; // Deskripsi barang
  totalNilaiPo?: number; // Total Nilai PO Kontainer (Rp)
  total: number; // Total CIF / PIB (Rp)
  ar1?: number; // Pembelian AR1 (Rp)
  ar20?: number; // Pembelian AR20 (Rp)
  ar6?: number; // Pembelian AR6 (Rp)
  ar9?: number; // Pembelian AR9 (Rp)
  soyu?: number; // Pembelian SOYU (Rp)
  affNa?: number; // Pembelian AFF NA (Rp)
  ket: string; // Keterangan
  createdAt?: string;
  updatedAt?: string;
}

export interface NonCifRecord {
  id?: string;
  bulanKontJalan: string; // e.g. "Januari 2026"
  noContainer: string;
  tanggal: string; // YYYY-MM-DD
  kategoriBiaya: string; // e.g. "Depresiasi Manual", "Biaya Operasional Non-CIF"
  desc: string; // Deskripsi Biaya Selain CIF
  totalNilaiPo?: number;
  total: number; // Total Biaya Selain CIF (Rp)
  ar1?: number;
  ar20?: number;
  ar6?: number;
  ar9?: number;
  soyu?: number;
  affNa?: number;
  ket: string; // Keterangan / Ref Jurnal
  createdAt?: string;
  updatedAt?: string;
}

export interface BapItemRecord {
  id?: string;
  bapNo?: string; // No BAP, e.g. "BAP/2026/001"
  noContainer: string; // No Container
  itemCode: string;
  itemName: string;
  nilaiJual: number; // Rp / unit
  nilaiCost: number; // Rp / unit
  qtyContainer: number; // Qty dalam container
  qtyTerimaBagus: number; // Qty terima kondisi bagus
  qtyTerimaRk: number; // Qty terima rijek kecil
  qtyTerimaRm: number; // Qty terima rijek mayor/mati
  fotoRijekUrl?: string; // Data URL or Image URL for rijek photo
  tanggalBap?: string;
  keterangan?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ItemCatalogPhoto {
  id: string;
  itemCode: string;
  itemName?: string;
  groupName?: string;
  photoUrl: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

// 'Admin' = role tertinggi di versi SQL Server (delete + user management).
// 'BOD' = baca penuh termasuk harga beli, tanpa hak tulis.
export type UserRole = 'Admin' | 'Audit' | 'OPR' | 'Team Gudang' | 'BOD';

export type ActiveTab = 
  | 'dashboard'
  | 'master_item'
  | 'katalog_foto'
  | 'transaksi_masuk'
  | 'transaksi_keluar'
  | 'sisa_stock'
  | 'do_open'
  | 'request_do_open'
  | 'report_request_do'
  | 'rekonsiliasi_stock'
  | 'container_status'
  | 'cif_bap_container'
  | 'user_management'
  | 'security_monitoring'
  | 'chat_bot';

export interface DateCategoryFilter {
  searchQuery: string;
  startDate: string;
  endDate: string;
  category: string;
}

export interface UserProfile {
  uid: string;
  nik: string;
  displayName: string;
  role: UserRole;
  isApproved: boolean;
  email?: string;
  createdAt?: string;
}

export interface AppUser {
  id?: string;
  nik: string;
  displayName: string;
  password?: string;
  role: UserRole;
  isApproved: boolean;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
}
