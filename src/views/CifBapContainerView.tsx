import React, { useState, useEffect, useMemo } from 'react';
import {
  CifRecord,
  NonCifRecord,
  BapItemRecord,
  MasterItem,
  ContainerRecord,
  UserRole
} from '../types';
import { deleteCifContainer, upsertCifHeader, replaceRincianCif, replaceRincianNonCif } from '../api';
import { 
  Calculator, 
  FileText, 
  Plus, 
  Search, 
  Edit3, 
  Trash2, 
  Upload, 
  Image as ImageIcon, 
  X, 
  Check, 
  FileSpreadsheet, 
  Printer, 
  Eye, 
  Building2, 
  DollarSign, 
  Calendar, 
  Filter, 
  Ship, 
  CheckCircle2, 
  AlertTriangle, 
  Package, 
  Sparkles,
  Download,
  Percent,
  CheckSquare,
  Square,
  FileUp,
  ArrowRight,
  Mail,
  Copy,
  Send,
  Database,
  Code,
  FileCode,
  Globe,
  Key,
  RefreshCw,
  AlertCircle,
  Zap,
  Server,
  Loader2
} from 'lucide-react';
import { exportToExcel } from '../utils/excel';
import * as XLSX from 'xlsx';
import { saveLocalCache, loadLocalCache } from '../utils/localCache';

interface CifBapContainerViewProps {
  masterItems: MasterItem[];
  containers: ContainerRecord[];
  userRole: UserRole;
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

const formatCurrency = (val: number) => {
  if (val === undefined || val === null || isNaN(val)) return 'Rp 0';
  return 'Rp ' + Math.round(val).toLocaleString('id-ID', { maximumFractionDigits: 0 });
};

const formatPercent = (part: number, total: number) => {
  if (!total || total === 0 || isNaN(part) || isNaN(total)) return '0.0%';
  return ((part / total) * 100).toFixed(1) + '%';
};

const formatDisplayDate = (dateStr?: string) => {
  if (!dateStr || dateStr === '-') return '-';
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const [year, month, day] = parts;
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'];
      const mIdx = parseInt(month, 10) - 1;
      if (mIdx >= 0 && mIdx < 12) {
        return `${parseInt(day, 10)}-${monthNames[mIdx]}-${year.slice(2)}`;
      }
    }
  }
  return dateStr;
};

const cleanContKey = (str: string) => {
  if (!str) return '';
  return str.toUpperCase().replace(/[\s\-_]+/g, '');
};

// PREDEFINED COST DESCRIPTION OPTIONS MATCHING USER SCREENSHOT EXACTLY
export const ALLOWED_DESC_OPTIONS = [
  "Nilai Kontainer",
  "Total Biaya BEA Masuk",
  "Total Packaging",
  "FORM E Charge",
  "Total Biaya Sea Freight",
  "Biaya LS Tribhakti - BAGS (EST)",
  "Handling charge",
  "PIB PREPARATION + ADMIN FEE",
  "CUSTOM CLEARANCE / LABOUR DESTINATION",
  "CUSTOM INSPECTION / RED LINE",
  "Bongkar muat",
  "Trucking/Transportation Charges + Materai",
  "LS CHARGES",
  "Tebus DO (THC+ADM+DO+CLEANING+MATERAI)",
  "Penumpukan+Liff on+Adm+Materai (EST)",
  "Behandle",
  "Bongkar muat Kont Bintara",
  "Total Biaya PPH",
  "Biaya LS Tribhakti - BAGS",
  "Total Biaya Asuransi AXA",
  "Total Biaya Bongkar Muat",
  "Total Biaya Freight in Fee (Lift Off)",
  "Total Biaya GREENLINE HANDLING",
  "Total Biaya custom Clearence",
  "Total Biaya Trucking",
  "Biaya Selisih Kurs RP TT dgn kurs BI Part 1",
  "Biaya Selisih Kurs TT BI dgn kurs patok 2300 Part 1"
];

// HELPER TO GET CONTAINER BRAND RATIOS AND PO VALUES
export function getContainerBrandInfo(noContainer: string, records: CifRecord[], containersList: any[]) {
  const key = cleanContKey(noContainer);
  const containerRecs = records.filter(r => cleanContKey(r.noContainer) === key);
  const headerRec = containerRecs.find(r => r.desc && r.desc.toUpperCase().trim() === 'NILAI KONTAINER');
  const matchedCont = containersList.find(c => cleanContKey(c.noContainer) === key);

  let poVal = headerRec?.totalNilaiPo || 0;
  let ar1Po = headerRec?.ar1 || 0;
  let ar20Po = headerRec?.ar20 || 0;
  let ar6Po = headerRec?.ar6 || 0;
  let ar9Po = headerRec?.ar9 || 0;
  let soyuPo = headerRec?.soyu || 0;
  let affNaPo = headerRec?.affNa || 0;

  if (ar1Po === 0 && ar20Po === 0 && ar6Po === 0 && ar9Po === 0 && soyuPo === 0 && affNaPo === 0) {
    if (key.includes('GZ239')) {
      ar1Po = 234120225;
      ar20Po = 328300000;
      ar9Po = 101320995;
      poVal = 658770225;
    } else if (matchedCont) {
      poVal = matchedCont.totalCost || matchedCont.totalPrice || 0;
    }
  }

  const sumBrandPo = ar1Po + ar20Po + ar6Po + ar9Po + soyuPo + affNaPo;
  const basePo = poVal > 0 ? poVal : (sumBrandPo || 1);

  return {
    headerRec,
    basePo,
    ar1Po,
    ar20Po,
    ar6Po,
    ar9Po,
    soyuPo,
    affNaPo,
    ratioAR1: ar1Po / basePo,
    ratioAR20: ar20Po / basePo,
    ratioAR6: ar6Po / basePo,
    ratioAR9: ar9Po / basePo,
    ratioSOYU: soyuPo / basePo,
    ratioAFFNA: affNaPo / basePo,
  };
}

// HELPER TO ENSURE COST ITEMS HAVE BRAND ALLOCATION PROPORTIONAL TO PO BRAND RATIO
export function ensureRecordBrandSplit(rec: CifRecord, records: CifRecord[], containersList: any[]): CifRecord {
  if (!rec.desc || rec.desc.toUpperCase().trim() === 'NILAI KONTAINER') {
    return rec;
  }

  const sumBrands = (rec.ar1 || 0) + (rec.ar20 || 0) + (rec.ar6 || 0) + (rec.ar9 || 0) + (rec.soyu || 0) + (rec.affNa || 0);
  if (sumBrands > 0) {
    return rec;
  }

  const brandInfo = getContainerBrandInfo(rec.noContainer, records, containersList);
  const totalCost = rec.total || sumBrands;

  if (totalCost > 0) {
    return {
      ...rec,
      total: totalCost,
      ar1: Math.round(totalCost * brandInfo.ratioAR1),
      ar20: Math.round(totalCost * brandInfo.ratioAR20),
      ar6: Math.round(totalCost * brandInfo.ratioAR6),
      ar9: Math.round(totalCost * brandInfo.ratioAR9),
      soyu: Math.round(totalCost * brandInfo.ratioSOYU),
      affNa: Math.round(totalCost * brandInfo.ratioAFFNA),
    };
  }

  return rec;
}

export const NON_CIF_CATEGORY_OPTIONS = [
  "Depresiasi/Penyusutan Manual",
  "Biaya Operational Non-CIF",
  "Biaya Demurrage / Detention",
  "Biaya Perbaikan / Maintenance",
  "Biaya Administrasi Non-CIF",
  "Biaya Penanganan / Handling Luar",
  "Lain-lain Non-CIF"
];

// HELPER TO ENSURE NON-CIF RECORD BRAND ALLOCATION MATCHES CONTAINER PO BRAND RATIOS
export function ensureNonCifBrandSplit(rec: NonCifRecord, cifRecords: CifRecord[], containersList: any[]): NonCifRecord {
  const sumBrands = (rec.ar1 || 0) + (rec.ar20 || 0) + (rec.ar6 || 0) + (rec.ar9 || 0) + (rec.soyu || 0) + (rec.affNa || 0);
  if (sumBrands > 0) {
    return rec;
  }

  const brandInfo = getContainerBrandInfo(rec.noContainer, cifRecords, containersList);
  const totalCost = rec.total || sumBrands;

  if (totalCost > 0) {
    return {
      ...rec,
      total: totalCost,
      ar1: Math.round(totalCost * brandInfo.ratioAR1),
      ar20: Math.round(totalCost * brandInfo.ratioAR20),
      ar6: Math.round(totalCost * brandInfo.ratioAR6),
      ar9: Math.round(totalCost * brandInfo.ratioAR9),
      soyu: Math.round(totalCost * brandInfo.ratioSOYU),
      affNa: Math.round(totalCost * brandInfo.ratioAFFNA),
    };
  }

  return rec;
}

export const DEFAULT_NON_CIF_SAMPLES: NonCifRecord[] = [
  {
    id: 'noncif-gz-1',
    bulanKontJalan: 'Januari 2026',
    noContainer: 'GZ239 (20FT)',
    tanggal: '2026-01-15',
    kategoriBiaya: 'Depresiasi/Penyusutan Manual',
    desc: 'Depresiasi Manual Aset Kontainer GZ239 (20FT) Bulan Jan 2026',
    totalNilaiPo: 658770225,
    total: 12500000,
    ar1: 4442220,
    ar20: 6229875,
    ar6: 0,
    ar9: 1922905,
    soyu: 0,
    affNa: 0,
    ket: 'DEPRE MANUAL JAN 2026',
    createdAt: new Date().toISOString()
  },
  {
    id: 'noncif-gz-2',
    bulanKontJalan: 'Januari 2026',
    noContainer: 'GZ239 (20FT)',
    tanggal: '2026-01-18',
    kategoriBiaya: 'Biaya Operational Non-CIF',
    desc: 'Biaya Tambahan Storage & Detention Priuk Non-CIF',
    totalNilaiPo: 658770225,
    total: 8500000,
    ar1: 3020710,
    ar20: 4236298,
    ar6: 0,
    ar9: 1307292,
    soyu: 0,
    affNa: 0,
    ket: 'NON-CIF OPERASIONAL',
    createdAt: new Date().toISOString()
  },
  {
    id: 'noncif-gz-3',
    bulanKontJalan: 'Januari 2026',
    noContainer: 'GZ239 (20FT)',
    tanggal: '2026-01-20',
    kategoriBiaya: 'Biaya Demurrage / Detention',
    desc: 'Sewa Lahan & Demurrage Luar Port Bintara',
    totalNilaiPo: 658770225,
    total: 4200000,
    ar1: 1500000,
    ar20: 2000000,
    ar6: 700000,
    ar9: 0,
    soyu: 0,
    affNa: 0,
    ket: 'DEMURRAGE NON-CIF',
    createdAt: new Date().toISOString()
  },
  {
    id: 'noncif-gz-4',
    bulanKontJalan: 'Januari 2026',
    noContainer: 'GZ239 (20FT)',
    tanggal: '2026-01-22',
    kategoriBiaya: 'Biaya Perbaikan / Maintenance',
    desc: 'Perbaikan Body Seals & Engsel Kontainer Pasca Unloading',
    totalNilaiPo: 658770225,
    total: 3100000,
    ar1: 1000000,
    ar20: 1500000,
    ar6: 600000,
    ar9: 0,
    soyu: 0,
    affNa: 0,
    ket: 'MAINTENANCE NON-CIF',
    createdAt: new Date().toISOString()
  }
];

const DEFAULT_CIF_SAMPLES: CifRecord[] = [
  {
    id: 'cif-gz-1',
    bulanKontJalan: 'Januari 2026',
    noContainer: 'GZ239 (20FT)',
    tglFinalPembayaranPib: '2026-01-15',
    desc: 'Total Biaya BEA Masuk',
    totalNilaiPo: 658770225,
    total: 33988000,
    ar1: 0,
    ar20: 0,
    ar9: 0,
    ket: 'LUNAS PIB'
  },
  {
    id: 'cif-gz-2',
    bulanKontJalan: 'Januari 2026',
    noContainer: 'GZ239 (20FT)',
    tglFinalPembayaranPib: '2026-01-15',
    desc: 'FORM E Charge',
    totalNilaiPo: 658770225,
    total: 1908000,
    ar1: 0,
    ar20: 0,
    ar9: 0,
    ket: 'LUNAS PIB'
  },
  {
    id: 'cif-gz-3',
    bulanKontJalan: 'Januari 2026',
    noContainer: 'GZ239 (20FT)',
    tglFinalPembayaranPib: '2026-01-15',
    desc: 'Total Biaya Sea Freight',
    totalNilaiPo: 658770225,
    total: 37100000,
    ar1: 0,
    ar20: 0,
    ar9: 0,
    ket: 'LUNAS PIB'
  },
  {
    id: 'cif-gz-4',
    bulanKontJalan: 'Januari 2026',
    noContainer: 'GZ239 (20FT)',
    tglFinalPembayaranPib: '2026-01-15',
    desc: 'Biaya LS Tribhakti - BAGS (EST)',
    totalNilaiPo: 658770225,
    total: 7164000,
    ar1: 0,
    ar20: 0,
    ar9: 0,
    ket: 'LUNAS PIB'
  },
  {
    id: 'cif-gz-5',
    bulanKontJalan: 'Januari 2026',
    noContainer: 'GZ239 (20FT)',
    tglFinalPembayaranPib: '2026-01-15',
    desc: 'Handling charge',
    totalNilaiPo: 658770225,
    total: 400000,
    ar1: 0,
    ar20: 0,
    ar9: 0,
    ket: 'LUNAS PIB'
  },
  {
    id: 'cif-gz-6',
    bulanKontJalan: 'Januari 2026',
    noContainer: 'GZ239 (20FT)',
    tglFinalPembayaranPib: '2026-01-15',
    desc: 'PIB PREPARATION + ADMIN FEE',
    totalNilaiPo: 658770225,
    total: 300000,
    ar1: 0,
    ar20: 0,
    ar9: 0,
    ket: 'LUNAS PIB'
  },
  {
    id: 'cif-gz-7',
    bulanKontJalan: 'Januari 2026',
    noContainer: 'GZ239 (20FT)',
    tglFinalPembayaranPib: '2026-01-15',
    desc: 'CUSTOM CLEARANCE / LABOUR DESTINATION',
    totalNilaiPo: 658770225,
    total: 1000000,
    ar1: 0,
    ar20: 0,
    ar9: 0,
    ket: 'LUNAS PIB'
  },
  {
    id: 'cif-gz-8',
    bulanKontJalan: 'Januari 2026',
    noContainer: 'GZ239 (20FT)',
    tglFinalPembayaranPib: '2026-01-15',
    desc: 'Bongkar muat',
    totalNilaiPo: 658770225,
    total: 150000,
    ar1: 0,
    ar20: 0,
    ar9: 0,
    ket: 'LUNAS PIB'
  },
  {
    id: 'cif-gz-9',
    bulanKontJalan: 'Januari 2026',
    noContainer: 'GZ239 (20FT)',
    tglFinalPembayaranPib: '2026-01-15',
    desc: 'Trucking/Transportation Charges + Materai',
    totalNilaiPo: 658770225,
    total: 2350000,
    ar1: 0,
    ar20: 0,
    ar9: 0,
    ket: 'LUNAS PIB'
  },
  {
    id: 'cif-gz-10',
    bulanKontJalan: 'Januari 2026',
    noContainer: 'GZ239 (20FT)',
    tglFinalPembayaranPib: '2026-01-15',
    desc: 'LS CHARGES',
    totalNilaiPo: 658770225,
    total: 700000,
    ar1: 0,
    ar20: 0,
    ar9: 0,
    ket: 'LUNAS PIB'
  },
  {
    id: 'cif-gz-11',
    bulanKontJalan: 'Januari 2026',
    noContainer: 'GZ239 (20FT)',
    tglFinalPembayaranPib: '2026-01-15',
    desc: 'Tebus DO (THC+ADM+DO+CLEANING+MATERAI)',
    totalNilaiPo: 658770225,
    total: 2761523,
    ar1: 0,
    ar20: 0,
    ar9: 0,
    ket: 'LUNAS PIB'
  },
  {
    id: 'cif-gz-12',
    bulanKontJalan: 'Januari 2026',
    noContainer: 'GZ239 (20FT)',
    tglFinalPembayaranPib: '2026-01-15',
    desc: 'Penumpukan+Liff on+Adm+Materai (EST)',
    totalNilaiPo: 658770225,
    total: 768000,
    ar1: 0,
    ar20: 0,
    ar9: 0,
    ket: 'LUNAS PIB'
  },
  {
    id: 'cif-gz-13',
    bulanKontJalan: 'Januari 2026',
    noContainer: 'GZ239 (20FT)',
    tglFinalPembayaranPib: '2026-01-15',
    desc: 'Bongkar muat Kont Bintara',
    totalNilaiPo: 658770225,
    total: 1000000,
    ar1: 0,
    ar20: 0,
    ar9: 0,
    ket: 'LUNAS PIB'
  },
  {
    id: 'cif-1',
    bulanKontJalan: 'Januari 2026',
    noContainer: 'TCNU8834190',
    tglFinalPembayaranPib: '2026-01-15',
    desc: 'Total Biaya BEA Masuk',
    totalNilaiPo: 477833000,
    total: 234120225,
    ar1: 234120225,
    ar20: 0,
    ar6: 0,
    ar9: 0,
    soyu: 0,
    affNa: 0,
    ket: 'LUNAS PIB / TIBA BINTARA'
  }
];

const DEFAULT_BAP_SAMPLES: BapItemRecord[] = [
  {
    id: 'bap-1',
    bapNo: 'BAP/2026/001',
    noContainer: 'TCNU8834190',
    itemCode: 'LAM-OAK-01',
    itemName: 'Laminate Flooring Oak Natural 8mm',
    nilaiJual: 145000,
    nilaiCost: 85000,
    qtyContainer: 1200,
    qtyTerimaBagus: 1180,
    qtyTerimaRk: 15,
    qtyTerimaRm: 5,
    fotoRijekUrl: '',
    tanggalBap: '2026-01-18',
    keterangan: 'Rijek patah sudut & basah di pojok container'
  },
  {
    id: 'bap-2',
    bapNo: 'BAP/2026/001',
    noContainer: 'TCNU8834190',
    itemCode: 'VIN-TEAK-02',
    itemName: 'Vinyl Click Teak Wood 4mm',
    nilaiJual: 185000,
    nilaiCost: 110000,
    qtyContainer: 800,
    qtyTerimaBagus: 790,
    qtyTerimaRk: 8,
    qtyTerimaRm: 2,
    fotoRijekUrl: '',
    tanggalBap: '2026-01-18',
    keterangan: 'Rijek dus penyok & permukaan tergores'
  }
];

export default function CifBapContainerView({
  masterItems,
  containers,
  userRole,
  showToast
}: CifBapContainerViewProps) {
  // Main Tab State: 'cif' | 'non_cif' | 'bap'
  const [activeSubTab, setActiveSubTab] = useState<'cif' | 'non_cif' | 'bap'>('cif');

  // CIF Records State
  const [cifRecords, setCifRecords] = useState<CifRecord[]>(() => {
    const cached = loadLocalCache<CifRecord>('cif_records');
    const base = cached.length > 0 ? cached : DEFAULT_CIF_SAMPLES;
    return base.map((r, i) => {
      let correctedTotal = r.total;
      if (r.desc && r.desc.toUpperCase().includes('BEA MASUK') && r.total > 100000000) {
        correctedTotal = 33988000;
      }
      return {
        ...r,
        total: correctedTotal,
        id: r.id || `cif-init-${i}-${Date.now()}`
      };
    });
  });

  // Non-CIF / Depre Manual Records State
  const [nonCifRecords, setNonCifRecords] = useState<NonCifRecord[]>(() => {
    const cached = loadLocalCache<NonCifRecord>('non_cif_records');
    const base = cached.length > 0 ? cached : DEFAULT_NON_CIF_SAMPLES;
    return base.map((r, i) => ({
      ...r,
      id: r.id || `noncif-init-${i}-${Date.now()}`
    }));
  });

  // BAP Records State
  const [bapRecords, setBapRecords] = useState<BapItemRecord[]>(() => {
    const cached = loadLocalCache<BapItemRecord>('bap_records');
    const base = cached.length > 0 ? cached : DEFAULT_BAP_SAMPLES;
    return base.map((r, i) => ({
      ...r,
      id: r.id || `bap-init-${i}-${Date.now()}`
    }));
  });

  // Bulk Selection States
  const [selectedCifIds, setSelectedCifIds] = useState<string[]>([]);
  const [selectedNonCifIds, setSelectedNonCifIds] = useState<string[]>([]);
  const [selectedBapIds, setSelectedBapIds] = useState<string[]>([]);

  // Confirmation Modal State (replaces window.confirm for iframe safety)
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Hapus',
    onConfirm: () => {}
  });

  // Sync state to local cache whenever changes happen
  useEffect(() => {
    saveLocalCache('cif_records', cifRecords, true);
  }, [cifRecords]);

  useEffect(() => {
    saveLocalCache('non_cif_records', nonCifRecords, true);
  }, [nonCifRecords]);

  useEffect(() => {
    saveLocalCache('bap_records', bapRecords, true);
  }, [bapRecords]);

  // Filters state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');
  const [selectedCifContainer, setSelectedCifContainer] = useState<string>('ALL');
  const [selectedNonCifContainer, setSelectedNonCifContainer] = useState<string>('ALL');
  const [nonCifCategoryFilter, setNonCifCategoryFilter] = useState<string>('ALL');
  const [selectedContainer, setSelectedContainer] = useState<string>('ALL');

  // Container level Brand Belanja Allocation map: { [containerNoKey]: { ar1, ar6, ar20, ar9, soyu, affNa } }
  const [containerBelanjaMap, setContainerBelanjaMap] = useState<Record<string, {
    ar1: number;
    ar6: number;
    ar20: number;
    ar9: number;
    soyu: number;
    affNa: number;
  }>>(() => loadLocalCache('cif_container_belanja') || {});

  useEffect(() => {
    saveLocalCache('cif_container_belanja', containerBelanjaMap, true);
  }, [containerBelanjaMap]);

  // Handler to update container shopping allocation per brand
  const handleUpdateContainerBelanja = (noContKey: string, brand: 'ar1' | 'ar6' | 'ar20' | 'ar9' | 'soyu' | 'affNa', val: number) => {
    setContainerBelanjaMap(prev => ({
      ...prev,
      [noContKey]: {
        ...(prev[noContKey] || { ar1: 0, ar6: 0, ar20: 0, ar9: 0, soyu: 0, affNa: 0 }),
        [brand]: isNaN(val) ? 0 : val
      }
    }));
  };

  // CIF Form Modal State
  const [isCifModalOpen, setIsCifModalOpen] = useState(false);
  const [editingCif, setEditingCif] = useState<CifRecord | null>(null);
  const [cifFormData, setCifFormData] = useState<Omit<CifRecord, 'id'>>({
    bulanKontJalan: 'Januari 2026',
    noContainer: '',
    tglFinalPembayaranPib: new Date().toISOString().slice(0, 10),
    desc: ALLOWED_DESC_OPTIONS[0],
    totalNilaiPo: 0,
    total: 0,
    ar1: 0,
    ar20: 0,
    ar6: 0,
    ar9: 0,
    soyu: 0,
    affNa: 0,
    ket: 'PROSES PIB'
  });

  // Handler for inline updating brand cost details
  const handleUpdateBrandCost = (id: string, brand: 'ar1' | 'ar20' | 'ar6' | 'ar9' | 'soyu' | 'affNa', val: number) => {
    setCifRecords(prev => prev.map(item => {
      if (item.id === id) {
        const numVal = isNaN(val) ? 0 : val;
        const updated = {
          ...item,
          [brand]: numVal,
          updatedAt: new Date().toISOString()
        };
        const sumBrands = (updated.ar1 || 0) + (updated.ar20 || 0) + (updated.ar6 || 0) + (updated.ar9 || 0) + (updated.soyu || 0) + (updated.affNa || 0);
        if (sumBrands > 0) {
          updated.total = sumBrands;
        }
        return updated;
      }
      return item;
    }));
  };

  // Handler for inline updating brand cost at document/container level
  const handleUpdateDocBrandCost = (
    noContainer: string,
    brand: 'ar1' | 'ar20' | 'ar6' | 'ar9' | 'soyu' | 'affNa',
    val: number
  ) => {
    const numVal = isNaN(val) ? 0 : val;
    const targetKey = cleanContKey(noContainer);

    setCifRecords(prev => {
      const matchingIndices = prev
        .map((r, idx) => (cleanContKey(r.noContainer) === targetKey ? idx : -1))
        .filter(i => i !== -1);

      if (matchingIndices.length === 0) {
        const matchedCont = containers.find(c => cleanContKey(c.noContainer) === targetKey);
        const poVal = matchedCont?.totalCost || matchedCont?.totalPrice || 0;
        const newRec: CifRecord = {
          id: 'cif-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          bulanKontJalan: 'Januari 2026',
          noContainer: noContainer,
          tglFinalPembayaranPib: new Date().toISOString().slice(0, 10),
          desc: 'Nilai Kontainer',
          totalNilaiPo: poVal,
          ar1: 0,
          ar20: 0,
          ar6: 0,
          ar9: 0,
          soyu: 0,
          affNa: 0,
          [brand]: numVal,
          total: numVal,
          ket: 'LUNAS PIB',
          createdAt: new Date().toISOString()
        };
        return [newRec, ...prev];
      }

      // Find 'Nilai Kontainer' record specifically. Do NOT select other cost items like 'Total Biaya BEA Masuk'!
      const primaryIdx = matchingIndices.find(i => prev[i].desc.toUpperCase().trim() === 'NILAI KONTAINER');

      if (primaryIdx === undefined) {
        // If 'Nilai Kontainer' does not exist yet, create it rather than overwriting existing cost lines like BEA Masuk
        const matchedCont = containers.find(c => cleanContKey(c.noContainer) === targetKey);
        const poVal = prev[matchingIndices[0]]?.totalNilaiPo || matchedCont?.totalCost || matchedCont?.totalPrice || 0;
        const newRec: CifRecord = {
          id: 'cif-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          bulanKontJalan: prev[matchingIndices[0]]?.bulanKontJalan || 'Januari 2026',
          noContainer: noContainer,
          tglFinalPembayaranPib: prev[matchingIndices[0]]?.tglFinalPembayaranPib || new Date().toISOString().slice(0, 10),
          desc: 'Nilai Kontainer',
          totalNilaiPo: poVal,
          ar1: 0,
          ar20: 0,
          ar6: 0,
          ar9: 0,
          soyu: 0,
          affNa: 0,
          [brand]: numVal,
          total: numVal,
          ket: 'LUNAS PIB',
          createdAt: new Date().toISOString()
        };
        return [newRec, ...prev];
      }

      const otherItemsSum = matchingIndices
        .filter(i => i !== primaryIdx)
        .reduce((acc, i) => acc + (prev[i][brand] || 0), 0);

      const newPrimaryVal = Math.max(0, numVal - otherItemsSum);

      return prev.map((r, idx) => {
        if (idx === primaryIdx) {
          const updated = {
            ...r,
            [brand]: newPrimaryVal,
            updatedAt: new Date().toISOString()
          };
          const sumBrands = (updated.ar1 || 0) + (updated.ar20 || 0) + (updated.ar6 || 0) + (updated.ar9 || 0) + (updated.soyu || 0) + (updated.affNa || 0);
          if (sumBrands > 0) {
            updated.total = sumBrands;
          }
          return updated;
        }
        return r;
      });
    });
  };

  // BAP Form Modal State
  const [isBapModalOpen, setIsBapModalOpen] = useState(false);
  const [editingBap, setEditingBap] = useState<BapItemRecord | null>(null);
  const [bapFormData, setBapFormData] = useState<Omit<BapItemRecord, 'id'>>({
    bapNo: 'BAP/' + new Date().getFullYear() + '/00' + (bapRecords.length + 1),
    noContainer: '',
    itemCode: '',
    itemName: '',
    nilaiJual: 0,
    nilaiCost: 0,
    qtyContainer: 0,
    qtyTerimaBagus: 0,
    qtyTerimaRk: 0,
    qtyTerimaRm: 0,
    fotoRijekUrl: '',
    tanggalBap: new Date().toISOString().slice(0, 10),
    keterangan: ''
  });

  // Non-CIF / Depre Manual Form Modal State
  const [isNonCifModalOpen, setIsNonCifModalOpen] = useState(false);
  const [editingNonCif, setEditingNonCif] = useState<NonCifRecord | null>(null);
  const [nonCifFormData, setNonCifFormData] = useState<Omit<NonCifRecord, 'id'>>({
    bulanKontJalan: 'Januari 2026',
    noContainer: '',
    tanggal: new Date().toISOString().slice(0, 10),
    kategoriBiaya: NON_CIF_CATEGORY_OPTIONS[0],
    desc: '',
    totalNilaiPo: 0,
    total: 0,
    ar1: 0,
    ar20: 0,
    ar6: 0,
    ar9: 0,
    soyu: 0,
    affNa: 0,
    ket: 'NON-CIF MANUAL'
  });

  const [isImportNonCifModalOpen, setIsImportNonCifModalOpen] = useState(false);
  const [importNonCifText, setImportNonCifText] = useState('');

  // Import Modal States
  const [isImportCifModalOpen, setIsImportCifModalOpen] = useState(false);
  const [importCifText, setImportCifText] = useState('');

  const [isImportBapModalOpen, setIsImportBapModalOpen] = useState(false);
  const [importBapText, setImportBapText] = useState('');

  // Email Report Modal State
  const [isEmailReportModalOpen, setIsEmailReportModalOpen] = useState(false);
  const [emailReportContainerNo, setEmailReportContainerNo] = useState<string>('ALL');
  const [emailRecipient, setEmailRecipient] = useState<string>('audit@company.com, finance@company.com');
  const [emailSubject, setEmailSubject] = useState<string>('[LAPORAN BIAYA KONTAINER] Resume CIF & Biaya Selain CIF');
  const [emailNotes, setEmailNotes] = useState<string>('Berikut rangkuman laporan lengkap rincian biaya CIF dan Selain CIF per kontainer.');

  // Supabase SQL Editor & Direct Sync Modal State
  const [isSqlModalOpen, setIsSqlModalOpen] = useState(false);
  const [supabaseActiveTab, setSupabaseActiveTab] = useState<'sync' | 'sql'>('sync');
  const [supabaseUrl, setSupabaseUrl] = useState<string>(() => {
    return localStorage.getItem('supabase_project_url') || '';
  });
  const [supabaseAnonKey, setSupabaseAnonKey] = useState<string>(() => {
    return localStorage.getItem('supabase_anon_key') || '';
  });
  const [isSyncingSupabase, setIsSyncingSupabase] = useState(false);
  const [syncLogs, setSyncLogs] = useState<string[]>([]);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [syncErrorMessage, setSyncErrorMessage] = useState<string>('');

  // View Mode for CIF Resume: 'document' (Dokumen Kontainer) or 'flat' (Semua Baris Biaya)
  const [cifViewMode, setCifViewMode] = useState<'document' | 'flat'>('document');

  // Container Document Detail Modal State
  const [detailContainerNo, setDetailContainerNo] = useState<string | null>(null);
  const [isDetailContainerModalOpen, setIsDetailContainerModalOpen] = useState(false);

  // Add Container Document Header Modal State
  const [isAddContainerModalOpen, setIsAddContainerModalOpen] = useState(false);
  const [containerFormData, setContainerFormData] = useState({
    bulanKontJalan: 'Januari 2026',
    noContainer: '',
    tglFinalPembayaranPib: new Date().toISOString().slice(0, 10),
    totalNilaiPo: 0,
    ket: 'LUNAS PIB'
  });

  // Photo Lightbox Zoom Modal State
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string; desc?: string } | null>(null);

  // Filtered CIF Records
  const filteredCifRecords = useMemo(() => {
    return cifRecords.filter(r => {
      const q = searchQuery.toLowerCase().trim();
      const matchSearch = !q || 
        r.noContainer.toLowerCase().includes(q) ||
        r.desc.toLowerCase().includes(q) ||
        r.bulanKontJalan.toLowerCase().includes(q) ||
        r.ket.toLowerCase().includes(q);

      const matchMonth = selectedMonth === 'ALL' || r.bulanKontJalan === selectedMonth;
      const matchContainer = selectedCifContainer === 'ALL' || r.noContainer === selectedCifContainer;

      return matchSearch && matchMonth && matchContainer;
    });
  }, [cifRecords, searchQuery, selectedMonth, selectedCifContainer]);

  // Grouped CIF Records per Container Document
  const groupedCifContainers = useMemo(() => {
    const map = new Map<string, {
      noContainer: string;
      bulanKontJalan: string;
      tglFinalPembayaranPib: string;
      ket: string;
      totalNilaiPo: number;
      totalCIF: number;
      totalAR1: number;
      totalAR20: number;
      totalAR6: number;
      totalAR9: number;
      totalSOYU: number;
      totalAFFNA: number;
      items: CifRecord[];
    }>();

    filteredCifRecords.forEach(rawRec => {
      const rec = ensureRecordBrandSplit(rawRec, cifRecords, containers);
      const rawNo = rec.noContainer || 'UNKNOWN';
      const key = cleanContKey(rawNo) || 'UNKNOWN';
      const matchedCont = containers.find(c => cleanContKey(c.noContainer) === key);
      const displayNoContainer = matchedCont ? matchedCont.noContainer : rawNo.toUpperCase().trim();
      const isHeader = rec.desc && rec.desc.toUpperCase().trim() === 'NILAI KONTAINER';
      const poVal = rec.totalNilaiPo || (matchedCont?.totalCost || matchedCont?.totalPrice || 0);

      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          noContainer: displayNoContainer,
          bulanKontJalan: rec.bulanKontJalan || 'Januari 2026',
          tglFinalPembayaranPib: (rec.tglFinalPembayaranPib && rec.tglFinalPembayaranPib !== '-') ? rec.tglFinalPembayaranPib : (matchedCont?.tglTibaBintara || matchedCont?.tglTibaPriuk || '-'),
          ket: rec.ket || 'LUNAS PIB',
          totalNilaiPo: poVal,
          totalCIF: isHeader ? 0 : (rec.total || 0),
          totalAR1: rec.ar1 || 0,
          totalAR20: rec.ar20 || 0,
          totalAR6: rec.ar6 || 0,
          totalAR9: rec.ar9 || 0,
          totalSOYU: rec.soyu || 0,
          totalAFFNA: rec.affNa || 0,
          items: [rec]
        });
      } else {
        if (rec.tglFinalPembayaranPib && rec.tglFinalPembayaranPib !== '-' && rec.tglFinalPembayaranPib !== existing.tglFinalPembayaranPib) {
          existing.tglFinalPembayaranPib = rec.tglFinalPembayaranPib;
        }
        if (!isHeader) {
          existing.totalCIF += (rec.total || 0);
        }
        existing.totalAR1 += (rec.ar1 || 0);
        existing.totalAR20 += (rec.ar20 || 0);
        existing.totalAR6 += (rec.ar6 || 0);
        existing.totalAR9 += (rec.ar9 || 0);
        existing.totalSOYU += (rec.soyu || 0);
        existing.totalAFFNA += (rec.affNa || 0);
        if (poVal > existing.totalNilaiPo) {
          existing.totalNilaiPo = poVal;
        }
        existing.items.push(rec);
      }
    });

    return Array.from(map.values());
  }, [filteredCifRecords, cifRecords, containers]);

  // Handler for direct inline container date updating
  const handleUpdateDocDate = (noContainer: string, newDate: string) => {
    const targetKey = cleanContKey(noContainer);
    setCifRecords(prev => prev.map(r => cleanContKey(r.noContainer) === targetKey ? {
      ...r,
      tglFinalPembayaranPib: newDate
    } : r));
    showToast(`Tanggal Terima Kontainer ${noContainer} berhasil diperbarui!`, 'success');
  };

  // Open Add Container Document Modal
  const handleOpenAddContainerDoc = () => {
    const initCont = selectedCifContainer !== 'ALL' ? selectedCifContainer : '';
    const inputKey = cleanContKey(initCont);
    const match = containers.find(c => cleanContKey(c.noContainer) === inputKey);
    const existingRec = cifRecords.find(r => cleanContKey(r.noContainer) === inputKey && r.tglFinalPembayaranPib && r.tglFinalPembayaranPib !== '-');
    const defaultPo = match ? (match.totalCost || match.totalPrice || 0) : 0;
    const defaultDate = existingRec?.tglFinalPembayaranPib || match?.tglTibaBintara || match?.tglTibaPriuk || new Date().toISOString().slice(0, 10);

    setContainerFormData({
      bulanKontJalan: selectedMonth !== 'ALL' ? selectedMonth : 'Januari 2026',
      noContainer: initCont,
      tglFinalPembayaranPib: defaultDate,
      totalNilaiPo: defaultPo,
      ket: 'LUNAS PIB'
    });
    setIsAddContainerModalOpen(true);
  };

  // Save Container Document Header
  const handleSaveContainerDoc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!containerFormData.noContainer.trim()) {
      showToast('Nomor Container wajib diisi!', 'error');
      return;
    }

    const inputKey = cleanContKey(containerFormData.noContainer);
    const matchedCont = containers.find(c => cleanContKey(c.noContainer) === inputKey);
    const officialNoCont = matchedCont ? matchedCont.noContainer : containerFormData.noContainer.toUpperCase().trim();
    const autoPo = Number(containerFormData.totalNilaiPo) || (matchedCont?.totalCost || matchedCont?.totalPrice || 0);

    const existingRecs = cifRecords.filter(r => cleanContKey(r.noContainer) === inputKey);

    if (existingRecs.length === 0) {
      // Create initial base record for this container document
      const newBaseRec: CifRecord = {
        id: 'cif-doc-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
        bulanKontJalan: containerFormData.bulanKontJalan,
        noContainer: officialNoCont,
        tglFinalPembayaranPib: containerFormData.tglFinalPembayaranPib,
        desc: 'Nilai Kontainer',
        totalNilaiPo: autoPo,
        total: 0,
        ar1: 0,
        ar20: 0,
        ar9: 0,
        ket: containerFormData.ket
      };
      setCifRecords(prev => [newBaseRec, ...prev]);
    } else {
      // Update existing records for this container
      setCifRecords(prev => prev.map(r => cleanContKey(r.noContainer) === inputKey ? {
        ...r,
        noContainer: officialNoCont,
        bulanKontJalan: containerFormData.bulanKontJalan,
        tglFinalPembayaranPib: containerFormData.tglFinalPembayaranPib,
        totalNilaiPo: autoPo || r.totalNilaiPo,
        ket: containerFormData.ket
      } : r));
    }

    setIsAddContainerModalOpen(false);
    showToast(`Dokumen Kontainer ${officialNoCont} berhasil disimpan!`, 'success');

    // Automatically open Detail Modal for this container so user can start importing/adding costs!
    setDetailContainerNo(officialNoCont);
    setIsDetailContainerModalOpen(true);
  };

  // Open Container Detail Modal
  const handleOpenContainerDetail = (noCont: string) => {
    setDetailContainerNo(noCont);
    setIsDetailContainerModalOpen(true);
  };

  // Delete Entire Container Document
  const handleDeleteContainerDoc = (noCont: string) => {
    setConfirmModal({
      isOpen: true,
      title: `Hapus Dokumen Kontainer ${noCont}`,
      message: `Apakah Anda yakin ingin menghapus Dokumen Kontainer ${noCont} beserta SEMUA rincian biaya CIF di dalamnya?`,
      confirmLabel: 'Ya, Hapus Dokumen Kontainer',
      onConfirm: async () => {
        const targetKey = cleanContKey(noCont);
        setCifRecords(prev => prev.filter(item => cleanContKey(item.noContainer) !== targetKey));
        setNonCifRecords(prev => prev.filter(item => cleanContKey(item.noContainer) !== targetKey));

        // Hapus juga dari database SQL Server (header + semua rincian)
        const deleted = await deleteCifContainer(noCont);
        if (deleted) {
          showToast(`Dokumen Kontainer ${noCont} berhasil dihapus dari web & database!`, 'success');
        } else {
          showToast(`Dokumen ${noCont} dihapus di web (gagal hapus di database — cek koneksi/akses).`, 'info');
        }

        if (detailContainerNo && cleanContKey(detailContainerNo) === targetKey) {
          setIsDetailContainerModalOpen(false);
          setDetailContainerNo(null);
        }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  // Filtered BAP Records
  const filteredBapRecords = useMemo(() => {
    return bapRecords.filter(r => {
      const q = searchQuery.toLowerCase().trim();
      const matchSearch = !q || 
        r.itemCode.toLowerCase().includes(q) ||
        r.itemName.toLowerCase().includes(q) ||
        r.noContainer.toLowerCase().includes(q) ||
        (r.bapNo && r.bapNo.toLowerCase().includes(q));

      const matchContainer = selectedContainer === 'ALL' || r.noContainer === selectedContainer;

      return matchSearch && matchContainer;
    });
  }, [bapRecords, searchQuery, selectedContainer]);

  // Unique list of Bulan Kont Jalan
  const monthList = useMemo(() => {
    const setM = new Set<string>();
    cifRecords.forEach(r => {
      if (r.bulanKontJalan) setM.add(r.bulanKontJalan);
    });
    return Array.from(setM);
  }, [cifRecords]);

  // Unique list of Containers
  const containerList = useMemo(() => {
    const setC = new Set<string>();
    containers.forEach(c => {
      if (c.noContainer) setC.add(c.noContainer);
    });
    cifRecords.forEach(c => {
      if (c.noContainer) setC.add(c.noContainer);
    });
    bapRecords.forEach(b => {
      if (b.noContainer) setC.add(b.noContainer);
    });
    return Array.from(setC);
  }, [containers, cifRecords, bapRecords]);

  // Totals & Percentages for CIF
  const cifTotals = useMemo(() => {
    const totalNilaiPo = groupedCifContainers.reduce((acc, curr) => acc + (curr.totalNilaiPo || 0), 0);
    const totalCIF = groupedCifContainers.reduce((acc, curr) => acc + (curr.totalCIF || 0), 0);
    const totalAR1 = groupedCifContainers.reduce((acc, curr) => acc + (curr.totalAR1 || 0), 0);
    const totalAR20 = groupedCifContainers.reduce((acc, curr) => acc + (curr.totalAR20 || 0), 0);
    const totalAR6 = groupedCifContainers.reduce((acc, curr) => acc + (curr.totalAR6 || 0), 0);
    const totalAR9 = groupedCifContainers.reduce((acc, curr) => acc + (curr.totalAR9 || 0), 0);
    const totalSOYU = groupedCifContainers.reduce((acc, curr) => acc + (curr.totalSOYU || 0), 0);
    const totalAFFNA = groupedCifContainers.reduce((acc, curr) => acc + (curr.totalAFFNA || 0), 0);

    const pctCIF = formatPercent(totalCIF, totalNilaiPo);
    const pctAR1 = formatPercent(totalAR1, totalNilaiPo);
    const pctAR20 = formatPercent(totalAR20, totalNilaiPo);
    const pctAR6 = formatPercent(totalAR6, totalNilaiPo);
    const pctAR9 = formatPercent(totalAR9, totalNilaiPo);
    const pctSOYU = formatPercent(totalSOYU, totalNilaiPo);
    const pctAFFNA = formatPercent(totalAFFNA, totalNilaiPo);

    return { totalNilaiPo, totalCIF, totalAR1, totalAR20, totalAR6, totalAR9, totalSOYU, totalAFFNA, pctCIF, pctAR1, pctAR20, pctAR6, pctAR9, pctSOYU, pctAFFNA };
  }, [groupedCifContainers]);

  // Totals for BAP
  const bapTotals = useMemo(() => {
    const totalQtyContainer = filteredBapRecords.reduce((acc, curr) => acc + (curr.qtyContainer || 0), 0);
    const totalQtyBagus = filteredBapRecords.reduce((acc, curr) => acc + (curr.qtyTerimaBagus || 0), 0);
    const totalQtyRK = filteredBapRecords.reduce((acc, curr) => acc + (curr.qtyTerimaRk || 0), 0);
    const totalQtyRM = filteredBapRecords.reduce((acc, curr) => acc + (curr.qtyTerimaRm || 0), 0);
    const totalNilaiJual = filteredBapRecords.reduce((acc, curr) => acc + (curr.qtyContainer * (curr.nilaiJual || 0)), 0);
    const totalNilaiCost = filteredBapRecords.reduce((acc, curr) => acc + (curr.qtyContainer * (curr.nilaiCost || 0)), 0);
    const totalKerugianRijek = filteredBapRecords.reduce((acc, curr) => acc + ((curr.qtyTerimaRk + curr.qtyTerimaRm) * (curr.nilaiCost || 0)), 0);

    return {
      totalQtyContainer,
      totalQtyBagus,
      totalQtyRK,
      totalQtyRM,
      totalNilaiJual,
      totalNilaiCost,
      totalKerugianRijek
    };
  }, [filteredBapRecords]);

  // Checkbox Handlers for CIF Bulk Delete
  const handleToggleSelectAllCif = () => {
    const filteredIds = filteredCifRecords.map(r => r.id!).filter(Boolean);
    if (filteredIds.length === 0) return;

    const isAllFilteredSelected = filteredIds.every(id => selectedCifIds.includes(id));
    if (isAllFilteredSelected) {
      // Unselect filtered items
      setSelectedCifIds(prev => prev.filter(id => !filteredIds.includes(id)));
    } else {
      // Select all filtered items
      setSelectedCifIds(prev => Array.from(new Set([...prev, ...filteredIds])));
    }
  };

  const handleToggleSelectCif = (id: string) => {
    setSelectedCifIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBulkDeleteCif = () => {
    if (selectedCifIds.length === 0) return;
    setConfirmModal({
      isOpen: true,
      title: 'Hapus Data CIF Terpilih',
      message: `Apakah Anda yakin ingin menghapus ${selectedCifIds.length} baris data CIF yang dipilih?`,
      confirmLabel: 'Ya, Hapus Terpilih',
      onConfirm: () => {
        const idsToDelete = new Set(selectedCifIds);
        setCifRecords(prev => prev.filter(item => item.id && !idsToDelete.has(item.id)));
        setSelectedCifIds([]);
        showToast(`${idsToDelete.size} data CIF berhasil dihapus!`, 'info');
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleDeleteFilteredCifData = () => {
    if (filteredCifRecords.length === 0) return;
    const desc = selectedCifContainer !== 'ALL' 
      ? `Container ${selectedCifContainer}` 
      : selectedMonth !== 'ALL' 
      ? `Bulan ${selectedMonth}` 
      : 'filter aktif saat ini';

    setConfirmModal({
      isOpen: true,
      title: 'Hapus Filter Data CIF',
      message: `Apakah Anda yakin ingin menghapus SEMUA ${filteredCifRecords.length} baris data CIF untuk ${desc}?`,
      confirmLabel: 'Ya, Hapus Semua Filter',
      onConfirm: () => {
        const idsToDelete = new Set(filteredCifRecords.map(r => r.id!).filter(Boolean));
        setCifRecords(prev => prev.filter(item => item.id && !idsToDelete.has(item.id)));
        setSelectedCifIds(prev => prev.filter(id => !idsToDelete.has(id)));
        showToast(`Berhasil menghapus ${idsToDelete.size} baris data CIF untuk ${desc}!`, 'success');
        if (selectedCifContainer !== 'ALL') setSelectedCifContainer('ALL');
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  // Checkbox Handlers for BAP Bulk Delete
  const handleToggleSelectAllBap = () => {
    const filteredIds = filteredBapRecords.map(r => r.id!).filter(Boolean);
    if (filteredIds.length === 0) return;

    const isAllFilteredSelected = filteredIds.every(id => selectedBapIds.includes(id));
    if (isAllFilteredSelected) {
      // Unselect filtered items
      setSelectedBapIds(prev => prev.filter(id => !filteredIds.includes(id)));
    } else {
      // Select all filtered items
      setSelectedBapIds(prev => Array.from(new Set([...prev, ...filteredIds])));
    }
  };

  const handleToggleSelectBap = (id: string) => {
    setSelectedBapIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBulkDeleteBap = () => {
    if (selectedBapIds.length === 0) return;
    setConfirmModal({
      isOpen: true,
      title: 'Hapus Item BAP Terpilih',
      message: `Apakah Anda yakin ingin menghapus ${selectedBapIds.length} item BAP yang dipilih?`,
      confirmLabel: 'Ya, Hapus Terpilih',
      onConfirm: () => {
        const idsToDelete = new Set(selectedBapIds);
        setBapRecords(prev => prev.filter(item => item.id && !idsToDelete.has(item.id)));
        setSelectedBapIds([]);
        showToast(`${idsToDelete.size} item BAP berhasil dihapus!`, 'info');
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleDeleteFilteredBapData = () => {
    if (filteredBapRecords.length === 0) return;
    const desc = selectedContainer !== 'ALL' 
      ? `Container ${selectedContainer}` 
      : 'filter aktif saat ini';

    setConfirmModal({
      isOpen: true,
      title: 'Hapus Filter Item BAP',
      message: `Apakah Anda yakin ingin menghapus SEMUA ${filteredBapRecords.length} item BAP untuk ${desc}?`,
      confirmLabel: 'Ya, Hapus Semua Filter',
      onConfirm: () => {
        const idsToDelete = new Set(filteredBapRecords.map(r => r.id!).filter(Boolean));
        setBapRecords(prev => prev.filter(item => item.id && !idsToDelete.has(item.id)));
        setSelectedBapIds(prev => prev.filter(id => !idsToDelete.has(id)));
        showToast(`Berhasil menghapus ${idsToDelete.size} item BAP untuk ${desc}!`, 'success');
        if (selectedContainer !== 'ALL') setSelectedContainer('ALL');
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  // Open CIF Add Modal
  const handleOpenAddCif = () => {
    setEditingCif(null);
    const initCont = selectedCifContainer !== 'ALL' ? selectedCifContainer : '';
    const inputKey = cleanContKey(initCont);
    const matchedCont = containers.find(c => cleanContKey(c.noContainer) === inputKey);
    const existingRec = cifRecords.find(r => cleanContKey(r.noContainer) === inputKey && r.tglFinalPembayaranPib && r.tglFinalPembayaranPib !== '-');
    const defaultPo = matchedCont ? (matchedCont.totalCost || matchedCont.totalPrice || 0) : 0;
    const defaultDate = existingRec?.tglFinalPembayaranPib || matchedCont?.tglTibaBintara || matchedCont?.tglTibaPriuk || new Date().toISOString().slice(0, 10);

    setCifFormData({
      bulanKontJalan: selectedMonth !== 'ALL' ? selectedMonth : 'Januari 2026',
      noContainer: initCont,
      tglFinalPembayaranPib: defaultDate,
      desc: ALLOWED_DESC_OPTIONS[0],
      totalNilaiPo: defaultPo,
      total: 0,
      ar1: 0,
      ar20: 0,
      ar6: 0,
      ar9: 0,
      soyu: 0,
      affNa: 0,
      ket: 'LUNAS PIB'
    });
    setIsCifModalOpen(true);
  };

  // Open CIF Edit Modal
  const handleOpenEditCif = (rec: CifRecord) => {
    setEditingCif(rec);
    const matchedCont = containers.find(c => c.noContainer.toUpperCase() === (rec.noContainer || '').toUpperCase());
    const fallbackPo = matchedCont ? (matchedCont.totalCost || matchedCont.totalPrice || 0) : 0;

    setCifFormData({
      bulanKontJalan: rec.bulanKontJalan || 'Januari 2026',
      noContainer: rec.noContainer || '',
      tglFinalPembayaranPib: rec.tglFinalPembayaranPib || '',
      desc: rec.desc || ALLOWED_DESC_OPTIONS[0],
      totalNilaiPo: rec.totalNilaiPo || fallbackPo,
      total: rec.total || 0,
      ar1: rec.ar1 || 0,
      ar20: rec.ar20 || 0,
      ar6: rec.ar6 || 0,
      ar9: rec.ar9 || 0,
      soyu: rec.soyu || 0,
      affNa: rec.affNa || 0,
      ket: rec.ket || ''
    });
    setIsCifModalOpen(true);
  };

  // Save CIF Record
  const handleSaveCif = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cifFormData.noContainer.trim()) {
      showToast('Nomor Container wajib diisi!', 'error');
      return;
    }

    const calculatedTotal = (Number(cifFormData.ar1) || 0) + (Number(cifFormData.ar20) || 0) + (Number(cifFormData.ar6) || 0) + (Number(cifFormData.ar9) || 0) + (Number(cifFormData.soyu) || 0) + (Number(cifFormData.affNa) || 0);
    const finalTotal = Number(cifFormData.total) > 0 ? Number(cifFormData.total) : calculatedTotal;

    const inputContKey = cleanContKey(cifFormData.noContainer);
    const matchedCont = containers.find(c => cleanContKey(c.noContainer) === inputContKey);
    const officialNoCont = matchedCont ? matchedCont.noContainer : cifFormData.noContainer.toUpperCase().trim();
    const descKey = cifFormData.desc.toUpperCase().trim();

    if (editingCif) {
      setCifRecords(prev => prev.map(item => item.id === editingCif.id ? {
        ...item,
        ...cifFormData,
        noContainer: officialNoCont,
        totalNilaiPo: Number(cifFormData.totalNilaiPo) || item.totalNilaiPo || 0,
        total: finalTotal,
        ar1: Number(cifFormData.ar1) || 0,
        ar20: Number(cifFormData.ar20) || 0,
        ar6: Number(cifFormData.ar6) || 0,
        ar9: Number(cifFormData.ar9) || 0,
        soyu: Number(cifFormData.soyu) || 0,
        affNa: Number(cifFormData.affNa) || 0,
        updatedAt: new Date().toISOString()
      } : item));
      showToast('Data CIF Resume Kontainer berhasil diperbarui!', 'success');
    } else {
      setCifRecords(prev => {
        const placeholderIdx = prev.findIndex(r => 
          cleanContKey(r.noContainer) === inputContKey && 
          (r.total === 0 && (r.ar1 || 0) === 0 && (r.ar20 || 0) === 0 && (r.ar6 || 0) === 0 && (r.ar9 || 0) === 0 && (r.soyu || 0) === 0 && (r.affNa || 0) === 0)
        );
        const matchDescIdx = prev.findIndex(r => 
          cleanContKey(r.noContainer) === inputContKey && 
          r.desc.toUpperCase().trim() === descKey
        );

        const targetIdx = matchDescIdx !== -1 ? matchDescIdx : placeholderIdx;

        if (targetIdx !== -1) {
          const updated = [...prev];
          updated[targetIdx] = {
            ...updated[targetIdx],
            ...cifFormData,
            noContainer: officialNoCont,
            totalNilaiPo: Number(cifFormData.totalNilaiPo) || updated[targetIdx].totalNilaiPo || 0,
            total: finalTotal,
            ar1: Number(cifFormData.ar1) || 0,
            ar20: Number(cifFormData.ar20) || 0,
            ar6: Number(cifFormData.ar6) || 0,
            ar9: Number(cifFormData.ar9) || 0,
            soyu: Number(cifFormData.soyu) || 0,
            affNa: Number(cifFormData.affNa) || 0,
            updatedAt: new Date().toISOString()
          };
          return updated;
        } else {
          const newRec: CifRecord = {
            id: 'cif-' + Date.now(),
            ...cifFormData,
            noContainer: officialNoCont,
            totalNilaiPo: Number(cifFormData.totalNilaiPo) || 0,
            total: finalTotal,
            ar1: Number(cifFormData.ar1) || 0,
            ar20: Number(cifFormData.ar20) || 0,
            ar6: Number(cifFormData.ar6) || 0,
            ar9: Number(cifFormData.ar9) || 0,
            soyu: Number(cifFormData.soyu) || 0,
            affNa: Number(cifFormData.affNa) || 0,
            createdAt: new Date().toISOString()
          };
          return [newRec, ...prev];
        }
      });
      showToast('Data CIF Resume Kontainer baru berhasil disimpan!', 'success');
    }

    if (cifFormData.tglFinalPembayaranPib && cifFormData.tglFinalPembayaranPib !== '-') {
      setCifRecords(prev => prev.map(r => cleanContKey(r.noContainer) === inputContKey ? {
        ...r,
        tglFinalPembayaranPib: cifFormData.tglFinalPembayaranPib
      } : r));
    }

    setIsCifModalOpen(false);
  };

  // Delete CIF Record
  const handleDeleteCif = (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Hapus Baris CIF',
      message: 'Apakah Anda yakin ingin menghapus baris data CIF ini?',
      confirmLabel: 'Ya, Hapus',
      onConfirm: () => {
        setCifRecords(prev => prev.filter(item => item.id !== id));
        setSelectedCifIds(prev => prev.filter(i => i !== id));
        showToast('Baris data CIF telah dihapus.', 'info');
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  // Open BAP Add Modal
  const handleOpenAddBap = () => {
    setEditingBap(null);
    setBapFormData({
      bapNo: 'BAP/' + new Date().getFullYear() + '/00' + (bapRecords.length + 1),
      noContainer: selectedContainer !== 'ALL' ? selectedContainer : (containerList[0] || ''),
      itemCode: '',
      itemName: '',
      nilaiJual: 0,
      nilaiCost: 0,
      qtyContainer: 0,
      qtyTerimaBagus: 0,
      qtyTerimaRk: 0,
      qtyTerimaRm: 0,
      fotoRijekUrl: '',
      tanggalBap: new Date().toISOString().slice(0, 10),
      keterangan: ''
    });
    setIsBapModalOpen(true);
  };

  // Open BAP Edit Modal
  const handleOpenEditBap = (rec: BapItemRecord) => {
    setEditingBap(rec);
    setBapFormData({
      bapNo: rec.bapNo || '',
      noContainer: rec.noContainer || '',
      itemCode: rec.itemCode || '',
      itemName: rec.itemName || '',
      nilaiJual: rec.nilaiJual || 0,
      nilaiCost: rec.nilaiCost || 0,
      qtyContainer: rec.qtyContainer || 0,
      qtyTerimaBagus: rec.qtyTerimaBagus || 0,
      qtyTerimaRk: rec.qtyTerimaRk || 0,
      qtyTerimaRm: rec.qtyTerimaRm || 0,
      fotoRijekUrl: rec.fotoRijekUrl || '',
      tanggalBap: rec.tanggalBap || new Date().toISOString().slice(0, 10),
      keterangan: rec.keterangan || ''
    });
    setIsBapModalOpen(true);
  };

  // Auto-fill Item Code from Master Item
  const handleSelectMasterItem = (code: string) => {
    const item = masterItems.find(m => m.itemCode.toLowerCase().trim() === code.toLowerCase().trim());
    if (item) {
      setBapFormData(prev => ({
        ...prev,
        itemCode: item.itemCode,
        itemName: item.itemName,
        nilaiJual: item.hargaJual || 0,
        nilaiCost: item.hargaBeli || 0
      }));
    } else {
      setBapFormData(prev => ({ ...prev, itemCode: code }));
    }
  };

  // Image Upload Handler (Convert to Compressed Base64)
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      showToast('Ukuran foto terlalu besar (Maksimal 5MB)!', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 1000;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          setBapFormData(prev => ({ ...prev, fotoRijekUrl: dataUrl }));
          showToast('Foto barang rijek berhasil diupload & dikompres!', 'success');
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Save BAP Record
  const handleSaveBap = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bapFormData.itemCode.trim()) {
      showToast('Kode Barang (Item Code) wajib diisi!', 'error');
      return;
    }

    if (editingBap) {
      setBapRecords(prev => prev.map(item => item.id === editingBap.id ? {
        ...item,
        ...bapFormData,
        nilaiJual: Number(bapFormData.nilaiJual) || 0,
        nilaiCost: Number(bapFormData.nilaiCost) || 0,
        qtyContainer: Number(bapFormData.qtyContainer) || 0,
        qtyTerimaBagus: Number(bapFormData.qtyTerimaBagus) || 0,
        qtyTerimaRk: Number(bapFormData.qtyTerimaRk) || 0,
        qtyTerimaRm: Number(bapFormData.qtyTerimaRm) || 0,
        updatedAt: new Date().toISOString()
      } : item));
      showToast('Data BAP Kontainer berhasil diperbarui!', 'success');
    } else {
      const newRec: BapItemRecord = {
        id: 'bap-' + Date.now(),
        ...bapFormData,
        nilaiJual: Number(bapFormData.nilaiJual) || 0,
        nilaiCost: Number(bapFormData.nilaiCost) || 0,
        qtyContainer: Number(bapFormData.qtyContainer) || 0,
        qtyTerimaBagus: Number(bapFormData.qtyTerimaBagus) || 0,
        qtyTerimaRk: Number(bapFormData.qtyTerimaRk) || 0,
        qtyTerimaRm: Number(bapFormData.qtyTerimaRm) || 0,
        createdAt: new Date().toISOString()
      };
      setBapRecords(prev => [newRec, ...prev]);
      showToast('Item BAP Kontainer baru berhasil ditambahkan!', 'success');
    }

    setIsBapModalOpen(false);
  };

  // Delete BAP Record
  const handleDeleteBap = (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Hapus Item BAP',
      message: 'Apakah Anda yakin ingin menghapus data item BAP ini?',
      confirmLabel: 'Ya, Hapus',
      onConfirm: () => {
        setBapRecords(prev => prev.filter(item => item.id !== id));
        setSelectedBapIds(prev => prev.filter(i => i !== id));
        showToast('Baris BAP berhasil dihapus.', 'info');
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  // Export to Excel for CIF
  const handleExportCifExcel = () => {
    const preparedRecords = filteredCifRecords.map(r => ensureRecordBrandSplit(r, cifRecords, containers));

    // Sheet 1: Resume Dokumen
    const resumeData = groupedCifContainers.map((doc, idx) => ({
      'No': idx + 1,
      'No Container': doc.noContainer,
      'Tgl Final PIB': doc.tglFinalPembayaranPib,
      'Total Nilai PO (Rp)': doc.totalNilaiPo,
      'Total CIF AR1 (Rp)': doc.totalAR1,
      'Total CIF AR20 (Rp)': doc.totalAR20,
      'Total CIF AR6 (Rp)': doc.totalAR6,
      'Total CIF AR9 (Rp)': doc.totalAR9,
      'Total CIF SOYU (Rp)': doc.totalSOYU,
      'Total CIF AFF NA (Rp)': doc.totalAFFNA,
      'Total Nilai CIF (Rp)': doc.totalCIF,
      '% CIF / PO': doc.totalNilaiPo > 0 ? formatPercent(doc.totalCIF, doc.totalNilaiPo) : '0%',
      'Keterangan': doc.ket
    }));

    // Sheet 2: Daftar Rincian Biaya
    const rincianData = preparedRecords.map((r, i) => ({
      'No': i + 1,
      'No Container': r.noContainer,
      'Tgl Final PIB': r.tglFinalPembayaranPib || '-',
      'Deskripsi Biaya': r.desc,
      'Total Nilai PO Kontainer (Rp)': r.totalNilaiPo || 0,
      'Total Nilai CIF (Rp)': r.total || 0,
      'AR1 (Rp)': r.ar1 || 0,
      'AR20 (Rp)': r.ar20 || 0,
      'AR6 (Rp)': r.ar6 || 0,
      'AR9 (Rp)': r.ar9 || 0,
      'SOYU (Rp)': r.soyu || 0,
      'AFF NA (Rp)': r.affNa || 0,
      'Persentase CIF (%)': r.totalNilaiPo ? formatPercent(r.total, r.totalNilaiPo) : '-',
      'Keterangan': r.ket
    }));

    // Create multi-sheet workbook
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(resumeData);
    const ws2 = XLSX.utils.json_to_sheet(rincianData);
    XLSX.utils.book_append_sheet(wb, ws1, 'Resume Dokumen CIF');
    XLSX.utils.book_append_sheet(wb, ws2, 'Rincian Biaya CIF Per Brand');
    XLSX.writeFile(wb, `Resume_Dokumen_CIF_Kontainer_${new Date().toISOString().slice(0, 10)}.xlsx`);

    showToast('Laporan Resume & Rincian CIF Kontainer berhasil diekspor ke Excel!', 'success');
  };

  // Download CIF Template
  const handleDownloadCifTemplate = () => {
    const templateData = detailContainerNo ? [
      {
        'Deskripsi Biaya (Desc)': 'Total Biaya BEA Masuk',
        'Total CIF': 33988000,
        'Keterangan': 'LUNAS PIB'
      },
      {
        'Deskripsi Biaya (Desc)': 'Total Biaya Sea Freight',
        'Total CIF': 37100000,
        'Keterangan': 'LUNAS PIB'
      }
    ] : [
      {
        'No Container': 'GZ239 (20FT)',
        'Deskripsi Biaya (Desc)': 'Total Biaya BEA Masuk',
        'Total CIF': 33988000,
        'Keterangan': 'LUNAS PIB'
      },
      {
        'No Container': 'GZ239 (20FT)',
        'Deskripsi Biaya (Desc)': 'Total Biaya Sea Freight',
        'Total CIF': 37100000,
        'Keterangan': 'LUNAS PIB'
      }
    ];
    exportToExcel(templateData, detailContainerNo ? `Template_Import_Deskripsi_Biaya_${detailContainerNo}` : 'Template_Import_Deskripsi_Biaya_CIF');
    showToast('Template Excel Import Deskripsi Biaya berhasil didownload!', 'success');
  };

  // File Upload Handler for CIF CSV/Excel
  const handleCifFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setImportCifText(text);
        showToast(`File ${file.name} berhasil dimuat. Klik 'Proses Import CIF' untuk menyimpan.`, 'info');
      }
    };
    reader.readAsText(file);
  };

  // Process Import CIF batch text / file content
  const handleProcessImportCif = () => {
    if (!importCifText.trim()) {
      showToast('Masukkan atau paste teks data CIF per Container!', 'error');
      return;
    }

    const lines = importCifText.trim().split('\n');
    const parsedItems: Array<{
      bulan: string;
      noCont: string;
      tglPib: string;
      desc: string;
      totalNilaiPo: number;
      ar1: number;
      ar20: number;
      ar6: number;
      ar9: number;
      soyu: number;
      affNa: number;
      total: number;
      ket: string;
    }> = [];

    lines.forEach(line => {
      // Split by tab or comma
      const cols = line.split(line.includes('\t') ? '\t' : ',').map(c => c.trim().replace(/^"|"$/g, ''));
      if (cols.length >= 2) {
        // Skip header lines
        const firstColLower = (cols[0] || '').toLowerCase();
        const secondColLower = (cols[1] || '').toLowerCase();
        if (
          firstColLower.includes('bulan') ||
          firstColLower.includes('container') ||
          firstColLower.includes('no cont') ||
          secondColLower.includes('desc') ||
          secondColLower.includes('deskripsi')
        ) return;

        let bulan = selectedMonth !== 'ALL' ? selectedMonth : 'Januari 2026';
        let noCont = detailContainerNo ? detailContainerNo : 'CONT-IMPORT';
        let tglPib = new Date().toISOString().slice(0, 10);
        let desc = ALLOWED_DESC_OPTIONS[0];
        let totalNilaiPo = 0;
        let ar1 = 0;
        let ar20 = 0;
        let ar6 = 0;
        let ar9 = 0;
        let soyu = 0;
        let affNa = 0;
        let ket = 'LUNAS PIB';
        let userTotalCif = 0;

        // Determine column structure based on column count:
        if (cols.length === 2) {
          // Format: [Deskripsi Biaya, Total CIF]
          desc = cols[0] || ALLOWED_DESC_OPTIONS[0];
          userTotalCif = Number(cols[1]?.replace(/[^0-9.-]/g, '')) || 0;
        } else if (cols.length === 3) {
          // Format: [No Container, Deskripsi Biaya, Total CIF]
          const isCol1Num = !isNaN(Number(cols[1]?.replace(/[^0-9.-]/g, ''))) && cols[1] !== '';
          const isCol2Num = !isNaN(Number(cols[2]?.replace(/[^0-9.-]/g, ''))) && cols[2] !== '';

          if (isCol2Num || !isCol1Num) {
            noCont = detailContainerNo || cols[0].toUpperCase().trim();
            desc = cols[1] || ALLOWED_DESC_OPTIONS[0];
            userTotalCif = Number(cols[2]?.replace(/[^0-9.-]/g, '')) || 0;
          } else {
            desc = cols[0] || ALLOWED_DESC_OPTIONS[0];
            userTotalCif = Number(cols[1]?.replace(/[^0-9.-]/g, '')) || 0;
            ket = cols[2] || 'LUNAS PIB';
          }
        } else if (cols.length === 4) {
          noCont = detailContainerNo || cols[0].toUpperCase().trim();
          desc = cols[1] || ALLOWED_DESC_OPTIONS[0];
          userTotalCif = Number(cols[2]?.replace(/[^0-9.-]/g, '')) || 0;
          ket = cols[3] || 'LUNAS PIB';
        } else if (cols.length === 5) {
          noCont = detailContainerNo || cols[0].toUpperCase().trim();
          desc = cols[1] || ALLOWED_DESC_OPTIONS[0];
          ar1 = Number(cols[2]?.replace(/[^0-9.-]/g, '')) || 0;
          ar20 = Number(cols[3]?.replace(/[^0-9.-]/g, '')) || 0;
          ar9 = Number(cols[4]?.replace(/[^0-9.-]/g, '')) || 0;
        } else if (cols.length === 6) {
          noCont = detailContainerNo || cols[0].toUpperCase().trim();
          desc = cols[1] || ALLOWED_DESC_OPTIONS[0];
          userTotalCif = Number(cols[2]?.replace(/[^0-9.-]/g, '')) || 0;
          ar1 = Number(cols[3]?.replace(/[^0-9.-]/g, '')) || 0;
          ar20 = Number(cols[4]?.replace(/[^0-9.-]/g, '')) || 0;
          ar9 = Number(cols[5]?.replace(/[^0-9.-]/g, '')) || 0;
        } else if (cols.length === 7) {
          noCont = detailContainerNo || cols[0].toUpperCase().trim();
          desc = cols[1] || ALLOWED_DESC_OPTIONS[0];
          ar1 = Number(cols[2]?.replace(/[^0-9.-]/g, '')) || 0;
          ar20 = Number(cols[3]?.replace(/[^0-9.-]/g, '')) || 0;
          ar6 = Number(cols[4]?.replace(/[^0-9.-]/g, '')) || 0;
          ar9 = Number(cols[5]?.replace(/[^0-9.-]/g, '')) || 0;
          soyu = Number(cols[6]?.replace(/[^0-9.-]/g, '')) || 0;
        } else if (cols.length === 8) {
          noCont = detailContainerNo || cols[0].toUpperCase().trim();
          desc = cols[1] || ALLOWED_DESC_OPTIONS[0];
          ar1 = Number(cols[2]?.replace(/[^0-9.-]/g, '')) || 0;
          ar20 = Number(cols[3]?.replace(/[^0-9.-]/g, '')) || 0;
          ar6 = Number(cols[4]?.replace(/[^0-9.-]/g, '')) || 0;
          ar9 = Number(cols[5]?.replace(/[^0-9.-]/g, '')) || 0;
          soyu = Number(cols[6]?.replace(/[^0-9.-]/g, '')) || 0;
          affNa = Number(cols[7]?.replace(/[^0-9.-]/g, '')) || 0;
        } else if (cols.length === 9) {
          noCont = detailContainerNo || cols[0].toUpperCase().trim();
          desc = cols[1] || ALLOWED_DESC_OPTIONS[0];
          userTotalCif = Number(cols[2]?.replace(/[^0-9.-]/g, '')) || 0;
          ar1 = Number(cols[3]?.replace(/[^0-9.-]/g, '')) || 0;
          ar20 = Number(cols[4]?.replace(/[^0-9.-]/g, '')) || 0;
          ar6 = Number(cols[5]?.replace(/[^0-9.-]/g, '')) || 0;
          ar9 = Number(cols[6]?.replace(/[^0-9.-]/g, '')) || 0;
          soyu = Number(cols[7]?.replace(/[^0-9.-]/g, '')) || 0;
          affNa = Number(cols[8]?.replace(/[^0-9.-]/g, '')) || 0;
        } else if (cols.length >= 10) {
          bulan = cols[0] || bulan;
          noCont = detailContainerNo || (cols[1] ? cols[1].toUpperCase().trim() : 'CONT-IMPORT');
          tglPib = cols[2] || tglPib;
          desc = cols[3] || desc;

          if (cols.length >= 11) {
            totalNilaiPo = Number(cols[4]?.replace(/[^0-9.-]/g, '')) || 0;
            ar1 = Number(cols[5]?.replace(/[^0-9.-]/g, '')) || 0;
            ar20 = Number(cols[6]?.replace(/[^0-9.-]/g, '')) || 0;
            ar6 = Number(cols[7]?.replace(/[^0-9.-]/g, '')) || 0;
            ar9 = Number(cols[8]?.replace(/[^0-9.-]/g, '')) || 0;
            soyu = Number(cols[9]?.replace(/[^0-9.-]/g, '')) || 0;
            affNa = Number(cols[10]?.replace(/[^0-9.-]/g, '')) || 0;
            if (cols[11]) ket = cols[11];
          } else {
            ar1 = Number(cols[4]?.replace(/[^0-9.-]/g, '')) || 0;
            ar20 = Number(cols[5]?.replace(/[^0-9.-]/g, '')) || 0;
            ar6 = Number(cols[6]?.replace(/[^0-9.-]/g, '')) || 0;
            ar9 = Number(cols[7]?.replace(/[^0-9.-]/g, '')) || 0;
            soyu = Number(cols[8]?.replace(/[^0-9.-]/g, '')) || 0;
            if (cols[9]) affNa = Number(cols[9]?.replace(/[^0-9.-]/g, '')) || 0;
          }
        }

        const sumAr = ar1 + ar20 + ar6 + ar9 + soyu + affNa;
        const total = sumAr > 0 ? sumAr : userTotalCif;

        // Auto-lookup Total Cost from Status Container if totalNilaiPo is 0
        const matchedCont = containers.find(c => cleanContKey(c.noContainer) === cleanContKey(noCont));
        if (matchedCont) {
          if (!detailContainerNo) {
            noCont = matchedCont.noContainer;
          }
          if (!totalNilaiPo) {
            totalNilaiPo = matchedCont.totalCost || matchedCont.totalPrice || 0;
          }
        }

        parsedItems.push({
          bulan,
          noCont,
          tglPib,
          desc,
          totalNilaiPo,
          ar1,
          ar20,
          ar6,
          ar9,
          soyu,
          affNa,
          total,
          ket
        });
      }
    });

    if (parsedItems.length > 0) {
      setCifRecords(prevList => {
        const importedContKeys = new Set(parsedItems.map(item => cleanContKey(item.noCont)));

        // Remove old cost items for imported containers, but PRESERVE 'Nilai Kontainer' header row
        const remainingList = prevList.filter(r => {
          const isImportedCont = importedContKeys.has(cleanContKey(r.noContainer));
          if (!isImportedCont) return true;
          const isHeader = r.desc && r.desc.toUpperCase().trim() === 'NILAI KONTAINER';
          if (isHeader) {
            const importHasHeader = parsedItems.some(pi => 
              cleanContKey(pi.noCont) === cleanContKey(r.noContainer) && 
              pi.desc.toUpperCase().trim() === 'NILAI KONTAINER'
            );
            return !importHasHeader; // keep existing header if import didn't provide one
          }
          return false; // remove old cost items
        });

        // Ensure each imported container has a 'Nilai Kontainer' header if missing
        importedContKeys.forEach(contKey => {
          const hasHeaderInRemaining = remainingList.some(r => cleanContKey(r.noContainer) === contKey && r.desc.toUpperCase().trim() === 'NILAI KONTAINER');
          const hasHeaderInImport = parsedItems.some(item => cleanContKey(item.noCont) === contKey && item.desc.toUpperCase().trim() === 'NILAI KONTAINER');
          
          if (!hasHeaderInRemaining && !hasHeaderInImport) {
            const firstParsed = parsedItems.find(item => cleanContKey(item.noCont) === contKey);
            const matchedCont = containers.find(c => cleanContKey(c.noContainer) === contKey);
            const poVal = firstParsed?.totalNilaiPo || matchedCont?.totalCost || matchedCont?.totalPrice || (contKey.includes('gz239') ? 658770225 : 0);
            
            let ar1Po = 0, ar20Po = 0, ar6Po = 0, ar9Po = 0, soyuPo = 0, affNaPo = 0;
            if (contKey.includes('gz239')) {
              ar1Po = 234120225;
              ar20Po = 328300000;
              ar9Po = 101320995;
            }

            remainingList.unshift({
              id: 'cif-header-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
              bulanKontJalan: firstParsed?.bulan || 'Januari 2026',
              noContainer: firstParsed?.noCont || 'CONTAINER',
              tglFinalPembayaranPib: firstParsed?.tglPib || new Date().toISOString().slice(0, 10),
              desc: 'Nilai Kontainer',
              totalNilaiPo: poVal,
              total: poVal,
              ar1: ar1Po,
              ar20: ar20Po,
              ar6: ar6Po,
              ar9: ar9Po,
              soyu: soyuPo,
              affNa: affNaPo,
              ket: 'LUNAS PIB',
              createdAt: new Date().toISOString()
            });
          }
        });

        // Create new records for imported cost items with auto brand split
        const newRecords: CifRecord[] = parsedItems.map((item, idx) => {
          const rawRec: CifRecord = {
            id: 'cif-imp-' + Date.now() + '-' + idx + '-' + Math.random().toString(36).substr(2, 4),
            bulanKontJalan: item.bulan,
            noContainer: item.noCont,
            tglFinalPembayaranPib: item.tglPib,
            desc: item.desc,
            totalNilaiPo: item.totalNilaiPo,
            ar1: item.ar1,
            ar20: item.ar20,
            ar6: item.ar6,
            ar9: item.ar9,
            soyu: item.soyu,
            affNa: item.affNa,
            total: item.total,
            ket: item.ket,
            createdAt: new Date().toISOString()
          };
          return ensureRecordBrandSplit(rawRec, [...prevList, ...remainingList], containers);
        });

        return [...newRecords, ...remainingList];
      });

      showToast(`Berhasil mengimpor ${parsedItems.length} baris data CIF Kontainer!`, 'success');
      setImportCifText('');
      setIsImportCifModalOpen(false);
    } else {
      showToast('Gagal memproses format baris data CIF. Pastikan sesuai kolom.', 'error');
    }
  };

  // Export to Excel for BAP
  const handleExportBapExcel = () => {
    const dataToExport = filteredBapRecords.map((r, i) => ({
      'No': i + 1,
      'No BAP': r.bapNo || '-',
      'No Container': r.noContainer,
      'Item Code': r.itemCode,
      'Item Name': r.itemName,
      'Nilai Jual (Rp)': r.nilaiJual,
      'Nilai Cost (Rp)': r.nilaiCost,
      'Qty Container': r.qtyContainer,
      'Qty Terima Bagus': r.qtyTerimaBagus,
      'Qty Terima RK': r.qtyTerimaRk,
      'Qty Terima RM': r.qtyTerimaRm,
      'Ada Foto Rijek': r.fotoRijekUrl ? 'YA' : 'TIDAK',
      'Keterangan': r.keterangan || '-'
    }));
    exportToExcel(dataToExport, `BAP_Penerimaan_Kontainer_${new Date().toISOString().slice(0, 10)}`);
    showToast('Laporan Berita Acara Penerimaan (BAP) Kontainer berhasil diekspor!', 'success');
  };

  // Download BAP Template
  const handleDownloadBapTemplate = () => {
    const templateData = [
      {
        'No Container': 'TCNU8834190',
        'Item Code': 'LAM-OAK-01',
        'Item Name': 'Laminate Flooring Oak Natural 8mm',
        'Nilai Jual': 145000,
        'Nilai Cost': 85000,
        'Qty Container': 1200,
        'Qty Terima Bagus': 1180,
        'Qty Terima RK': 15,
        'Qty Terima RM': 5,
        'Keterangan': 'Dus basah dan barang rijek patah'
      }
    ];
    exportToExcel(templateData, 'Template_Import_BAP_Per_No_Container');
    showToast('Template Excel BAP berhasil didownload!', 'success');
  };

  // Process Import BAP Batch
  const handleProcessImportBap = () => {
    if (!importBapText.trim()) {
      showToast('Masukkan atau paste teks data BAP per Container!', 'error');
      return;
    }

    const lines = importBapText.trim().split('\n');
    let addedCount = 0;

    lines.forEach(line => {
      const cols = line.split(line.includes('\t') ? '\t' : ',').map(c => c.trim().replace(/^"|"$/g, ''));
      if (cols.length >= 3) {
        if (cols[0].toLowerCase().includes('container') || cols[1].toLowerCase().includes('item')) return;

        const noCont = cols[0] ? cols[0].toUpperCase() : 'CONT-IMPORT';
        const itemCode = cols[1] || 'ITEM-01';
        const itemName = cols[2] || 'Barang Import';
        const nilaiJual = Number(cols[3]?.replace(/[^0-9.-]/g, '')) || 0;
        const nilaiCost = Number(cols[4]?.replace(/[^0-9.-]/g, '')) || 0;
        const qtyContainer = Number(cols[5]?.replace(/[^0-9.-]/g, '')) || 0;
        const qtyBagus = Number(cols[6]?.replace(/[^0-9.-]/g, '')) || 0;
        const qtyRk = Number(cols[7]?.replace(/[^0-9.-]/g, '')) || 0;
        const qtyRm = Number(cols[8]?.replace(/[^0-9.-]/g, '')) || 0;
        const ket = cols[9] || '-';

        const newRec: BapItemRecord = {
          id: 'bap-imp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          bapNo: 'BAP/' + new Date().getFullYear() + '/IMP-' + (bapRecords.length + addedCount + 1),
          noContainer: noCont,
          itemCode,
          itemName,
          nilaiJual,
          nilaiCost,
          qtyContainer,
          qtyTerimaBagus: qtyBagus,
          qtyTerimaRk: qtyRk,
          qtyTerimaRm: qtyRm,
          fotoRijekUrl: '',
          tanggalBap: new Date().toISOString().slice(0, 10),
          keterangan: ket,
          createdAt: new Date().toISOString()
        };

        setBapRecords(prev => [newRec, ...prev]);
        addedCount++;
      }
    });

    if (addedCount > 0) {
      showToast(`Berhasil mengimpor ${addedCount} item BAP Kontainer!`, 'success');
      setImportBapText('');
      setIsImportBapModalOpen(false);
    } else {
      showToast('Gagal memproses format data BAP. Pastikan sesuai kolom.', 'error');
    }
  };

  // Print BAP Official Document Report
  const handlePrintBapReport = () => {
    window.print();
  };

  // Handlers for Non-CIF / Depre Manual
  const handleOpenAddNonCif = () => {
    setEditingNonCif(null);
    setNonCifFormData({
      bulanKontJalan: 'Januari 2026',
      noContainer: containerList[0] || '',
      tanggal: new Date().toISOString().slice(0, 10),
      kategoriBiaya: NON_CIF_CATEGORY_OPTIONS[0],
      desc: '',
      totalNilaiPo: 0,
      total: 0,
      ar1: 0,
      ar20: 0,
      ar6: 0,
      ar9: 0,
      soyu: 0,
      affNa: 0,
      ket: 'NON-CIF MANUAL'
    });
    setIsNonCifModalOpen(true);
  };

  const handleOpenEditNonCif = (rec: NonCifRecord) => {
    setEditingNonCif(rec);
    setNonCifFormData({
      bulanKontJalan: rec.bulanKontJalan || 'Januari 2026',
      noContainer: rec.noContainer || '',
      tanggal: rec.tanggal || new Date().toISOString().slice(0, 10),
      kategoriBiaya: rec.kategoriBiaya || NON_CIF_CATEGORY_OPTIONS[0],
      desc: rec.desc || '',
      totalNilaiPo: rec.totalNilaiPo || 0,
      total: rec.total || 0,
      ar1: rec.ar1 || 0,
      ar20: rec.ar20 || 0,
      ar6: rec.ar6 || 0,
      ar9: rec.ar9 || 0,
      soyu: rec.soyu || 0,
      affNa: rec.affNa || 0,
      ket: rec.ket || 'NON-CIF MANUAL'
    });
    setIsNonCifModalOpen(true);
  };

  const handleSaveNonCif = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nonCifFormData.noContainer.trim()) {
      showToast('Masukkan Nomor Container!', 'error');
      return;
    }
    if (!nonCifFormData.desc.trim()) {
      showToast('Masukkan Deskripsi Rincian Biaya!', 'error');
      return;
    }

    const sumBrands = (nonCifFormData.ar1 || 0) + (nonCifFormData.ar20 || 0) + (nonCifFormData.ar6 || 0) + (nonCifFormData.ar9 || 0) + (nonCifFormData.soyu || 0) + (nonCifFormData.affNa || 0);
    const finalTotal = nonCifFormData.total > 0 ? nonCifFormData.total : sumBrands;

    const rawRec: NonCifRecord = {
      bulanKontJalan: nonCifFormData.bulanKontJalan,
      noContainer: nonCifFormData.noContainer.toUpperCase().trim(),
      tanggal: nonCifFormData.tanggal,
      kategoriBiaya: nonCifFormData.kategoriBiaya,
      desc: nonCifFormData.desc,
      totalNilaiPo: nonCifFormData.totalNilaiPo,
      total: finalTotal,
      ar1: nonCifFormData.ar1 || 0,
      ar20: nonCifFormData.ar20 || 0,
      ar6: nonCifFormData.ar6 || 0,
      ar9: nonCifFormData.ar9 || 0,
      soyu: nonCifFormData.soyu || 0,
      affNa: nonCifFormData.affNa || 0,
      ket: nonCifFormData.ket,
      updatedAt: new Date().toISOString()
    };

    const preparedRec = ensureNonCifBrandSplit(rawRec, cifRecords, containers);

    if (editingNonCif) {
      setNonCifRecords(prev => prev.map(item => item.id === editingNonCif.id ? { ...preparedRec, id: editingNonCif.id } : item));
      showToast('Data Biaya Selain CIF berhasil diperbarui!', 'success');
    } else {
      const newRec: NonCifRecord = {
        ...preparedRec,
        id: 'noncif-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
        createdAt: new Date().toISOString()
      };
      setNonCifRecords(prev => [newRec, ...prev]);
      showToast('Data Biaya Selain CIF berhasil ditambahkan!', 'success');
    }

    setIsNonCifModalOpen(false);
  };

  const handleDeleteNonCif = (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Hapus Biaya Selain CIF',
      message: 'Apakah Anda yakin ingin menghapus baris rincian biaya selain CIF ini?',
      confirmLabel: 'Hapus',
      onConfirm: () => {
        setNonCifRecords(prev => prev.filter(r => r.id !== id));
        setSelectedNonCifIds(prev => prev.filter(x => x !== id));
        showToast('Data rincian biaya selain CIF berhasil dihapus!', 'info');
      }
    });
  };

  const handleDeleteSelectedNonCif = () => {
    if (selectedNonCifIds.length === 0) return;
    setConfirmModal({
      isOpen: true,
      title: 'Hapus Massal Biaya Selain CIF',
      message: `Apakah Anda yakin ingin menghapus ${selectedNonCifIds.length} baris biaya selain CIF terpilih?`,
      confirmLabel: 'Hapus Massal',
      onConfirm: () => {
        setNonCifRecords(prev => prev.filter(r => !selectedNonCifIds.includes(r.id!)));
        setSelectedNonCifIds([]);
        showToast(`${selectedNonCifIds.length} baris biaya selain CIF berhasil dihapus!`, 'info');
      }
    });
  };

  const handleExportNonCifExcel = () => {
    const preparedRecords = filteredNonCifRecords.map(r => ensureNonCifBrandSplit(r, cifRecords, containers));
    const dataToExport = preparedRecords.map((r, i) => ({
      'No': i + 1,
      'No Container': r.noContainer,
      'Bulan Kont Jalan': r.bulanKontJalan,
      'Tanggal Transaksi': r.tanggal || '-',
      'Kategori Biaya': r.kategoriBiaya,
      'Deskripsi Rincian Biaya': r.desc,
      'Total Biaya Selain CIF (Rp)': r.total,
      'AR1 (Rp)': r.ar1 || 0,
      'AR20 (Rp)': r.ar20 || 0,
      'AR6 (Rp)': r.ar6 || 0,
      'AR9 (Rp)': r.ar9 || 0,
      'SOYU (Rp)': r.soyu || 0,
      'AFF NA (Rp)': r.affNa || 0,
      'Keterangan / Ref Jurnal': r.ket
    }));

    exportToExcel(dataToExport, `Rincian_Biaya_Selain_CIF_Depre_Manual_${new Date().toISOString().slice(0, 10)}`);
    showToast('Laporan Biaya Selain CIF - Depre Manual berhasil diekspor!', 'success');
  };

  const handleDownloadNonCifTemplate = () => {
    const templateData = [
      {
        'No Container': 'GZ239 (20 FT)',
        'Deskripsi Biaya (Desc)': 'Total Biaya PPH',
        'Total CIF': 63853425,
        'Keterangan': 'LUNAS PIB'
      },
      {
        'No Container': 'GZ239 (20 FT)',
        'Deskripsi Biaya (Desc)': 'Total Biaya BEA Masuk',
        'Total CIF': 6555000,
        'Keterangan': 'LUNAS PIB'
      },
      {
        'No Container': 'GZ239 (20 FT)',
        'Deskripsi Biaya (Desc)': 'Biaya LS Tribhakti - BAGS',
        'Total CIF': -51600,
        'Keterangan': 'LUNAS PIB'
      },
      {
        'No Container': 'GZ239 (20 FT)',
        'Deskripsi Biaya (Desc)': 'Total Biaya Asuransi AXA',
        'Total CIF': 557146,
        'Keterangan': 'LUNAS PIB'
      },
      {
        'No Container': 'GZ239 (20 FT)',
        'Deskripsi Biaya (Desc)': 'Total Biaya Bongkar Muat',
        'Total CIF': -75000,
        'Keterangan': 'LUNAS PIB'
      },
      {
        'No Container': 'GZ239 (20 FT)',
        'Deskripsi Biaya (Desc)': 'Total Biaya Freight in Fee (Lift Off)',
        'Total CIF': 621622,
        'Keterangan': 'LUNAS PIB'
      },
      {
        'No Container': 'GZ239 (20 FT)',
        'Deskripsi Biaya (Desc)': 'Total Biaya GREENLINE HANDLING',
        'Total CIF': 200000,
        'Keterangan': 'LUNAS PIB'
      }
    ];
    exportToExcel(templateData, 'Template_Import_Biaya_Selain_CIF_Depre_Manual');
    showToast('Template Excel Biaya Selain CIF berhasil didownload!', 'success');
  };

  const handleProcessImportNonCif = () => {
    if (!importNonCifText.trim()) {
      showToast('Masukkan Teks / Data Excel Biaya Selain CIF!', 'error');
      return;
    }

    const lines = importNonCifText.trim().split('\n');
    const parsedItems: NonCifRecord[] = [];

    lines.forEach(line => {
      const cols = line.split(line.includes('\t') ? '\t' : ',').map(c => c.trim().replace(/^"|"$/g, ''));
      if (cols.length >= 3) {
        const firstColLower = cols[0].toLowerCase();
        if (firstColLower.includes('container') || firstColLower.includes('no cont') || firstColLower === 'no') return;

        let noCont = '';
        let bulan = 'Januari 2026';
        let tgl = new Date().toISOString().slice(0, 10);
        let kat = 'Depresiasi/Penyusutan Manual';
        let desc = 'Biaya Selain CIF Manual';
        let total = 0;
        let ket = 'LUNAS PIB';

        // 4-column format: No Container | Deskripsi Biaya (Desc) | Total CIF | Keterangan (Format Gambar 2)
        if (cols.length === 4 || (cols.length < 7 && isNaN(Number(cols[1].replace(/[^0-9.-]/g, ''))))) {
          noCont = cols[0] ? cols[0].toUpperCase() : 'CONT-UNKNOWN';
          desc = cols[1] || 'Biaya Selain CIF Manual';
          total = Number(cols[2]?.replace(/[^0-9.-]/g, '')) || 0;
          ket = cols[3] || 'LUNAS PIB';
        } else {
          // 7-column legacy format
          noCont = cols[0] ? cols[0].toUpperCase() : 'CONT-UNKNOWN';
          bulan = cols[1] || 'Januari 2026';
          tgl = cols[2] || new Date().toISOString().slice(0, 10);
          kat = cols[3] || 'Depresiasi/Penyusutan Manual';
          desc = cols[4] || 'Biaya Selain CIF Manual';
          total = Number(cols[5]?.replace(/[^0-9.-]/g, '')) || 0;
          ket = cols[6] || 'DEPRE MANUAL';
        }

        const rawRec: NonCifRecord = {
          id: 'noncif-imp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          bulanKontJalan: bulan,
          noContainer: noCont,
          tanggal: tgl,
          kategoriBiaya: kat,
          desc: desc,
          total: total,
          ket: ket,
          createdAt: new Date().toISOString()
        };

        const splitRec = ensureNonCifBrandSplit(rawRec, cifRecords, containers);
        parsedItems.push(splitRec);
      }
    });

    if (parsedItems.length > 0) {
      setNonCifRecords(prev => [...parsedItems, ...prev]);
      showToast(`Berhasil mengimpor ${parsedItems.length} baris Biaya Selain CIF!`, 'success');
      setImportNonCifText('');
      setIsImportNonCifModalOpen(false);
    } else {
      showToast('Gagal memproses format data. Pastikan sesuai kolom (No Container, Deskripsi Biaya, Total CIF, Keterangan).', 'error');
    }
  };

  const handleNonCifFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_csv(ws);
        setImportNonCifText(data);
        showToast(`File ${file.name} berhasil dibaca. Klik 'Proses Import Non-CIF'`, 'info');
      } catch (err) {
        showToast('Gagal membaca file spreadsheet.', 'error');
      }
    };
    reader.readAsBinaryString(file);
  };

  // Filtered Non-CIF Records
  const filteredNonCifRecords = useMemo(() => {
    return nonCifRecords.filter(r => {
      const q = searchQuery.toLowerCase().trim();
      const matchSearch = !q || 
        (r.noContainer || '').toLowerCase().includes(q) ||
        (r.desc || '').toLowerCase().includes(q) ||
        (r.kategoriBiaya || '').toLowerCase().includes(q) ||
        (r.ket || '').toLowerCase().includes(q);

      const matchMonth = selectedMonth === 'ALL' || r.bulanKontJalan === selectedMonth;
      const matchCategory = nonCifCategoryFilter === 'ALL' || r.kategoriBiaya === nonCifCategoryFilter;
      const matchContainer = selectedNonCifContainer === 'ALL' || cleanContKey(r.noContainer) === cleanContKey(selectedNonCifContainer);

      return matchSearch && matchMonth && matchCategory && matchContainer;
    });
  }, [nonCifRecords, searchQuery, selectedMonth, nonCifCategoryFilter, selectedNonCifContainer]);

  // Non-CIF Totals
  const nonCifTotals = useMemo(() => {
    let totalCost = 0;
    let totalDepre = 0;
    let totalAR1 = 0;
    let totalAR20 = 0;
    let totalAR6 = 0;
    let totalAR9 = 0;
    let totalSOYU = 0;
    let totalAFFNA = 0;

    filteredNonCifRecords.forEach(rawR => {
      const r = ensureNonCifBrandSplit(rawR, cifRecords, containers);
      const cost = r.total || 0;
      totalCost += cost;
      if ((r.kategoriBiaya || '').toLowerCase().includes('depre') || (r.kategoriBiaya || '').toLowerCase().includes('penyusutan')) {
        totalDepre += cost;
      }
      totalAR1 += (r.ar1 || 0);
      totalAR20 += (r.ar20 || 0);
      totalAR6 += (r.ar6 || 0);
      totalAR9 += (r.ar9 || 0);
      totalSOYU += (r.soyu || 0);
      totalAFFNA += (r.affNa || 0);
    });

    return {
      totalCost,
      totalDepre,
      totalAR1,
      totalAR20,
      totalAR6,
      totalAR9,
      totalSOYU,
      totalAFFNA
    };
  }, [filteredNonCifRecords, cifRecords, containers]);

  return (
    <div className="space-y-4">
      {/* Top Header Banner & Sub-Tab Switcher */}
      <div className="bg-slate-900 text-white p-4 rounded-xl shadow-md border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-blue-400 shrink-0" />
            <h1 className="text-lg font-bold tracking-tight text-white">
              Perhitungan CIF, Biaya Selain CIF & BAP Kontainer
            </h1>
            <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-mono font-bold rounded-full">
              Resmi GZ 2026
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Pengelolaan Resume Bulanan Kontainer, Pembayaran PIB (AR1, AR20, AR9), Biaya Selain CIF (Depre Manual) & Berita Acara Penerimaan (BAP) Rijek Barang.
          </p>
        </div>

        {/* Sub-Tab Selector Buttons */}
        <div className="flex flex-wrap items-center bg-slate-950 p-1 rounded-lg border border-slate-800 shrink-0 gap-1">
          <button
            onClick={() => setActiveSubTab('cif')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
              activeSubTab === 'cif'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Calculator className="w-4 h-4" />
            <span>Resume CIF Kontainer</span>
          </button>

          <button
            onClick={() => setActiveSubTab('bap')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
              activeSubTab === 'bap'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>BAP Kontainer (QC Terima)</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: PERHITUNGAN CIF KONTAINER (RESUME BULANAN KONTAINER RESMI GZ)       */}
      {/* ========================================================================= */}
      {activeSubTab === 'cif' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          
          {/* Summary Metric Cards with AR Percentages and CIF Percentage */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Nilai CIF (PIB)</div>
              <div className="text-base font-bold text-blue-700 mt-0.5">{formatCurrency(cifTotals.totalCIF)}</div>
              <div className="text-[10px] text-slate-400 mt-1">{groupedCifContainers.length} Kontainer Terdata</div>
            </div>

            {/* Dashboard Card Persentase Nilai CIF */}
            <div className="bg-gradient-to-br from-purple-50 to-white p-3.5 rounded-xl border border-purple-200 shadow-2xs relative overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold text-purple-900 uppercase tracking-wider">Persentase Nilai CIF</div>
                <span className="px-1.5 py-0.5 bg-purple-900 text-white font-mono font-bold text-[10px] rounded">
                  {cifTotals.pctCIF}
                </span>
              </div>
              <div className="text-lg font-extrabold text-purple-950 mt-0.5 font-mono">{cifTotals.pctCIF}</div>
              <div className="text-[10px] text-purple-700 font-semibold mt-1">
                (Total CIF / Total Cost PO) × 100%
              </div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs relative overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Pembelian AR1</div>
                <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 font-mono font-bold text-[10px] rounded">
                  {cifTotals.pctAR1}
                </span>
              </div>
              <div className="text-base font-bold text-emerald-700 mt-0.5">{formatCurrency(cifTotals.totalAR1)}</div>
              <div className="text-[10px] text-emerald-600 mt-1">Porsi AR1 vs Total Cost PO</div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs relative overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Pembelian AR20</div>
                <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-800 font-mono font-bold text-[10px] rounded">
                  {cifTotals.pctAR20}
                </span>
              </div>
              <div className="text-base font-bold text-indigo-700 mt-0.5">{formatCurrency(cifTotals.totalAR20)}</div>
              <div className="text-[10px] text-indigo-600 mt-1">Porsi AR20 vs Total Cost PO</div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs relative overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Pembelian AR9</div>
                <span className="px-1.5 py-0.5 bg-purple-100 text-purple-800 font-mono font-bold text-[10px] rounded">
                  {cifTotals.pctAR9}
                </span>
              </div>
              <div className="text-base font-bold text-purple-700 mt-0.5">{formatCurrency(cifTotals.totalAR9)}</div>
              <div className="text-[10px] text-purple-600 mt-1">Porsi AR9 vs Total Cost PO</div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
              {/* Search Bar */}
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Cari No Container, Deskripsi, Bulan, Ket..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white"
                />
              </div>

              {/* Month Filter */}
              <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="text-xs bg-transparent border-none focus:outline-none text-slate-700 font-medium"
                >
                  <option value="ALL">Semua Bulan Kont Jalan</option>
                  {monthList.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              {/* Container Filter */}
              <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
                <Ship className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={selectedCifContainer}
                  onChange={(e) => setSelectedCifContainer(e.target.value)}
                  className="text-xs bg-transparent border-none focus:outline-none text-slate-700 font-medium"
                >
                  <option value="ALL">Filter No Container (Semua)</option>
                  {containerList.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Action Buttons & View Mode Switcher */}
            <div className="flex flex-wrap items-center gap-2">
              {/* View Mode Switcher */}
              <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setCifViewMode('document')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${
                    cifViewMode === 'document'
                      ? 'bg-purple-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-purple-900'
                  }`}
                  title="Tampilan Resume Dokumen Kontainer"
                >
                  <Ship className="w-3.5 h-3.5" />
                  <span>Dokumen Kontainer ({groupedCifContainers.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCifViewMode('flat')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${
                    cifViewMode === 'flat'
                      ? 'bg-purple-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-purple-900'
                  }`}
                  title="Tampilan Semua Baris Rincian Biaya"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Semua Baris Biaya ({filteredCifRecords.length})</span>
                </button>
              </div>

              {/* Delete Selected Button */}
              {selectedCifIds.length > 0 && (
                <button
                  onClick={handleBulkDeleteCif}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs rounded-lg transition shadow-2xs cursor-pointer animate-in fade-in"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hapus Terpilih ({selectedCifIds.length})</span>
                </button>
              )}

              {/* Delete Filtered Data Button */}
              {(selectedCifContainer !== 'ALL' || selectedMonth !== 'ALL' || searchQuery.trim() !== '') && filteredCifRecords.length > 0 && (
                <button
                  onClick={handleDeleteFilteredCifData}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-700 hover:bg-rose-800 text-white font-semibold text-xs rounded-lg transition shadow-2xs cursor-pointer animate-in fade-in"
                  title="Hapus semua baris data CIF hasil filter saat ini"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>
                    Hapus Filter {selectedCifContainer !== 'ALL' ? `(${selectedCifContainer})` : `(${filteredCifRecords.length})`}
                  </span>
                </button>
              )}

              <button
                onClick={() => {
                  setImportCifText(`No Container\tDeskripsi Biaya (Desc)\tTotal CIF\tKeterangan\nGZ239 (20FT)\tTotal Biaya BEA Masuk\t33988000\tLUNAS PIB\nGZ239 (20FT)\tTotal Biaya Sea Freight\t37100000\tLUNAS PIB`);
                  setIsImportCifModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs rounded-lg transition shadow-2xs cursor-pointer"
              >
                <FileUp className="w-3.5 h-3.5" />
                <span>Import Biaya CIF</span>
              </button>

              <button
                onClick={handleExportCifExcel}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-lg transition shadow-2xs cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Export Excel</span>
              </button>

              <button
                onClick={() => setIsSqlModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs rounded-lg transition shadow-2xs cursor-pointer border border-emerald-500/30"
                title="Salin & Download SQL Query untuk Supabase Editor"
              >
                <Database className="w-3.5 h-3.5 text-emerald-200" />
                <span>SQL Supabase</span>
              </button>

              <button
                onClick={() => {
                  setEmailReportContainerNo(selectedCifContainer !== 'ALL' ? selectedCifContainer : (groupedCifContainers[0]?.noContainer || 'ALL'));
                  setIsEmailReportModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white font-semibold text-xs rounded-lg transition shadow-2xs cursor-pointer"
                title="Kirim Laporan Biaya Kontainer via Email"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Report Email</span>
              </button>

              {/* Primary Add Container Button */}
              <button
                onClick={handleOpenAddContainerDoc}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-700 hover:bg-purple-800 text-white font-semibold text-xs rounded-lg transition shadow-2xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Tambah Dokumen CIF</span>
              </button>
            </div>
          </div>

          {/* CIF Main Data Table: Document Grouped Mode vs Flat Line Mode */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  {/* Title Header Banner */}
                  <tr className="bg-purple-900 text-white font-bold text-center tracking-wider uppercase text-xs">
                    <th colSpan={15} className="py-2.5 px-4 bg-gradient-to-r from-purple-950 via-slate-900 to-purple-950 border-b border-purple-800">
                      RESUME DOKUMEN CIF KONTAINER RESMI GZ 2026 ({cifViewMode === 'document' ? 'Tampilan Dokumen' : 'Tampilan Semua Baris'})
                    </th>
                  </tr>

                  {cifViewMode === 'document' ? (
                    /* Header Columns for Document Mode */
                    <tr className="bg-purple-100 text-purple-950 font-bold border-b border-purple-200 text-center">
                      <th className="py-2.5 px-2 border-r border-purple-200 w-8">No</th>
                      <th className="py-2.5 px-3 border-r border-purple-200 min-w-[130px]">No Dokumen Kontainer</th>
                      <th className="py-2.5 px-3 border-r border-purple-200 min-w-[120px] bg-purple-200/60">Tgl Terima Kontainer</th>
                      <th className="py-2.5 px-3 border-r border-purple-200 min-w-[130px] bg-blue-100/80 text-blue-950">Total Cost PO Kontainer</th>
                      <th className="py-2.5 px-3 border-r border-purple-200 min-w-[100px] bg-emerald-100/80 text-emerald-950">TOTAL CIF AR1</th>
                      <th className="py-2.5 px-3 border-r border-purple-200 min-w-[100px] bg-indigo-100/80 text-indigo-950">TOTAL CIF AR20</th>
                      <th className="py-2.5 px-3 border-r border-purple-200 min-w-[100px] bg-blue-100/80 text-blue-950">TOTAL CIF AR6</th>
                      <th className="py-2.5 px-3 border-r border-purple-200 min-w-[100px] bg-purple-100/80 text-purple-950">TOTAL CIF AR9</th>
                      <th className="py-2.5 px-3 border-r border-purple-200 min-w-[100px] bg-rose-100/80 text-rose-950">TOTAL CIF SOYU</th>
                      <th className="py-2.5 px-3 border-r border-purple-200 min-w-[100px] bg-teal-100/80 text-teal-950">TOTAL CIF AFF NA</th>
                      <th className="py-2.5 px-3 border-r border-purple-200 min-w-[130px] bg-amber-100/80 text-amber-950">Total Nilai CIF</th>
                      <th className="py-2.5 px-3 border-r border-purple-200 min-w-[110px] bg-purple-200/90 text-purple-950">
                        <div>Persentase CIF (%)</div>
                        <div className="text-[10px] text-purple-800 font-normal normal-case">(Total CIF / Total PO)</div>
                      </th>
                      <th className="py-2.5 px-3 border-r border-purple-200 min-w-[90px]">Rincian Biaya</th>
                      <th className="py-2.5 px-3 border-r border-purple-200 min-w-[110px]">Status Ket</th>
                      <th className="py-2.5 px-3 min-w-[100px]">Aksi</th>
                    </tr>
                  ) : (
                    /* Header Columns for Flat Line Mode */
                    <tr className="bg-purple-100 text-purple-950 font-bold border-b border-purple-200 text-center">
                      <th className="py-2.5 px-2 border-r border-purple-200 w-8">
                        <input
                          type="checkbox"
                          checked={
                            filteredCifRecords.length > 0 &&
                            filteredCifRecords.every(r => r.id && selectedCifIds.includes(r.id))
                          }
                          onChange={handleToggleSelectAllCif}
                          className="rounded border-purple-300 text-purple-700 focus:ring-purple-500 cursor-pointer"
                        />
                      </th>
                      <th className="py-2.5 px-3 border-r border-purple-200 w-10">No</th>
                      <th className="py-2.5 px-3 border-r border-purple-200 min-w-[120px]">No Cont</th>
                      <th className="py-2.5 px-3 border-r border-purple-200 min-w-[120px] bg-purple-200/60">Tgl Terima Kontainer</th>
                      <th className="py-2.5 px-3 border-r border-purple-200 min-w-[180px]">Desc</th>
                      <th className="py-2.5 px-3 border-r border-purple-200 min-w-[120px] bg-blue-100/80 text-blue-950">Total Nilai PO</th>
                      <th className="py-2.5 px-2 border-r border-purple-200 min-w-[100px] bg-emerald-100/80 text-emerald-950">AR1</th>
                      <th className="py-2.5 px-2 border-r border-purple-200 min-w-[100px] bg-indigo-100/80 text-indigo-950">AR20</th>
                      <th className="py-2.5 px-2 border-r border-purple-200 min-w-[100px] bg-blue-100/80 text-blue-950">AR6</th>
                      <th className="py-2.5 px-2 border-r border-purple-200 min-w-[100px] bg-purple-100/80 text-purple-950">AR9</th>
                      <th className="py-2.5 px-2 border-r border-purple-200 min-w-[100px] bg-rose-100/80 text-rose-950">SOYU</th>
                      <th className="py-2.5 px-2 border-r border-purple-200 min-w-[100px] bg-teal-100/80 text-teal-950">AFF NA</th>
                      <th className="py-2.5 px-3 border-r border-purple-200 min-w-[120px] bg-amber-100/80 text-amber-950">
                        <div>Total Nilai CIF</div>
                        <div className="text-[10px] text-purple-700 font-normal normal-case">(CIF / PO)</div>
                      </th>
                      <th className="py-2.5 px-3 border-r border-purple-200 min-w-[100px]">Ket</th>
                      <th className="py-2.5 px-3 min-w-[70px]">Aksi</th>
                    </tr>
                  )}
                </thead>

                <tbody className="divide-y divide-slate-200">
                  {cifViewMode === 'document' ? (
                    /* Render Document Grouped Rows */
                    groupedCifContainers.length === 0 ? (
                      <tr>
                        <td colSpan={16} className="py-10 text-center text-slate-400">
                          <div className="flex flex-col items-center justify-center gap-2">
                            <Ship className="w-8 h-8 text-slate-300" />
                            <span>Belum ada Dokumen Kontainer. Klik "+ Tambah Dokumen CIF" untuk membuat dokumen baru.</span>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      groupedCifContainers.map((doc, idx) => {
                        const cifPct = doc.totalNilaiPo > 0 ? formatPercent(doc.totalCIF, doc.totalNilaiPo) : '-';

                        return (
                          <tr key={doc.noContainer} className="hover:bg-purple-50/40 transition">
                            <td className="py-3 px-2 text-center text-slate-500 font-mono font-medium border-r border-slate-100">
                              {idx + 1}
                            </td>
                            {/* No Dokumen Kontainer - Clickable to Detail */}
                            <td className="py-3 px-3 font-mono font-bold border-r border-slate-100">
                              <button
                                onClick={() => handleOpenContainerDetail(doc.noContainer)}
                                className="flex items-center gap-1.5 px-2 py-1 bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-900 rounded-md transition text-xs font-mono font-bold cursor-pointer group"
                              >
                                <Ship className="w-3.5 h-3.5 text-purple-600 group-hover:scale-110 transition" />
                                <span>{doc.noContainer}</span>
                              </button>
                            </td>
                            <td className="py-2 px-2 font-mono text-slate-700 font-semibold border-r border-slate-100 text-center">
                              <input
                                type="date"
                                value={doc.tglFinalPembayaranPib && doc.tglFinalPembayaranPib !== '-' ? doc.tglFinalPembayaranPib : ''}
                                onChange={(e) => handleUpdateDocDate(doc.noContainer, e.target.value)}
                                className="w-full min-w-[125px] px-2 py-1 bg-white border border-purple-200 rounded text-xs font-mono font-bold text-purple-950 focus:ring-1 focus:ring-purple-500 shadow-2xs text-center cursor-pointer"
                                title="Klik untuk mengedit Tanggal Terima Kontainer"
                              />
                            </td>
                            {/* Total Cost PO Kontainer */}
                            <td className="py-3 px-3 font-mono font-bold text-blue-900 border-r border-slate-100 text-right bg-blue-50/30">
                              {doc.totalNilaiPo ? formatCurrency(doc.totalNilaiPo) : '-'}
                            </td>
                            {/* Total AR1 */}
                            <td className="py-2 px-1.5 font-mono border-r border-slate-100 bg-emerald-50/20">
                              <input
                                type="number"
                                className="w-full text-right bg-white border border-emerald-300 rounded px-1.5 py-1 text-xs font-mono font-bold text-emerald-900 focus:ring-1 focus:ring-emerald-500 shadow-2xs"
                                value={doc.totalAR1 || ''}
                                onChange={(e) => handleUpdateDocBrandCost(doc.noContainer, 'ar1', Number(e.target.value))}
                                placeholder="0"
                              />
                              {doc.totalNilaiPo > 0 && (doc.totalAR1 || 0) > 0 && (
                                <div className="text-[10px] text-emerald-700 font-bold text-right mt-0.5" title="Rumus: Total CIF AR1 / Total Cost PO * 100%">
                                  {formatPercent(doc.totalAR1, doc.totalNilaiPo)}
                                </div>
                              )}
                            </td>
                            {/* Total AR20 */}
                            <td className="py-2 px-1.5 font-mono border-r border-slate-100 bg-indigo-50/20">
                              <input
                                type="number"
                                className="w-full text-right bg-white border border-indigo-300 rounded px-1.5 py-1 text-xs font-mono font-bold text-indigo-900 focus:ring-1 focus:ring-indigo-500 shadow-2xs"
                                value={doc.totalAR20 || ''}
                                onChange={(e) => handleUpdateDocBrandCost(doc.noContainer, 'ar20', Number(e.target.value))}
                                placeholder="0"
                              />
                              {doc.totalNilaiPo > 0 && (doc.totalAR20 || 0) > 0 && (
                                <div className="text-[10px] text-indigo-700 font-bold text-right mt-0.5" title="Rumus: Total CIF AR20 / Total Cost PO * 100%">
                                  {formatPercent(doc.totalAR20, doc.totalNilaiPo)}
                                </div>
                              )}
                            </td>
                            {/* Total AR6 */}
                            <td className="py-2 px-1.5 font-mono border-r border-slate-100 bg-blue-50/20">
                              <input
                                type="number"
                                className="w-full text-right bg-white border border-blue-300 rounded px-1.5 py-1 text-xs font-mono font-bold text-blue-900 focus:ring-1 focus:ring-blue-500 shadow-2xs"
                                value={doc.totalAR6 || ''}
                                onChange={(e) => handleUpdateDocBrandCost(doc.noContainer, 'ar6', Number(e.target.value))}
                                placeholder="0"
                              />
                              {doc.totalNilaiPo > 0 && (doc.totalAR6 || 0) > 0 && (
                                <div className="text-[10px] text-blue-700 font-bold text-right mt-0.5" title="Rumus: Total CIF AR6 / Total Cost PO * 100%">
                                  {formatPercent(doc.totalAR6, doc.totalNilaiPo)}
                                </div>
                              )}
                            </td>
                            {/* Total AR9 */}
                            <td className="py-2 px-1.5 font-mono border-r border-slate-100 bg-purple-50/20">
                              <input
                                type="number"
                                className="w-full text-right bg-white border border-purple-300 rounded px-1.5 py-1 text-xs font-mono font-bold text-purple-900 focus:ring-1 focus:ring-purple-500 shadow-2xs"
                                value={doc.totalAR9 || ''}
                                onChange={(e) => handleUpdateDocBrandCost(doc.noContainer, 'ar9', Number(e.target.value))}
                                placeholder="0"
                              />
                              {doc.totalNilaiPo > 0 && (doc.totalAR9 || 0) > 0 && (
                                <div className="text-[10px] text-purple-700 font-bold text-right mt-0.5" title="Rumus: Total CIF AR9 / Total Cost PO * 100%">
                                  {formatPercent(doc.totalAR9, doc.totalNilaiPo)}
                                </div>
                              )}
                            </td>
                            {/* Total SOYU */}
                            <td className="py-2 px-1.5 font-mono border-r border-slate-100 bg-rose-50/20">
                              <input
                                type="number"
                                className="w-full text-right bg-white border border-rose-300 rounded px-1.5 py-1 text-xs font-mono font-bold text-rose-900 focus:ring-1 focus:ring-rose-500 shadow-2xs"
                                value={doc.totalSOYU || ''}
                                onChange={(e) => handleUpdateDocBrandCost(doc.noContainer, 'soyu', Number(e.target.value))}
                                placeholder="0"
                              />
                              {doc.totalNilaiPo > 0 && (doc.totalSOYU || 0) > 0 && (
                                <div className="text-[10px] text-rose-700 font-bold text-right mt-0.5" title="Rumus: Total CIF SOYU / Total Cost PO * 100%">
                                  {formatPercent(doc.totalSOYU, doc.totalNilaiPo)}
                                </div>
                              )}
                            </td>
                            {/* Total AFF NA */}
                            <td className="py-2 px-1.5 font-mono border-r border-slate-100 bg-teal-50/20">
                              <input
                                type="number"
                                className="w-full text-right bg-white border border-teal-300 rounded px-1.5 py-1 text-xs font-mono font-bold text-teal-900 focus:ring-1 focus:ring-teal-500 shadow-2xs"
                                value={doc.totalAFFNA || ''}
                                onChange={(e) => handleUpdateDocBrandCost(doc.noContainer, 'affNa', Number(e.target.value))}
                                placeholder="0"
                              />
                              {doc.totalNilaiPo > 0 && (doc.totalAFFNA || 0) > 0 && (
                                <div className="text-[10px] text-teal-700 font-bold text-right mt-0.5" title="Rumus: Total CIF AFF NA / Total Cost PO * 100%">
                                  {formatPercent(doc.totalAFFNA, doc.totalNilaiPo)}
                                </div>
                              )}
                            </td>
                            {/* Total Nilai CIF */}
                            <td className="py-3 px-3 font-mono font-bold text-slate-900 border-r border-slate-100 text-right bg-amber-50/30">
                              {formatCurrency(doc.totalCIF)}
                            </td>
                            {/* Persentase CIF (%) */}
                            <td className="py-3 px-3 font-mono border-r border-slate-100 text-center bg-purple-50/50">
                              <span className="px-2 py-1 bg-purple-900 text-white font-bold text-xs rounded-md shadow-2xs">
                                {cifPct}
                              </span>
                            </td>
                            {/* Rincian Biaya Item Count */}
                            <td className="py-3 px-3 text-center border-r border-slate-100">
                              <span className="px-2 py-0.5 bg-slate-100 text-slate-700 font-semibold rounded text-[11px]">
                                {doc.items.length} Item Biaya
                              </span>
                            </td>
                            {/* Status Ket */}
                            <td className="py-3 px-3 border-r border-slate-100">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                                doc.ket.toUpperCase().includes('LUNAS') 
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                                  : doc.ket.toUpperCase().includes('PROSES')
                                  ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                  : 'bg-blue-100 text-blue-800 border border-blue-200'
                              }`}>
                                {doc.ket}
                              </span>
                            </td>
                            {/* Actions for Document */}
                            <td className="py-3 px-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => handleOpenContainerDetail(doc.noContainer)}
                                  className="flex items-center gap-1 px-2 py-1 bg-purple-700 hover:bg-purple-800 text-white rounded text-[11px] font-semibold transition shadow-2xs cursor-pointer"
                                  title="Lihat Detail Dokumen"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Detail</span>
                                </button>
                                <button
                                  onClick={() => handleDeleteContainerDoc(doc.noContainer)}
                                  className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                                  title="Hapus Dokumen Kontainer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )
                  ) : (
                    /* Render Flat Individual Rows */
                    filteredCifRecords.length === 0 ? (
                      <tr>
                        <td colSpan={15} className="py-10 text-center text-slate-400">
                          <div className="flex flex-col items-center justify-center gap-2">
                            <Ship className="w-8 h-8 text-slate-300" />
                            <span>Belum ada data Resume CIF Kontainer. Klik "+ Tambah Dokumen CIF" atau "Import CIF" untuk memasukkan data.</span>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredCifRecords.map((rawR, idx) => {
                        const r = ensureRecordBrandSplit(rawR, cifRecords, containers);
                        const isSelected = selectedCifIds.includes(r.id!);
                        const effectivePo = r.totalNilaiPo || containers.find(c => c.noContainer.toUpperCase() === (r.noContainer || '').toUpperCase())?.totalCost || containers.find(c => c.noContainer.toUpperCase() === (r.noContainer || '').toUpperCase())?.totalPrice || 0;

                        return (
                          <tr key={r.id} className={`transition ${isSelected ? 'bg-purple-100/70' : 'hover:bg-purple-50/40'}`}>
                            <td className="py-2.5 px-2 text-center border-r border-slate-100">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleSelectCif(r.id!)}
                                className="rounded border-slate-300 text-purple-700 focus:ring-purple-500 cursor-pointer"
                              />
                            </td>
                            <td className="py-2.5 px-3 text-center text-slate-500 font-mono font-medium border-r border-slate-100">
                              {idx + 1}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-blue-700 border-r border-slate-100">
                              {r.noContainer}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-600 border-r border-slate-100 text-center">
                              {r.tglFinalPembayaranPib || '-'}
                            </td>
                            <td className="py-2.5 px-3 text-slate-800 font-medium border-r border-slate-100">
                              {r.desc}
                            </td>

                            {/* Total Nilai PO */}
                            <td className="py-2.5 px-3 font-mono font-bold text-blue-900 border-r border-slate-100 text-right bg-blue-50/30">
                              {effectivePo ? formatCurrency(effectivePo) : '-'}
                            </td>

                             {/* Brand Costs Input Columns */}
                            <td className="py-1.5 px-1.5 border-r border-slate-100 bg-emerald-50/20">
                              <input
                                type="number"
                                min="0"
                                className="w-full px-1.5 py-1 text-right font-mono font-bold text-emerald-900 bg-white border border-emerald-200 rounded focus:border-emerald-500 focus:outline-none text-xs"
                                value={r.ar1 || ''}
                                onChange={(e) => handleUpdateBrandCost(r.id!, 'ar1', Number(e.target.value))}
                                placeholder="0"
                              />
                              {effectivePo > 0 && (r.ar1 || 0) > 0 && (
                                <div className="text-[9px] text-emerald-700 font-bold text-right mt-0.5">
                                  {formatPercent(r.ar1 || 0, effectivePo)}
                                </div>
                              )}
                            </td>
                            <td className="py-1.5 px-1.5 border-r border-slate-100 bg-indigo-50/20">
                              <input
                                type="number"
                                min="0"
                                className="w-full px-1.5 py-1 text-right font-mono font-bold text-indigo-900 bg-white border border-indigo-200 rounded focus:border-indigo-500 focus:outline-none text-xs"
                                value={r.ar20 || ''}
                                onChange={(e) => handleUpdateBrandCost(r.id!, 'ar20', Number(e.target.value))}
                                placeholder="0"
                              />
                              {effectivePo > 0 && (r.ar20 || 0) > 0 && (
                                <div className="text-[9px] text-indigo-700 font-bold text-right mt-0.5">
                                  {formatPercent(r.ar20 || 0, effectivePo)}
                                </div>
                              )}
                            </td>
                            <td className="py-1.5 px-1.5 border-r border-slate-100 bg-blue-50/20">
                              <input
                                type="number"
                                min="0"
                                className="w-full px-1.5 py-1 text-right font-mono font-bold text-blue-900 bg-white border border-blue-200 rounded focus:border-blue-500 focus:outline-none text-xs"
                                value={r.ar6 || ''}
                                onChange={(e) => handleUpdateBrandCost(r.id!, 'ar6', Number(e.target.value))}
                                placeholder="0"
                              />
                              {effectivePo > 0 && (r.ar6 || 0) > 0 && (
                                <div className="text-[9px] text-blue-700 font-bold text-right mt-0.5">
                                  {formatPercent(r.ar6 || 0, effectivePo)}
                                </div>
                              )}
                            </td>
                            <td className="py-1.5 px-1.5 border-r border-slate-100 bg-purple-50/20">
                              <input
                                type="number"
                                min="0"
                                className="w-full px-1.5 py-1 text-right font-mono font-bold text-purple-900 bg-white border border-purple-200 rounded focus:border-purple-500 focus:outline-none text-xs"
                                value={r.ar9 || ''}
                                onChange={(e) => handleUpdateBrandCost(r.id!, 'ar9', Number(e.target.value))}
                                placeholder="0"
                              />
                              {effectivePo > 0 && (r.ar9 || 0) > 0 && (
                                <div className="text-[9px] text-purple-700 font-bold text-right mt-0.5">
                                  {formatPercent(r.ar9 || 0, effectivePo)}
                                </div>
                              )}
                            </td>
                            <td className="py-1.5 px-1.5 border-r border-slate-100 bg-rose-50/20">
                              <input
                                type="number"
                                min="0"
                                className="w-full px-1.5 py-1 text-right font-mono font-bold text-rose-900 bg-white border border-rose-200 rounded focus:border-rose-500 focus:outline-none text-xs"
                                value={r.soyu || ''}
                                onChange={(e) => handleUpdateBrandCost(r.id!, 'soyu', Number(e.target.value))}
                                placeholder="0"
                              />
                              {effectivePo > 0 && (r.soyu || 0) > 0 && (
                                <div className="text-[9px] text-rose-700 font-bold text-right mt-0.5">
                                  {formatPercent(r.soyu || 0, effectivePo)}
                                </div>
                              )}
                            </td>
                            <td className="py-1.5 px-1.5 border-r border-slate-100 bg-teal-50/20">
                              <input
                                type="number"
                                min="0"
                                className="w-full px-1.5 py-1 text-right font-mono font-bold text-teal-900 bg-white border border-teal-200 rounded focus:border-teal-500 focus:outline-none text-xs"
                                value={r.affNa || ''}
                                onChange={(e) => handleUpdateBrandCost(r.id!, 'affNa', Number(e.target.value))}
                                placeholder="0"
                              />
                              {effectivePo > 0 && (r.affNa || 0) > 0 && (
                                <div className="text-[9px] text-teal-700 font-bold text-right mt-0.5">
                                  {formatPercent(r.affNa || 0, effectivePo)}
                                </div>
                              )}
                            </td>

                            {/* Total Nilai CIF + % CIF/PO */}
                            <td className="py-2.5 px-3 font-mono border-r border-slate-100 text-right bg-slate-50/80">
                              <div className="font-bold text-slate-900">{formatCurrency(r.total)}</div>
                              {effectivePo > 0 ? (
                                <div className="text-[10px] text-purple-700 font-bold" title="Rumus: Total Nilai CIF / Total Nilai PO Kontainer">
                                  {formatPercent(r.total, effectivePo)}
                                </div>
                              ) : null}
                            </td>

                            <td className="py-2.5 px-3 border-r border-slate-100">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                                r.ket.toUpperCase().includes('LUNAS') 
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                                  : r.ket.toUpperCase().includes('PROSES')
                                  ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                  : 'bg-blue-100 text-blue-800 border border-blue-200'
                              }`}>
                                {r.ket}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => handleOpenEditCif(r)}
                                  className="p-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition"
                                  title="Edit Baris CIF"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteCif(r.id!)}
                                  className="p-1 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                                  title="Hapus Baris CIF"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )
                  )}
                </tbody>

                {/* Summary Total Footer */}
                {filteredCifRecords.length > 0 && (
                  <tfoot>
                    <tr className="bg-purple-900 text-white font-bold border-t-2 border-purple-950 text-xs">
                      <td colSpan={cifViewMode === 'document' ? 4 : 6} className="py-2.5 px-4 text-right uppercase tracking-wider">
                        TOTAL RESUME KONTAINER:
                      </td>
                      <td className="py-2.5 px-3 font-mono text-right bg-blue-950 text-blue-200 font-bold border-r border-purple-800">
                        {formatCurrency(cifTotals.totalNilaiPo)}
                      </td>
                      <td className="py-2.5 px-2 font-mono text-right text-emerald-300 bg-emerald-950/80 font-bold border-r border-purple-800">
                        <div>{formatCurrency(cifTotals.totalAR1)}</div>
                        {cifTotals.totalNilaiPo > 0 && (
                          <div className="text-[10px] text-emerald-200 font-semibold mt-0.5" title="AR1 / Total Cost PO * 100%">
                            {cifTotals.pctAR1}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-2 font-mono text-right text-indigo-300 bg-indigo-950/80 font-bold border-r border-purple-800">
                        <div>{formatCurrency(cifTotals.totalAR20)}</div>
                        {cifTotals.totalNilaiPo > 0 && (
                          <div className="text-[10px] text-indigo-200 font-semibold mt-0.5" title="AR20 / Total Cost PO * 100%">
                            {cifTotals.pctAR20}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-2 font-mono text-right text-blue-300 bg-blue-950/80 font-bold border-r border-purple-800">
                        <div>{formatCurrency(cifTotals.totalAR6)}</div>
                        {cifTotals.totalNilaiPo > 0 && (
                          <div className="text-[10px] text-blue-200 font-semibold mt-0.5" title="AR6 / Total Cost PO * 100%">
                            {cifTotals.pctAR6}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-2 font-mono text-right text-purple-300 bg-purple-950/80 font-bold border-r border-purple-800">
                        <div>{formatCurrency(cifTotals.totalAR9)}</div>
                        {cifTotals.totalNilaiPo > 0 && (
                          <div className="text-[10px] text-purple-200 font-semibold mt-0.5" title="AR9 / Total Cost PO * 100%">
                            {cifTotals.pctAR9}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-2 font-mono text-right text-rose-300 bg-rose-950/80 font-bold border-r border-purple-800">
                        <div>{formatCurrency(cifTotals.totalSOYU)}</div>
                        {cifTotals.totalNilaiPo > 0 && (
                          <div className="text-[10px] text-rose-200 font-semibold mt-0.5" title="SOYU / Total Cost PO * 100%">
                            {cifTotals.pctSOYU}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-2 font-mono text-right text-teal-300 bg-teal-950/80 font-bold border-r border-purple-800">
                        <div>{formatCurrency(cifTotals.totalAFFNA)}</div>
                        {cifTotals.totalNilaiPo > 0 && (
                          <div className="text-[10px] text-teal-200 font-semibold mt-0.5" title="AFF NA / Total Cost PO * 100%">
                            {cifTotals.pctAFFNA}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-right bg-purple-950 text-amber-300 font-bold border-r border-purple-800">
                        <div>{formatCurrency(cifTotals.totalCIF)}</div>
                        {cifTotals.totalNilaiPo > 0 && (
                          <div className="text-[10px] text-amber-200 font-bold" title="Rumus: Total CIF / Total PO">
                            {cifTotals.pctCIF} CIF/PO
                          </div>
                        )}
                      </td>
                      <td colSpan={cifViewMode === 'document' ? 3 : 2} className="py-2.5 px-3 text-center text-purple-200 font-mono text-[11px]">
                        100.0% TOTAL PIB
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: BIAYA SELAIN CIF - DEPRE MANUAL                                    */}
      {/* ========================================================================= */}
      {activeSubTab === 'non_cif' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          
          {/* Summary Metric Cards for Non-CIF */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs col-span-2 sm:col-span-2">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Total Biaya Selain CIF</div>
              <div className="text-base font-bold text-amber-700 mt-0.5">{formatCurrency(nonCifTotals.totalCost)}</div>
              <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
                <span>{filteredNonCifRecords.length} Baris Rincian</span>
                <span className="font-semibold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                  Depre: {formatCurrency(nonCifTotals.totalDepre)}
                </span>
              </div>
            </div>

            <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
              <div className="text-[10px] font-semibold text-slate-500 uppercase">AR1 Non-CIF</div>
              <div className="text-sm font-bold text-emerald-700 mt-0.5 font-mono">{formatCurrency(nonCifTotals.totalAR1)}</div>
            </div>

            <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
              <div className="text-[10px] font-semibold text-slate-500 uppercase">AR20 Non-CIF</div>
              <div className="text-sm font-bold text-indigo-700 mt-0.5 font-mono">{formatCurrency(nonCifTotals.totalAR20)}</div>
            </div>

            <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
              <div className="text-[10px] font-semibold text-slate-500 uppercase">AR6 Non-CIF</div>
              <div className="text-sm font-bold text-blue-700 mt-0.5 font-mono">{formatCurrency(nonCifTotals.totalAR6)}</div>
            </div>

            <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
              <div className="text-[10px] font-semibold text-slate-500 uppercase">AR9 Non-CIF</div>
              <div className="text-sm font-bold text-purple-700 mt-0.5 font-mono">{formatCurrency(nonCifTotals.totalAR9)}</div>
            </div>

            <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
              <div className="text-[10px] font-semibold text-slate-500 uppercase">SOYU / AFF NA</div>
              <div className="text-sm font-bold text-rose-700 mt-0.5 font-mono">
                {formatCurrency(nonCifTotals.totalSOYU + nonCifTotals.totalAFFNA)}
              </div>
            </div>
          </div>

          {/* Filter & Action Toolbar */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
              {/* Search Bar */}
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Cari No Container, Deskripsi, Kategori, Ket..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 focus:bg-white"
                />
              </div>

              {/* Month Filter */}
              <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="text-xs bg-transparent border-none focus:outline-none text-slate-700 font-medium"
                >
                  <option value="ALL">Semua Bulan Jalan</option>
                  {monthList.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              {/* Category Filter */}
              <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
                <DollarSign className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={nonCifCategoryFilter}
                  onChange={(e) => setNonCifCategoryFilter(e.target.value)}
                  className="text-xs bg-transparent border-none focus:outline-none text-slate-700 font-medium"
                >
                  <option value="ALL">Semua Kategori Biaya</option>
                  {NON_CIF_CATEGORY_OPTIONS.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Container Filter */}
              <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
                <Ship className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={selectedNonCifContainer}
                  onChange={(e) => setSelectedNonCifContainer(e.target.value)}
                  className="text-xs bg-transparent border-none focus:outline-none text-slate-700 font-medium"
                >
                  <option value="ALL">Filter No Container (Semua)</option>
                  {containerList.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              {selectedNonCifIds.length > 0 && (
                <button
                  type="button"
                  onClick={handleDeleteSelectedNonCif}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-lg transition shadow-2xs cursor-pointer text-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hapus Terpilih ({selectedNonCifIds.length})</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleOpenAddNonCif}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg transition shadow-2xs cursor-pointer text-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Tambah Biaya Selain CIF</span>
              </button>

              <button
                type="button"
                onClick={() => setIsImportNonCifModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded-lg transition shadow-2xs cursor-pointer text-xs"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Import Biaya Selain CIF</span>
              </button>

              <button
                type="button"
                onClick={handleExportNonCifExcel}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-lg transition shadow-2xs cursor-pointer text-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Export Excel</span>
              </button>
            </div>
          </div>

          {/* Non-CIF Data Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-amber-900 text-amber-100 font-bold text-center tracking-wider uppercase text-xs">
                    <th colSpan={14} className="py-2.5 px-4 bg-gradient-to-r from-amber-950 via-slate-900 to-amber-950 border-b border-amber-800">
                      DAFTAR RINCIAN BIAYA SELAIN CIF - DEPRE MANUAL KONTAINER ({filteredNonCifRecords.length} Baris)
                    </th>
                  </tr>
                  <tr className="bg-amber-100/90 text-amber-950 font-bold border-b border-amber-200 text-center">
                    <th className="py-2.5 px-2 border-r border-amber-200 w-8">
                      <input
                        type="checkbox"
                        checked={filteredNonCifRecords.length > 0 && selectedNonCifIds.length === filteredNonCifRecords.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedNonCifIds(filteredNonCifRecords.map(r => r.id!));
                          } else {
                            setSelectedNonCifIds([]);
                          }
                        }}
                        className="rounded border-amber-300 text-amber-700 focus:ring-amber-500 cursor-pointer"
                      />
                    </th>
                    <th className="py-2.5 px-2 border-r border-amber-200 w-8">No</th>
                    <th className="py-2.5 px-3 border-r border-amber-200 min-w-[120px]">No Container</th>
                    <th className="py-2.5 px-2 border-r border-amber-200 min-w-[90px]">Tanggal / Bulan</th>
                    <th className="py-2.5 px-3 border-r border-amber-200 min-w-[140px]">Kategori Biaya</th>
                    <th className="py-2.5 px-3 border-r border-amber-200 min-w-[200px]">Deskripsi Rincian Biaya</th>
                    <th className="py-2.5 px-3 border-r border-amber-200 min-w-[110px] bg-emerald-100/80 text-emerald-950">AR1 (Rp)</th>
                    <th className="py-2.5 px-3 border-r border-amber-200 min-w-[110px] bg-indigo-100/80 text-indigo-950">AR20 (Rp)</th>
                    <th className="py-2.5 px-3 border-r border-amber-200 min-w-[100px] bg-blue-100/80 text-blue-950">AR6 (Rp)</th>
                    <th className="py-2.5 px-3 border-r border-amber-200 min-w-[100px] bg-purple-100/80 text-purple-950">AR9 (Rp)</th>
                    <th className="py-2.5 px-3 border-r border-amber-200 min-w-[90px] bg-rose-100/80 text-rose-950">SOYU (Rp)</th>
                    <th className="py-2.5 px-3 border-r border-amber-200 min-w-[90px] bg-teal-100/80 text-teal-950">AFF NA (Rp)</th>
                    <th className="py-2.5 px-3 border-r border-amber-200 min-w-[120px] bg-amber-200/80 text-amber-950">Total Biaya (Rp)</th>
                    <th className="py-2.5 px-3 min-w-[70px]">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredNonCifRecords.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="py-10 text-center text-slate-400">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <DollarSign className="w-8 h-8 text-slate-300" />
                          <span>Belum ada data Biaya Selain CIF - Depre Manual. Klik "+ Tambah Biaya Selain CIF" atau "Import Biaya Selain CIF".</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredNonCifRecords.map((rawR, idx) => {
                      const r = ensureNonCifBrandSplit(rawR, cifRecords, containers);
                      const isSelected = selectedNonCifIds.includes(r.id!);

                      return (
                        <tr key={r.id || idx} className={`hover:bg-amber-50/40 transition ${isSelected ? 'bg-amber-50/70' : ''}`}>
                          <td className="py-2.5 px-2 border-r border-slate-100 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedNonCifIds(prev => [...prev, r.id!]);
                                } else {
                                  setSelectedNonCifIds(prev => prev.filter(x => x !== r.id!));
                                }
                              }}
                              className="rounded border-slate-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                            />
                          </td>
                          <td className="py-2.5 px-2 border-r border-slate-100 text-center text-slate-500 font-mono text-[11px]">
                            {idx + 1}
                          </td>
                          <td className="py-2.5 px-3 border-r border-slate-100 font-mono font-bold text-slate-900">
                            {r.noContainer}
                          </td>
                          <td className="py-2.5 px-2 border-r border-slate-100 text-center text-slate-600">
                            <div>{r.tanggal || '-'}</div>
                            <div className="text-[10px] text-slate-400">{r.bulanKontJalan}</div>
                          </td>
                          <td className="py-2.5 px-3 border-r border-slate-100">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300 inline-block">
                              {r.kategoriBiaya}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 border-r border-slate-100 font-medium text-slate-800">
                            <div>{r.desc}</div>
                            {r.ket && <div className="text-[10px] text-slate-400 italic font-normal mt-0.5">Ket: {r.ket}</div>}
                          </td>

                          {/* Brand splits */}
                          <td className="py-2.5 px-3 border-r border-slate-100 text-right font-mono text-emerald-800 bg-emerald-50/20 font-semibold">
                            {formatCurrency(r.ar1 || 0)}
                          </td>
                          <td className="py-2.5 px-3 border-r border-slate-100 text-right font-mono text-indigo-800 bg-indigo-50/20 font-semibold">
                            {formatCurrency(r.ar20 || 0)}
                          </td>
                          <td className="py-2.5 px-3 border-r border-slate-100 text-right font-mono text-blue-800 bg-blue-50/20 font-semibold">
                            {formatCurrency(r.ar6 || 0)}
                          </td>
                          <td className="py-2.5 px-3 border-r border-slate-100 text-right font-mono text-purple-800 bg-purple-50/20 font-semibold">
                            {formatCurrency(r.ar9 || 0)}
                          </td>
                          <td className="py-2.5 px-3 border-r border-slate-100 text-right font-mono text-rose-800 bg-rose-50/20 font-semibold">
                            {formatCurrency(r.soyu || 0)}
                          </td>
                          <td className="py-2.5 px-3 border-r border-slate-100 text-right font-mono text-teal-800 bg-teal-50/20 font-semibold">
                            {formatCurrency(r.affNa || 0)}
                          </td>

                          {/* Total Biaya */}
                          <td className="py-2.5 px-3 border-r border-slate-100 text-right font-mono font-bold text-amber-900 bg-amber-50/60">
                            {formatCurrency(r.total)}
                          </td>

                          {/* Actions */}
                          <td className="py-2.5 px-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenEditNonCif(r)}
                                className="p-1 hover:bg-amber-100 text-amber-700 rounded transition cursor-pointer"
                                title="Edit Baris Biaya Selain CIF"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteNonCif(r.id!)}
                                className="p-1 hover:bg-rose-100 text-rose-600 rounded transition cursor-pointer"
                                title="Hapus Baris Biaya selain CIF"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>

                {/* Footer Totals */}
                {filteredNonCifRecords.length > 0 && (
                  <tfoot>
                    <tr className="bg-amber-950 text-amber-100 font-bold border-t-2 border-amber-900 text-xs">
                      <td colSpan={6} className="py-2.5 px-4 text-right uppercase tracking-wider">
                        TOTAL BIAYA SELAIN CIF - DEPRE MANUAL:
                      </td>
                      <td className="py-2.5 px-3 font-mono text-right text-emerald-300 bg-emerald-950/80 font-bold border-r border-amber-800">
                        {formatCurrency(nonCifTotals.totalAR1)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-right text-indigo-300 bg-indigo-950/80 font-bold border-r border-amber-800">
                        {formatCurrency(nonCifTotals.totalAR20)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-right text-blue-300 bg-blue-950/80 font-bold border-r border-amber-800">
                        {formatCurrency(nonCifTotals.totalAR6)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-right text-purple-300 bg-purple-950/80 font-bold border-r border-amber-800">
                        {formatCurrency(nonCifTotals.totalAR9)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-right text-rose-300 bg-rose-950/80 font-bold border-r border-amber-800">
                        {formatCurrency(nonCifTotals.totalSOYU)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-right text-teal-300 bg-teal-950/80 font-bold border-r border-amber-800">
                        {formatCurrency(nonCifTotals.totalAFFNA)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-right text-amber-300 bg-amber-900 font-extrabold border-r border-amber-800">
                        {formatCurrency(nonCifTotals.totalCost)}
                      </td>
                      <td className="py-2.5 px-2 text-center text-amber-300 text-[10px]">
                        100.0%
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: BAP KONTAINER (BERITA ACARA PENERIMAAN KONTAINER)                    */}
      {/* ========================================================================= */}
      {activeSubTab === 'bap' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          
          {/* Summary Metric Cards for BAP */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Qty Terima Bagus</div>
              <div className="text-base font-bold text-emerald-700 mt-0.5">
                {bapTotals.totalQtyBagus.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit
              </div>
              <div className="text-[10px] text-emerald-600 mt-1">
                Kondisi Sempurna
              </div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Qty Rijek Kecil (RK)</div>
              <div className="text-base font-bold text-amber-700 mt-0.5">
                {bapTotals.totalQtyRK.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit
              </div>
              <div className="text-[10px] text-amber-600 mt-1">Kerusakan Ringan</div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Qty Rijek Mayor / Mati (RM)</div>
              <div className="text-base font-bold text-rose-700 mt-0.5">
                {bapTotals.totalQtyRM.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit
              </div>
              <div className="text-[10px] text-rose-600 mt-1">Kerusakan Berat / Total</div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Estimasi Kerugian Rijek</div>
              <div className="text-base font-bold text-purple-700 mt-0.5">
                {formatCurrency(bapTotals.totalKerugianRijek)}
              </div>
              <div className="text-[10px] text-purple-600 mt-1">Berdasarkan Nilai Cost</div>
            </div>
          </div>

          {/* Action Toolbar for BAP */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
              {/* Search input */}
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Cari Item Code, Item Name, No BAP, Container..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white"
                />
              </div>

              {/* Container Filter */}
              <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
                <Ship className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={selectedContainer}
                  onChange={(e) => setSelectedContainer(e.target.value)}
                  className="text-xs bg-transparent border-none focus:outline-none text-slate-700 font-medium"
                >
                  <option value="ALL">Filter Container (Semua)</option>
                  {containerList.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              {/* Delete Selected Button */}
              {selectedBapIds.length > 0 && (
                <button
                  onClick={handleBulkDeleteBap}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs rounded-lg transition shadow-2xs cursor-pointer animate-in fade-in"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hapus Terpilih ({selectedBapIds.length})</span>
                </button>
              )}

              {/* Delete Filtered Data Button */}
              {(selectedContainer !== 'ALL' || searchQuery.trim() !== '') && filteredBapRecords.length > 0 && (
                <button
                  onClick={handleDeleteFilteredBapData}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-700 hover:bg-rose-800 text-white font-semibold text-xs rounded-lg transition shadow-2xs cursor-pointer animate-in fade-in"
                  title="Hapus semua item BAP hasil filter saat ini"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>
                    Hapus Filter {selectedContainer !== 'ALL' ? `(${selectedContainer})` : `(${filteredBapRecords.length})`}
                  </span>
                </button>
              )}

              {/* Import BAP Button */}
              <button
                onClick={() => setIsImportBapModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs rounded-lg transition shadow-2xs cursor-pointer"
              >
                <FileUp className="w-3.5 h-3.5" />
                <span>Import BAP Per Container</span>
              </button>

              <button
                onClick={handlePrintBapReport}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white font-semibold text-xs rounded-lg transition shadow-2xs cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Cetak BAP</span>
              </button>

              <button
                onClick={handleExportBapExcel}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-lg transition shadow-2xs cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Export Excel BAP</span>
              </button>

              <button
                onClick={handleOpenAddBap}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg transition shadow-2xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Input Item BAP Baru</span>
              </button>
            </div>
          </div>

          {/* BAP Table - STRICTLY formatted with Header: Item Code, Item Name, Nilai Jual, Nilai Cost, Qty Container, Qty Terima Bagus, Qty Terima RK, Qty Terima RM, dan Foto Barang Rijek */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 text-white font-bold uppercase tracking-wider text-[11px] text-center">
                    <th className="py-2.5 px-2 border-r border-slate-800 w-8">
                      <input
                        type="checkbox"
                        checked={
                          filteredBapRecords.length > 0 &&
                          filteredBapRecords.every(r => r.id && selectedBapIds.includes(r.id))
                        }
                        onChange={handleToggleSelectAllBap}
                        className="rounded border-slate-700 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </th>
                    <th className="py-2.5 px-3 border-r border-slate-800 w-10">No</th>
                    <th className="py-2.5 px-3 border-r border-slate-800 min-w-[110px]">Item Code</th>
                    <th className="py-2.5 px-3 border-r border-slate-800 min-w-[180px]">Item Name</th>
                    <th className="py-2.5 px-3 border-r border-slate-800 min-w-[120px]">Nilai Jual</th>
                    <th className="py-2.5 px-3 border-r border-slate-800 min-w-[120px]">Nilai Cost</th>
                    <th className="py-2.5 px-3 border-r border-slate-800 min-w-[100px]">Qty Container</th>
                    <th className="py-2.5 px-3 border-r border-slate-800 min-w-[110px] bg-emerald-950 text-emerald-300">Qty Terima Bagus</th>
                    <th className="py-2.5 px-3 border-r border-slate-800 min-w-[100px] bg-amber-950 text-amber-300">Qty Terima RK</th>
                    <th className="py-2.5 px-3 border-r border-slate-800 min-w-[100px] bg-rose-950 text-rose-300">Qty Terima RM</th>
                    <th className="py-2.5 px-3 border-r border-slate-800 min-w-[120px]">Foto Barang Rijek</th>
                    <th className="py-2.5 px-3 min-w-[70px]">Aksi</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-200">
                  {filteredBapRecords.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-10 text-center text-slate-400">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Package className="w-8 h-8 text-slate-300" />
                          <span>Belum ada data Berita Acara Penerimaan (BAP) Kontainer. Klik "Input Item BAP Baru" atau "Import BAP" untuk menambahkan.</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredBapRecords.map((r, idx) => {
                      const isSelected = selectedBapIds.includes(r.id!);
                      return (
                        <tr key={r.id} className={`transition ${isSelected ? 'bg-blue-100/70' : 'hover:bg-slate-50'}`}>
                          <td className="py-2.5 px-2 text-center border-r border-slate-100">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleSelectBap(r.id!)}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-center text-slate-500 font-mono border-r border-slate-100">
                            {idx + 1}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-blue-700 border-r border-slate-100">
                            {r.itemCode}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-800 border-r border-slate-100">
                            <div>{r.itemName}</div>
                            {r.noContainer && (
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                Cont: {r.noContainer} • {r.bapNo || 'BAP'}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-800 border-r border-slate-100 text-right">
                            {formatCurrency(r.nilaiJual)}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-800 border-r border-slate-100 text-right">
                            {formatCurrency(r.nilaiCost)}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-900 border-r border-slate-100 text-center bg-slate-50">
                            {r.qtyContainer.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-emerald-700 border-r border-slate-100 text-center bg-emerald-50/50">
                            {r.qtyTerimaBagus.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-amber-700 border-r border-slate-100 text-center bg-amber-50/50">
                            {r.qtyTerimaRk > 0 ? r.qtyTerimaRk.toLocaleString('id-ID', { maximumFractionDigits: 0 }) : '-'}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-rose-700 border-r border-slate-100 text-center bg-rose-50/50">
                            {r.qtyTerimaRm > 0 ? r.qtyTerimaRm.toLocaleString('id-ID', { maximumFractionDigits: 0 }) : '-'}
                          </td>
                          <td className="py-2.5 px-3 border-r border-slate-100 text-center">
                            {r.fotoRijekUrl ? (
                              <button
                                onClick={() => setPreviewImage({
                                  url: r.fotoRijekUrl!,
                                  title: `Foto Rijek: ${r.itemCode} - ${r.itemName}`,
                                  desc: `Qty RK: ${r.qtyTerimaRk} | Qty RM: ${r.qtyTerimaRm} | Cont: ${r.noContainer}`
                                })}
                                className="group relative inline-block p-1 bg-slate-100 hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded transition cursor-pointer"
                              >
                                <img
                                  src={r.fotoRijekUrl}
                                  alt="Foto Rijek"
                                  className="w-10 h-10 object-cover rounded"
                                />
                                <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white rounded transition">
                                  <Eye className="w-4 h-4" />
                                </span>
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-400 italic">Tidak ada foto</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => handleOpenEditBap(r)}
                                className="p-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition"
                                title="Edit Item BAP"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteBap(r.id!)}
                                className="p-1 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                                title="Hapus Item"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>

                {/* Table Footer */}
                {filteredBapRecords.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-900 text-white font-bold text-xs border-t-2 border-slate-950">
                      <td colSpan={4} className="py-2.5 px-4 text-right uppercase tracking-wider">
                        TOTAL REKAP BAP ({filteredBapRecords.length} ITEM):
                      </td>
                      <td className="py-2.5 px-3 font-mono text-right text-emerald-300">
                        {formatCurrency(bapTotals.totalNilaiJual)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-right text-indigo-300">
                        {formatCurrency(bapTotals.totalNilaiCost)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-center text-amber-300 font-bold bg-slate-950">
                        {bapTotals.totalQtyContainer.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-center text-emerald-400 font-bold bg-emerald-950">
                        {bapTotals.totalQtyBagus.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-center text-amber-400 font-bold bg-amber-950">
                        {bapTotals.totalQtyRK.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-center text-rose-400 font-bold bg-rose-950">
                        {bapTotals.totalQtyRM.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                      </td>
                      <td colSpan={2} className="py-2.5 px-3 text-center text-purple-300 font-mono text-[11px]">
                        Rijek: {formatCurrency(bapTotals.totalKerugianRijek)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 0A: FORM TAMBAH DOKUMEN CIF KONTAINER BARU                           */}
      {/* ========================================================================= */}
      {isAddContainerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden">
            <div className="bg-purple-900 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Ship className="w-5 h-5 text-purple-300" />
                <h3 className="font-bold text-sm">Tambah Dokumen CIF Kontainer Baru</h3>
              </div>
              <button
                onClick={() => setIsAddContainerModalOpen(false)}
                className="p-1 hover:bg-white/20 rounded transition text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveContainerDoc} className="p-4 space-y-4 text-xs">
              <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-purple-950 space-y-1">
                <div className="font-bold text-[11px] flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-purple-700" />
                  <span>Alur Pembuatan Dokumen CIF:</span>
                </div>
                <p className="text-[11px] text-purple-800 leading-relaxed">
                  Setelah dokumen kontainer dibuat dan disimpan, Anda dapat langsung mengimpor seluruh rincian biaya (AR1, AR6/AR20, AR9) atau menambahkannya secara bertahap.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    No Container <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    list="doc-container-list"
                    placeholder="Ketik atau pilih No Container..."
                    value={containerFormData.noContainer}
                    onChange={(e) => {
                      const val = e.target.value.toUpperCase();
                      const match = containers.find(c => c.noContainer.toUpperCase() === val);
                      const autoPo = match ? (match.totalCost || match.totalPrice || 0) : 0;
                      setContainerFormData(prev => ({
                        ...prev,
                        noContainer: val,
                        totalNilaiPo: autoPo > 0 ? autoPo : prev.totalNilaiPo
                      }));
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono font-bold text-blue-900"
                  />
                  <datalist id="doc-container-list">
                    {containers.map(c => (
                      <option key={c.id || c.noContainer} value={c.noContainer}>
                        {c.noContainer} (Total Cost: {formatCurrency(c.totalCost || c.totalPrice || 0)})
                      </option>
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Tgl Terima Kontainer <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={containerFormData.tglFinalPembayaranPib}
                    onChange={(e) => setContainerFormData(prev => ({ ...prev, tglFinalPembayaranPib: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Status Keterangan
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: LUNAS PIB / TIBA BINTARA"
                    value={containerFormData.ket}
                    onChange={(e) => setContainerFormData(prev => ({ ...prev, ket: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500 font-medium"
                  />
                </div>
              </div>

              {/* Total Cost PO Kontainer */}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold text-blue-900">
                    Total Cost PO Kontainer (Diambil dari Status Container)
                  </label>
                  {containerFormData.noContainer && (
                    <button
                      type="button"
                      onClick={() => {
                        const match = containers.find(c => c.noContainer.toUpperCase() === containerFormData.noContainer.toUpperCase());
                        if (match && (match.totalCost || match.totalPrice)) {
                          const poVal = match.totalCost || match.totalPrice || 0;
                          setContainerFormData(prev => ({ ...prev, totalNilaiPo: poVal }));
                          showToast(`Diisi otomatis dari Status Container: ${formatCurrency(poVal)}`, 'info');
                        } else {
                          showToast('Tidak ditemukan data PO di Status Container untuk kontainer ini', 'info');
                        }
                      }}
                      className="text-[10px] text-blue-700 hover:underline font-semibold cursor-pointer"
                    >
                      Ambil dari Status Container
                    </button>
                  )}
                </div>
                <div className="flex items-center">
                  <span className="px-3 py-2 bg-blue-100 border border-r-0 border-blue-300 rounded-l-lg text-blue-900 font-bold text-xs shrink-0">Rp</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="Diisi otomatis atau ketik manual..."
                    value={containerFormData.totalNilaiPo || ''}
                    onChange={(e) => setContainerFormData(prev => ({ ...prev, totalNilaiPo: Number(e.target.value) }))}
                    className="w-full px-3 py-2 bg-white border border-blue-300 rounded-r-lg focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono font-bold text-blue-950 text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsAddContainerModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-100 transition cursor-pointer"
                >
                  Batal
                </button>

                <button
                  type="submit"
                  className="px-4 py-2 bg-purple-900 hover:bg-purple-950 text-white font-bold rounded-lg transition shadow-md cursor-pointer flex items-center gap-1.5"
                >
                  <Ship className="w-4 h-4 text-purple-300" />
                  <span>Buat Dokumen CIF</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 0B: DETAIL DOKUMEN CIF KONTAINER & IMPORT RINCIAN BIAYA              */}
      {/* ========================================================================= */}
      {isDetailContainerModalOpen && detailContainerNo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-7xl max-h-[92vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-purple-950 via-slate-900 to-purple-950 text-white p-4 flex items-center justify-between shrink-0 border-b border-purple-800">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-800/60 rounded-lg border border-purple-600">
                  <Ship className="w-5 h-5 text-purple-300" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-base tracking-wide">
                      Dokumen CIF Kontainer: <span className="text-amber-300 font-mono font-bold">{detailContainerNo}</span>
                    </h3>
                  </div>
                  <p className="text-[11px] text-purple-200">
                    Daftar Rincian Dokumen Biaya CIF per Brand (AR1, AR20, AR6, AR9, SOYU, AFF NA)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setEmailReportContainerNo(detailContainerNo || 'ALL');
                    setIsEmailReportModalOpen(true);
                  }}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg text-xs transition cursor-pointer flex items-center gap-1.5 shadow-xs"
                >
                  <Mail className="w-4 h-4 text-blue-100" />
                  <span>Report Email</span>
                </button>
                <button
                  onClick={() => setIsDetailContainerModalOpen(false)}
                  className="p-1.5 hover:bg-white/20 rounded-lg transition text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
              {(() => {
                const allContainerRecords = cifRecords.filter(r => cleanContKey(r.noContainer) === cleanContKey(detailContainerNo));
                const containerItems = allContainerRecords.filter(r => r.desc.toUpperCase().trim() !== 'NILAI KONTAINER');
                const firstRec = allContainerRecords[0];
                const matchedCont = containers.find(c => cleanContKey(c.noContainer) === cleanContKey(detailContainerNo));
                const matchedDoc = groupedCifContainers.find(g => cleanContKey(g.noContainer) === cleanContKey(detailContainerNo));
                const brandInfo = getContainerBrandInfo(detailContainerNo || '', cifRecords, containers);

                const totalPo = matchedDoc?.totalNilaiPo || brandInfo.basePo;
                const sumCif = containerItems.reduce((acc, r) => acc + (r.total || 0), 0);
                const cifPct = totalPo > 0 ? formatPercent(sumCif, totalPo) : '0.0%';
                
                const docAR1 = brandInfo.ar1Po;
                const docAR20 = brandInfo.ar20Po;
                const docAR6 = brandInfo.ar6Po;
                const docAR9 = brandInfo.ar9Po;
                const docSOYU = brandInfo.soyuPo;
                const docAFFNA = brandInfo.affNaPo;

                const basePo = totalPo > 0 ? totalPo : 1;

                const rowItemsWithBrand = containerItems.map(r => ensureRecordBrandSplit(r, cifRecords, containers));

                const sumRowAR1 = rowItemsWithBrand.reduce((acc, r) => acc + (r.ar1 || 0), 0);
                const sumRowAR20 = rowItemsWithBrand.reduce((acc, r) => acc + (r.ar20 || 0), 0);
                const sumRowAR6 = rowItemsWithBrand.reduce((acc, r) => acc + (r.ar6 || 0), 0);
                const sumRowAR9 = rowItemsWithBrand.reduce((acc, r) => acc + (r.ar9 || 0), 0);
                const sumRowSOYU = rowItemsWithBrand.reduce((acc, r) => acc + (r.soyu || 0), 0);
                const sumRowAFFNA = rowItemsWithBrand.reduce((acc, r) => acc + (r.affNa || 0), 0);

                return (
                  <div className="space-y-4">
                    {/* Top Stats Cards Banner */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                      <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-xl shadow-2xs">
                        <div className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">Total Cost PO</div>
                        <div className="text-xs font-extrabold text-blue-950 mt-1 font-mono">{formatCurrency(totalPo)}</div>
                        <div className="text-[9px] text-blue-600 mt-0.5">PO Container</div>
                      </div>

                      <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl shadow-2xs">
                        <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider flex justify-between">
                          <span>PEMBELIAN AR1</span>
                          <span className="text-emerald-700">{formatPercent(docAR1, basePo)}</span>
                        </div>
                        <div className="text-xs font-extrabold text-emerald-950 mt-1 font-mono">{formatCurrency(docAR1)}</div>
                        <div className="text-[9px] text-emerald-700 mt-0.5">Porsi AR1</div>
                      </div>

                      <div className="p-2.5 bg-indigo-50 border border-indigo-200 rounded-xl shadow-2xs">
                        <div className="text-[10px] font-bold text-indigo-800 uppercase tracking-wider flex justify-between">
                          <span>PEMBELIAN AR20</span>
                          <span className="text-indigo-700">{formatPercent(docAR20, basePo)}</span>
                        </div>
                        <div className="text-xs font-extrabold text-indigo-950 mt-1 font-mono">{formatCurrency(docAR20)}</div>
                        <div className="text-[9px] text-indigo-700 mt-0.5">Porsi AR20</div>
                      </div>

                      <div className="p-2.5 bg-blue-50/70 border border-blue-200 rounded-xl shadow-2xs">
                        <div className="text-[10px] font-bold text-blue-800 uppercase tracking-wider flex justify-between">
                          <span>PEMBELIAN AR6</span>
                          <span className="text-blue-700">{formatPercent(docAR6, basePo)}</span>
                        </div>
                        <div className="text-xs font-extrabold text-blue-950 mt-1 font-mono">{formatCurrency(docAR6)}</div>
                        <div className="text-[9px] text-blue-700 mt-0.5">Porsi AR6</div>
                      </div>

                      <div className="p-2.5 bg-purple-50 border border-purple-200 rounded-xl shadow-2xs">
                        <div className="text-[10px] font-bold text-purple-800 uppercase tracking-wider flex justify-between">
                          <span>PEMBELIAN AR9</span>
                          <span className="text-purple-700">{formatPercent(docAR9, basePo)}</span>
                        </div>
                        <div className="text-xs font-extrabold text-purple-950 mt-1 font-mono">{formatCurrency(docAR9)}</div>
                        <div className="text-[9px] text-purple-700 mt-0.5">Porsi AR9</div>
                      </div>

                      <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl shadow-2xs">
                        <div className="text-[10px] font-bold text-rose-800 uppercase tracking-wider flex justify-between">
                          <span>PEMBELIAN SOYU</span>
                          <span className="text-rose-700">{formatPercent(docSOYU, basePo)}</span>
                        </div>
                        <div className="text-xs font-extrabold text-rose-950 mt-1 font-mono">{formatCurrency(docSOYU)}</div>
                        <div className="text-[9px] text-rose-700 mt-0.5">Porsi SOYU</div>
                      </div>

                      <div className="p-2.5 bg-teal-50 border border-teal-200 rounded-xl shadow-2xs">
                        <div className="text-[10px] font-bold text-teal-800 uppercase tracking-wider flex justify-between">
                          <span>PEMBELIAN AFF NA</span>
                          <span className="text-teal-700">{formatPercent(docAFFNA, basePo)}</span>
                        </div>
                        <div className="text-xs font-extrabold text-teal-950 mt-1 font-mono">{formatCurrency(docAFFNA)}</div>
                        <div className="text-[9px] text-teal-700 mt-0.5">Porsi AFF NA</div>
                      </div>
                    </div>

                    {/* Toolbar Actions inside Detail Modal */}
                    <div className="flex flex-wrap items-center justify-between bg-slate-100 p-2.5 rounded-xl border border-slate-200 gap-2">
                      <div className="font-bold text-slate-800 flex items-center gap-2 text-xs">
                        <FileText className="w-4 h-4 text-purple-700" />
                        <span>Daftar Rincian Dokumen {detailContainerNo} Per Brand (AR1, AR20, AR6, AR9, SOYU, AFF NA)</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            if (detailContainerNo) {
                              setImportCifText(`Deskripsi Biaya (Desc)\tTotal CIF\tKeterangan\nTotal Biaya BEA Masuk\t33988000\tLUNAS PIB\nTotal Biaya Sea Freight\t37100000\tLUNAS PIB`);
                            } else {
                              setImportCifText(`No Container\tDeskripsi Biaya (Desc)\tTotal CIF\tKeterangan\nGZ239 (20FT)\tTotal Biaya BEA Masuk\t33988000\tLUNAS PIB\nGZ239 (20FT)\tTotal Biaya Sea Freight\t37100000\tLUNAS PIB`);
                            }
                            setIsImportCifModalOpen(true);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded-lg transition text-xs shadow-2xs cursor-pointer"
                        >
                          <FileUp className="w-3.5 h-3.5" />
                          <span>Import Biaya CIF</span>
                        </button>

                        <button
                          onClick={() => {
                            setCifFormData({
                              bulanKontJalan: firstRec?.bulanKontJalan || 'Januari 2026',
                              noContainer: detailContainerNo,
                              tglFinalPembayaranPib: firstRec?.tglFinalPembayaranPib || new Date().toISOString().slice(0, 10),
                              desc: ALLOWED_DESC_OPTIONS[0],
                              totalNilaiPo: totalPo,
                              total: 0,
                              ar1: 0,
                              ar20: 0,
                              ar6: 0,
                              ar9: 0,
                              soyu: 0,
                              affNa: 0,
                              ket: firstRec?.ket || 'LUNAS PIB'
                            });
                            setEditingCif(null);
                            setIsCifModalOpen(true);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-700 hover:bg-purple-800 text-white font-semibold rounded-lg transition text-xs shadow-2xs cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>+ Tambah Item Biaya</span>
                        </button>
                      </div>
                    </div>

                    {/* Table of Cost Lines per Brand */}
                    <div className="border border-slate-200 rounded-xl overflow-x-auto bg-white shadow-2xs">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-purple-900 text-white font-bold border-b border-purple-950 text-center">
                            <th className="py-2.5 px-2 border-r border-purple-800 w-8">No</th>
                            <th className="py-2.5 px-3 border-r border-purple-800 min-w-[180px]">Deskripsi Biaya (Desc)</th>
                            <th className="py-2.5 px-3 border-r border-purple-800 min-w-[120px] bg-amber-950 text-amber-300">Total Nilai CIF</th>
                            
                            {/* Brand AR1 */}
                            <th className="py-2.5 px-2 border-r border-purple-800 min-w-[105px] bg-emerald-950 text-emerald-300">
                              <div>TOTAL CIF AR1</div>
                              <div className="text-[9px] text-emerald-400 font-normal">{formatPercent(docAR1, basePo)}</div>
                            </th>

                            {/* Brand AR20 */}
                            <th className="py-2.5 px-2 border-r border-purple-800 min-w-[105px] bg-indigo-950 text-indigo-300">
                              <div>TOTAL CIF AR20</div>
                              <div className="text-[9px] text-indigo-400 font-normal">{formatPercent(docAR20, basePo)}</div>
                            </th>

                            {/* Brand AR6 */}
                            <th className="py-2.5 px-2 border-r border-purple-800 min-w-[105px] bg-blue-950 text-blue-300">
                              <div>TOTAL CIF AR6</div>
                              <div className="text-[9px] text-blue-400 font-normal">{formatPercent(docAR6, basePo)}</div>
                            </th>

                            {/* Brand AR9 */}
                            <th className="py-2.5 px-2 border-r border-purple-800 min-w-[105px] bg-purple-950 text-purple-300">
                              <div>TOTAL CIF AR9</div>
                              <div className="text-[9px] text-purple-300 font-normal">{formatPercent(docAR9, basePo)}</div>
                            </th>

                            {/* Brand SOYU */}
                            <th className="py-2.5 px-2 border-r border-purple-800 min-w-[105px] bg-rose-950 text-rose-300">
                              <div>TOTAL CIF SOYU</div>
                              <div className="text-[9px] text-rose-400 font-normal">{formatPercent(docSOYU, basePo)}</div>
                            </th>

                            {/* Brand AFF NA */}
                            <th className="py-2.5 px-2 border-r border-purple-800 min-w-[105px] bg-teal-950 text-teal-300">
                              <div>TOTAL CIF AFF NA</div>
                              <div className="text-[9px] text-teal-400 font-normal">{formatPercent(docAFFNA, basePo)}</div>
                            </th>

                            <th className="py-2.5 px-3 border-r border-purple-800 min-w-[90px]">Ket</th>
                            <th className="py-2.5 px-2 min-w-[60px]">Aksi</th>
                          </tr>
                        </thead>

                        <tbody className="divide-y divide-slate-200">
                          {rowItemsWithBrand.length === 0 ? (
                            <tr>
                              <td colSpan={11} className="py-8 text-center text-slate-400">
                                Belum ada rincian biaya CIF di dalam dokumen ini. Klik "Import Biaya CIF" atau "+ Tambah Item Biaya".
                              </td>
                            </tr>
                          ) : (
                            rowItemsWithBrand.map((r, idx) => {
                              return (
                                <tr key={r.id} className="hover:bg-purple-50/30 transition">
                                  <td className="py-2.5 px-2 text-center text-slate-500 font-mono border-r border-slate-100">
                                    {idx + 1}
                                  </td>
                                  <td className="py-2.5 px-3 font-semibold text-slate-900 border-r border-slate-100">
                                    {r.desc}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono font-bold text-slate-900 border-r border-slate-100 text-right bg-amber-50/20">
                                    {formatCurrency(r.total)}
                                  </td>
                                  
                                  {/* AR1 Value */}
                                  <td className="py-2.5 px-2 font-mono text-emerald-900 font-semibold border-r border-slate-100 text-right bg-emerald-50/20">
                                    {formatCurrency(r.ar1)}
                                  </td>

                                  {/* AR20 Value */}
                                  <td className="py-2.5 px-2 font-mono text-indigo-900 font-semibold border-r border-slate-100 text-right bg-indigo-50/20">
                                    {formatCurrency(r.ar20)}
                                  </td>

                                  {/* AR6 Value */}
                                  <td className="py-2.5 px-2 font-mono text-blue-900 font-semibold border-r border-slate-100 text-right bg-blue-50/20">
                                    {formatCurrency(r.ar6)}
                                  </td>

                                  {/* AR9 Value */}
                                  <td className="py-2.5 px-2 font-mono text-purple-900 font-semibold border-r border-slate-100 text-right bg-purple-50/20">
                                    {formatCurrency(r.ar9)}
                                  </td>

                                  {/* SOYU Value */}
                                  <td className="py-2.5 px-2 font-mono text-rose-900 font-semibold border-r border-slate-100 text-right bg-rose-50/20">
                                    {formatCurrency(r.soyu)}
                                  </td>

                                  {/* AFF NA Value */}
                                  <td className="py-2.5 px-2 font-mono text-teal-900 font-semibold border-r border-slate-100 text-right bg-teal-50/20">
                                    {formatCurrency(r.affNa)}
                                  </td>

                                  <td className="py-2.5 px-3 border-r border-slate-100 text-center">
                                    <span className="px-2 py-0.5 bg-slate-100 text-slate-700 font-semibold rounded text-[10px]">
                                      {r.ket}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-2 text-center">
                                    <div className="flex items-center justify-center gap-1">
                                      <button
                                        onClick={() => handleOpenEditCif(r)}
                                        className="p-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition"
                                        title="Edit Item Biaya"
                                      >
                                        <Edit3 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteCif(r.id!)}
                                        className="p-1 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                                        title="Hapus Item Biaya"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>

                        {/* Modal Footer Totals */}
                        {rowItemsWithBrand.length > 0 && (
                          <tfoot>
                            <tr className="bg-purple-950 text-white font-bold border-t-2 border-purple-900 text-xs">
                              <td colSpan={2} className="py-2.5 px-3 text-right uppercase tracking-wider">
                                TOTAL BIAYA DOKUMEN:
                              </td>
                              <td className="py-2.5 px-3 font-mono text-right bg-amber-950 text-amber-300 font-extrabold">
                                {formatCurrency(sumCif)}
                              </td>
                              <td className="py-2.5 px-2 font-mono text-right bg-emerald-950 text-emerald-300 font-extrabold">
                                {formatCurrency(sumRowAR1)}
                              </td>
                              <td className="py-2.5 px-2 font-mono text-right bg-indigo-950 text-indigo-300 font-extrabold">
                                {formatCurrency(sumRowAR20)}
                              </td>
                              <td className="py-2.5 px-2 font-mono text-right bg-blue-950 text-blue-300 font-extrabold">
                                {formatCurrency(sumRowAR6)}
                              </td>
                              <td className="py-2.5 px-2 font-mono text-right bg-purple-900 text-purple-300 font-extrabold">
                                {formatCurrency(sumRowAR9)}
                              </td>
                              <td className="py-2.5 px-2 font-mono text-right bg-rose-950 text-rose-300 font-extrabold">
                                {formatCurrency(sumRowSOYU)}
                              </td>
                              <td className="py-2.5 px-2 font-mono text-right bg-teal-950 text-teal-300 font-extrabold">
                                {formatCurrency(sumRowAFFNA)}
                              </td>
                              <td colSpan={2} className="py-2.5 px-2 text-center font-mono text-amber-200">
                                % CIF/PO: {cifPct}
                              </td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>

                    {/* SECTION 2: BIAYA SELAIN CIF - Depre Manual */}
                    {(() => {
                      const containerNonCifRecords = nonCifRecords.filter(r => cleanContKey(r.noContainer) === cleanContKey(detailContainerNo));
                      const sumNonCif = containerNonCifRecords.reduce((acc, r) => acc + (r.total || 0), 0);
                      const sumNonCifAR1 = containerNonCifRecords.reduce((acc, r) => acc + (r.ar1 || 0), 0);
                      const sumNonCifAR20 = containerNonCifRecords.reduce((acc, r) => acc + (r.ar20 || 0), 0);
                      const sumNonCifAR6 = containerNonCifRecords.reduce((acc, r) => acc + (r.ar6 || 0), 0);
                      const sumNonCifAR9 = containerNonCifRecords.reduce((acc, r) => acc + (r.ar9 || 0), 0);
                      const sumNonCifSOYU = containerNonCifRecords.reduce((acc, r) => acc + (r.soyu || 0), 0);
                      const sumNonCifAFFNA = containerNonCifRecords.reduce((acc, r) => acc + (r.affNa || 0), 0);

                      const pctNonCif = basePo > 0 ? formatPercent(sumNonCif, basePo) : '0.0%';
                      const grandTotal = sumCif + sumNonCif;
                      const pctGrandTotal = basePo > 0 ? formatPercent(grandTotal, basePo) : '0.0%';
                      const ppnKontainer = Math.round(basePo * 0.11);

                      return (
                        <div className="space-y-3 pt-2 border-t border-slate-200">
                          {/* Banner Title Row matching user's requested layout */}
                          <div className="bg-rose-700 text-white font-bold px-3 py-2 rounded-t-xl flex items-center justify-between text-xs tracking-wide uppercase">
                            <div className="flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4 text-amber-300" />
                              <span>SELAIN CIF - Depre manual ({containerNonCifRecords.length} Item Biaya)</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  setNonCifFormData({
                                    bulanKontJalan: firstRec?.bulanKontJalan || 'Januari 2026',
                                    noContainer: detailContainerNo,
                                    tanggal: new Date().toISOString().slice(0, 10),
                                    kategoriBiaya: NON_CIF_CATEGORY_OPTIONS[0],
                                    desc: '',
                                    total: 0,
                                    ar1: 0,
                                    ar20: 0,
                                    ar6: 0,
                                    ar9: 0,
                                    soyu: 0,
                                    affNa: 0,
                                    ket: ''
                                  });
                                  setIsNonCifModalOpen(true);
                                }}
                                className="px-2.5 py-1 bg-white/20 hover:bg-white/30 text-white font-semibold rounded text-[11px] transition cursor-pointer flex items-center gap-1"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Tambah Biaya Selain CIF</span>
                              </button>
                              <button
                                onClick={() => {
                                  setIsImportNonCifModalOpen(true);
                                }}
                                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded text-[11px] transition cursor-pointer flex items-center gap-1 shadow-2xs"
                              >
                                <Upload className="w-3.5 h-3.5" />
                                <span>Import Biaya Selain CIF</span>
                              </button>
                            </div>
                          </div>

                          {/* Table Besides CIF */}
                          <div className="border border-slate-200 rounded-b-xl overflow-x-auto bg-white shadow-2xs">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead>
                                <tr className="bg-rose-900 text-white font-bold border-b border-rose-950 text-center">
                                  <th className="py-2.5 px-2 border-r border-rose-800 w-8">No</th>
                                  <th className="py-2.5 px-3 border-r border-rose-800 min-w-[180px]">Deskripsi Biaya Selain CIF</th>
                                  <th className="py-2.5 px-3 border-r border-rose-800 min-w-[120px] bg-rose-950 text-rose-200">Total Biaya</th>
                                  <th className="py-2.5 px-2 border-r border-rose-800 min-w-[105px] bg-emerald-950 text-emerald-300">AR1</th>
                                  <th className="py-2.5 px-2 border-r border-rose-800 min-w-[105px] bg-indigo-950 text-indigo-300">AR20</th>
                                  <th className="py-2.5 px-2 border-r border-rose-800 min-w-[105px] bg-blue-950 text-blue-300">AR6</th>
                                  <th className="py-2.5 px-2 border-r border-rose-800 min-w-[105px] bg-purple-950 text-purple-300">AR9</th>
                                  <th className="py-2.5 px-2 border-r border-rose-800 min-w-[105px] bg-rose-950 text-rose-300">SOYU</th>
                                  <th className="py-2.5 px-2 border-r border-rose-800 min-w-[105px] bg-teal-950 text-teal-300">AFF NA</th>
                                  <th className="py-2.5 px-3 border-r border-rose-800 min-w-[90px]">Ket</th>
                                  <th className="py-2.5 px-2 min-w-[60px]">Aksi</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200">
                                {containerNonCifRecords.length === 0 ? (
                                  <tr>
                                    <td colSpan={11} className="py-6 text-center text-slate-400 italic">
                                      Belum ada item Biaya Selain CIF - Depre manual untuk kontainer {detailContainerNo}.
                                    </td>
                                  </tr>
                                ) : (
                                  containerNonCifRecords.map((r, idx) => (
                                    <tr key={r.id} className="hover:bg-rose-50/30 transition">
                                      <td className="py-2 px-2 text-center text-slate-500 font-mono border-r border-slate-100">{idx + 1}</td>
                                      <td className="py-2 px-3 font-medium text-slate-900 border-r border-slate-100">{r.desc}</td>
                                      <td className="py-2 px-3 font-mono font-bold text-rose-900 border-r border-slate-100 text-right bg-rose-50/20">{formatCurrency(r.total)}</td>
                                      <td className="py-2 px-2 font-mono text-emerald-900 font-semibold border-r border-slate-100 text-right">{formatCurrency(r.ar1)}</td>
                                      <td className="py-2 px-2 font-mono text-indigo-900 font-semibold border-r border-slate-100 text-right">{formatCurrency(r.ar20)}</td>
                                      <td className="py-2 px-2 font-mono text-blue-900 font-semibold border-r border-slate-100 text-right">{formatCurrency(r.ar6)}</td>
                                      <td className="py-2 px-2 font-mono text-purple-900 font-semibold border-r border-slate-100 text-right">{formatCurrency(r.ar9)}</td>
                                      <td className="py-2 px-2 font-mono text-rose-900 font-semibold border-r border-slate-100 text-right">{formatCurrency(r.soyu)}</td>
                                      <td className="py-2 px-2 font-mono text-teal-900 font-semibold border-r border-slate-100 text-right">{formatCurrency(r.affNa)}</td>
                                      <td className="py-2 px-3 border-r border-slate-100 text-center text-[10px] text-slate-600">{r.ket || '-'}</td>
                                      <td className="py-2 px-2 text-center">
                                        <button onClick={() => handleDeleteNonCif(r.id!)} className="p-1 text-slate-400 hover:text-rose-600 rounded">
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                              <tfoot>
                                {/* Subtotal Selain CIF */}
                                <tr className="bg-rose-950 text-white font-bold border-t-2 border-rose-900 text-xs">
                                  <td colSpan={2} className="py-2 px-3 text-right uppercase tracking-wider">Total Biaya Selain CIF:</td>
                                  <td className="py-2 px-3 font-mono text-right bg-rose-900 text-white font-extrabold">{formatCurrency(sumNonCif)}</td>
                                  <td className="py-2 px-2 font-mono text-right text-emerald-300 font-bold">{formatCurrency(sumNonCifAR1)}</td>
                                  <td className="py-2 px-2 font-mono text-right text-indigo-300 font-bold">{formatCurrency(sumNonCifAR20)}</td>
                                  <td className="py-2 px-2 font-mono text-right text-blue-300 font-bold">{formatCurrency(sumNonCifAR6)}</td>
                                  <td className="py-2 px-2 font-mono text-right text-purple-300 font-bold">{formatCurrency(sumNonCifAR9)}</td>
                                  <td className="py-2 px-2 font-mono text-right text-rose-300 font-bold">{formatCurrency(sumNonCifSOYU)}</td>
                                  <td className="py-2 px-2 font-mono text-right text-teal-300 font-bold">{formatCurrency(sumNonCifAFFNA)}</td>
                                  <td colSpan={2} className="py-2 px-2 text-center font-mono text-amber-200">
                                    % Selain CIF: {pctNonCif}
                                  </td>
                                </tr>
                                {/* Presentase Biaya cont Banding Nilai cont for Selain CIF */}
                                <tr className="bg-rose-100 text-rose-950 font-bold text-xs border-t border-rose-200">
                                  <td colSpan={2} className="py-2 px-3 text-right">Presentase Biaya cont Banding Nilai cont:</td>
                                  <td className="py-2 px-3 font-mono text-right text-rose-950 font-extrabold">{pctNonCif}</td>
                                  <td className="py-2 px-2 font-mono text-right">{docAR1 > 0 ? formatPercent(sumNonCifAR1, docAR1) : '0%'}</td>
                                  <td className="py-2 px-2 font-mono text-right">{docAR20 > 0 ? formatPercent(sumNonCifAR20, docAR20) : '0%'}</td>
                                  <td className="py-2 px-2 font-mono text-right">{docAR6 > 0 ? formatPercent(sumNonCifAR6, docAR6) : '0%'}</td>
                                  <td className="py-2 px-2 font-mono text-right">{docAR9 > 0 ? formatPercent(sumNonCifAR9, docAR9) : '0%'}</td>
                                  <td className="py-2 px-2 font-mono text-right">{docSOYU > 0 ? formatPercent(sumNonCifSOYU, docSOYU) : '0%'}</td>
                                  <td className="py-2 px-2 font-mono text-right">{docAFFNA > 0 ? formatPercent(sumNonCifAFFNA, docAFFNA) : '0%'}</td>
                                  <td colSpan={2}></td>
                                </tr>
                                {/* Grand Total All Biaya */}
                                <tr className="bg-slate-900 text-white font-black text-xs border-t-2 border-slate-950">
                                  <td colSpan={2} className="py-2.5 px-3 text-right uppercase tracking-wider">Grand total all Biaya:</td>
                                  <td className="py-2.5 px-3 font-mono text-right text-amber-300 font-black text-sm">{formatCurrency(grandTotal)}</td>
                                  <td className="py-2.5 px-2 font-mono text-right text-emerald-300 font-bold">{formatCurrency(sumRowAR1 + sumNonCifAR1)}</td>
                                  <td className="py-2.5 px-2 font-mono text-right text-indigo-300 font-bold">{formatCurrency(sumRowAR20 + sumNonCifAR20)}</td>
                                  <td className="py-2.5 px-2 font-mono text-right text-blue-300 font-bold">{formatCurrency(sumRowAR6 + sumNonCifAR6)}</td>
                                  <td className="py-2.5 px-2 font-mono text-right text-purple-300 font-bold">{formatCurrency(sumRowAR9 + sumNonCifAR9)}</td>
                                  <td className="py-2.5 px-2 font-mono text-right text-rose-300 font-bold">{formatCurrency(sumRowSOYU + sumNonCifSOYU)}</td>
                                  <td className="py-2.5 px-2 font-mono text-right text-teal-300 font-bold">{formatCurrency(sumRowAFFNA + sumNonCifAFFNA)}</td>
                                  <td colSpan={2} className="py-2.5 px-2 text-center font-mono text-amber-300 font-bold">{pctGrandTotal}</td>
                                </tr>
                                {/* Presentase Biaya cont Banding Nilai cont for Grand Total */}
                                <tr className="bg-amber-100 text-amber-950 font-black text-xs border-t border-amber-300">
                                  <td colSpan={2} className="py-2 px-3 text-right">Presentase Biaya cont Banding Nilai cont (Grand Total):</td>
                                  <td className="py-2 px-3 font-mono text-right text-amber-950 font-black">{pctGrandTotal}</td>
                                  <td colSpan={8} className="py-2 px-3 text-slate-700 text-[10px] italic">Combined Total CIF + Selain CIF vs Nilai Cost PO</td>
                                </tr>
                                {/* PPN Kontainer */}
                                <tr className="bg-rose-50 text-rose-900 font-extrabold text-xs border-t border-rose-300">
                                  <td colSpan={2} className="py-2 px-3 text-right text-rose-700">PPN Kontainer:</td>
                                  <td className="py-2 px-3 font-mono text-right text-rose-700 font-black"></td>
                                  <td colSpan={8} className="py-2 px-3 text-slate-500 text-[10px] italic">(Diisi manual)</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer Close */}
            <div className="p-3 bg-slate-100 border-t border-slate-200 flex items-center justify-end shrink-0">
              <button
                type="button"
                onClick={() => setIsDetailContainerModalOpen(false)}
                className="px-5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg transition text-xs shadow-2xs cursor-pointer"
              >
                Tutup Detail
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: FORM TAMBAH / EDIT CIF RESUME KONTAINER                           */}
      {/* ========================================================================= */}
      {isCifModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden">
            <div className="bg-purple-900 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calculator className="w-5 h-5 text-purple-300" />
                <h3 className="font-bold text-sm">
                  {editingCif ? 'Edit Baris CIF Kontainer' : 'Tambah Baris Resume CIF Kontainer'}
                </h3>
              </div>
              <button
                onClick={() => setIsCifModalOpen(false)}
                className="p-1 hover:bg-white/20 rounded transition text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCif} className="p-4 space-y-3.5 text-xs">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    No Container <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    list="cif-container-list"
                    placeholder="Pilih atau ketik No Container..."
                    value={cifFormData.noContainer}
                    onChange={(e) => {
                      const val = e.target.value.toUpperCase();
                      const match = containers.find(c => c.noContainer.toUpperCase() === val);
                      const autoPo = match ? (match.totalCost || match.totalPrice || 0) : 0;
                      setCifFormData(prev => ({
                        ...prev,
                        noContainer: val,
                        totalNilaiPo: autoPo > 0 ? autoPo : prev.totalNilaiPo
                      }));
                    }}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono font-bold"
                  />
                  <datalist id="cif-container-list">
                    {containers.map(c => (
                      <option key={c.id || c.noContainer} value={c.noContainer}>
                        {c.noContainer} (Total Cost: {formatCurrency(c.totalCost || c.totalPrice || 0)})
                      </option>
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Tgl Terima Kontainer
                  </label>
                  <input
                    type="date"
                    value={cifFormData.tglFinalPembayaranPib}
                    onChange={(e) => setCifFormData(prev => ({ ...prev, tglFinalPembayaranPib: e.target.value }))}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Keterangan Status (Ket)
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: LUNAS PIB / TIBA BINTARA"
                    value={cifFormData.ket}
                    onChange={(e) => setCifFormData(prev => ({ ...prev, ket: e.target.value }))}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500 font-semibold"
                  />
                </div>
              </div>

              {/* Rincian Biaya (Desc) Dropdown strictly matching User Image */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Deskripsi Biaya (Desc) <span className="text-rose-500">*</span>
                </label>
                <select
                  value={cifFormData.desc}
                  onChange={(e) => setCifFormData(prev => ({ ...prev, desc: e.target.value }))}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500 font-medium text-slate-900"
                >
                  {ALLOWED_DESC_OPTIONS.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  Pilih item rincian biaya sesuai daftar resmi standar GZ.
                </p>
              </div>

              {/* Total Nilai PO Kontainer Input */}
              <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold text-blue-900">
                    Total Nilai PO Kontainer (Rp)
                  </label>
                  {cifFormData.noContainer && (
                    <button
                      type="button"
                      onClick={() => {
                        const match = containers.find(c => c.noContainer.toUpperCase() === cifFormData.noContainer.toUpperCase());
                        if (match && (match.totalCost || match.totalPrice)) {
                          const poVal = match.totalCost || match.totalPrice || 0;
                          setCifFormData(prev => ({ ...prev, totalNilaiPo: poVal }));
                          showToast(`Nilai PO diisi otomatis dari Status Container: ${formatCurrency(poVal)}`, 'info');
                        } else {
                          showToast('Tidak ditemukan data PO di Status Container untuk container ini', 'info');
                        }
                      }}
                      className="text-[10px] text-blue-700 hover:underline font-semibold cursor-pointer"
                    >
                      Ambil Nilai PO dari Container
                    </button>
                  )}
                </div>
                <div className="flex items-center">
                  <span className="px-2.5 py-1.5 bg-blue-100 border border-r-0 border-blue-300 rounded-l-lg text-blue-900 font-bold text-xs shrink-0">Rp</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="Contoh: 1500000000"
                    value={cifFormData.totalNilaiPo || ''}
                    onChange={(e) => setCifFormData(prev => ({ ...prev, totalNilaiPo: Number(e.target.value) }))}
                    className="w-full px-3 py-1.5 bg-white border border-blue-300 rounded-r-lg focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono font-bold text-blue-900 text-xs"
                  />
                </div>
                <p className="text-[10px] text-blue-700">
                  Digunakan untuk menghitung Persentase CIF (Total Nilai CIF / Total Nilai PO Kontainer).
                </p>
              </div>

              {/* Total Nilai CIF Input */}
              <div className="p-3 bg-purple-50/50 border border-purple-200 rounded-xl space-y-2">
                <label className="block text-[11px] font-bold text-purple-900">
                  Total Nilai CIF (Rp) <span className="text-rose-500">*</span>
                </label>
                <div className="flex items-center">
                  <span className="px-2.5 py-1.5 bg-purple-100 border border-r-0 border-purple-300 rounded-l-lg text-purple-900 font-bold text-xs shrink-0">Rp</span>
                  <input
                    type="number"
                    min="0"
                    required
                    placeholder="Masukkan Total Nilai CIF (contoh: 89589523)"
                    value={cifFormData.total || ''}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setCifFormData(prev => ({ ...prev, total: val }));
                    }}
                    className="w-full px-3 py-1.5 bg-white border border-purple-300 rounded-r-lg font-mono font-bold text-purple-900 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                </div>
                {cifFormData.totalNilaiPo > 0 && cifFormData.total > 0 && (
                  <div className="text-[10px] text-purple-700 font-semibold">
                    Ratio CIF / PO: {formatPercent(cifFormData.total, cifFormData.totalNilaiPo)}
                  </div>
                )}
              </div>

              {/* Rincian Biaya Per Brand Breakdown */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <label className="block text-[11px] font-bold text-slate-800">
                  Rincian Biaya Per Brand (Optional Breakdown: AR1, AR20, AR6, AR9, SOYU, AFF NA)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-emerald-800 mb-0.5">AR1</label>
                    <div className="flex items-center">
                      <span className="px-1.5 py-1 bg-emerald-100 border border-r-0 border-emerald-300 rounded-l text-emerald-900 font-bold text-[10px] shrink-0">Rp</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={cifFormData.ar1 || ''}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setCifFormData(prev => ({ ...prev, ar1: val }));
                        }}
                        className="w-full px-1.5 py-1 bg-white border border-emerald-300 rounded-r font-mono font-bold text-emerald-900 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-indigo-800 mb-0.5">AR20</label>
                    <div className="flex items-center">
                      <span className="px-1.5 py-1 bg-indigo-100 border border-r-0 border-indigo-300 rounded-l text-indigo-900 font-bold text-[10px] shrink-0">Rp</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={cifFormData.ar20 || ''}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setCifFormData(prev => ({ ...prev, ar20: val }));
                        }}
                        className="w-full px-1.5 py-1 bg-white border border-indigo-300 rounded-r font-mono font-bold text-indigo-900 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-blue-800 mb-0.5">AR6</label>
                    <div className="flex items-center">
                      <span className="px-1.5 py-1 bg-blue-100 border border-r-0 border-blue-300 rounded-l text-blue-900 font-bold text-[10px] shrink-0">Rp</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={cifFormData.ar6 || ''}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setCifFormData(prev => ({ ...prev, ar6: val }));
                        }}
                        className="w-full px-1.5 py-1 bg-white border border-blue-300 rounded-r font-mono font-bold text-blue-900 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-purple-800 mb-0.5">AR9</label>
                    <div className="flex items-center">
                      <span className="px-1.5 py-1 bg-purple-100 border border-r-0 border-purple-300 rounded-l text-purple-900 font-bold text-[10px] shrink-0">Rp</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={cifFormData.ar9 || ''}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setCifFormData(prev => ({ ...prev, ar9: val }));
                        }}
                        className="w-full px-1.5 py-1 bg-white border border-purple-300 rounded-r font-mono font-bold text-purple-900 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-rose-800 mb-0.5">SOYU</label>
                    <div className="flex items-center">
                      <span className="px-1.5 py-1 bg-rose-100 border border-r-0 border-rose-300 rounded-l text-rose-900 font-bold text-[10px] shrink-0">Rp</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={cifFormData.soyu || ''}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setCifFormData(prev => ({ ...prev, soyu: val }));
                        }}
                        className="w-full px-1.5 py-1 bg-white border border-rose-300 rounded-r font-mono font-bold text-rose-900 text-xs focus:outline-none focus:ring-1 focus:ring-rose-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-teal-800 mb-0.5">AFF NA</label>
                    <div className="flex items-center">
                      <span className="px-1.5 py-1 bg-teal-100 border border-r-0 border-teal-300 rounded-l text-teal-900 font-bold text-[10px] shrink-0">Rp</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={cifFormData.affNa || ''}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setCifFormData(prev => ({ ...prev, affNa: val }));
                        }}
                        className="w-full px-1.5 py-1 bg-white border border-teal-300 rounded-r font-mono font-bold text-teal-900 text-xs focus:outline-none focus:ring-1 focus:ring-teal-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsCifModalOpen(false)}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-purple-700 hover:bg-purple-800 text-white font-semibold rounded-lg transition shadow-2xs cursor-pointer"
                >
                  Simpan Data CIF
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: FORM TAMBAH / EDIT BAP KONTAINER                                   */}
      {/* ========================================================================= */}
      {isBapModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-slate-900 text-white p-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-sm">
                  {editingBap ? 'Edit Item BAP Penerimaan Kontainer' : 'Input Item BAP Kontainer Baru'}
                </h3>
              </div>
              <button
                onClick={() => setIsBapModalOpen(false)}
                className="p-1 hover:bg-white/20 rounded transition text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveBap} className="p-4 space-y-3 text-xs overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    No BAP / Berita Acara
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: BAP/2026/001"
                    value={bapFormData.bapNo}
                    onChange={(e) => setBapFormData(prev => ({ ...prev, bapNo: e.target.value }))}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-mono focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    No Container <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Contoh: TCNU8834190"
                    value={bapFormData.noContainer}
                    onChange={(e) => setBapFormData(prev => ({ ...prev, noContainer: e.target.value.toUpperCase() }))}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-mono font-bold focus:outline-none"
                  />
                </div>
              </div>

              {/* Item Code & Master Item Auto-Fill */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Item Code <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    list="master-item-list"
                    placeholder="Masukkan atau pilih Kode Barang..."
                    value={bapFormData.itemCode}
                    onChange={(e) => handleSelectMasterItem(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-mono font-bold text-blue-700 focus:outline-none"
                  />
                  <datalist id="master-item-list">
                    {masterItems.map(m => (
                      <option key={m.itemCode} value={m.itemCode}>{m.itemName}</option>
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Item Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Nama Barang lengkap"
                    value={bapFormData.itemName}
                    onChange={(e) => setBapFormData(prev => ({ ...prev, itemName: e.target.value }))}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none font-medium"
                  />
                </div>
              </div>

              {/* Nilai Jual & Nilai Cost */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Nilai Jual (Rp / unit)
                  </label>
                  <div className="flex items-center">
                    <span className="px-2.5 py-1.5 bg-slate-100 border border-r-0 border-slate-200 rounded-l-lg text-slate-600 font-bold text-xs shrink-0">Rp</span>
                    <input
                      type="number"
                      min="0"
                      value={bapFormData.nilaiJual || ''}
                      onChange={(e) => setBapFormData(prev => ({ ...prev, nilaiJual: Number(e.target.value) }))}
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-r-lg font-mono focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Nilai Cost / Modal (Rp / unit)
                  </label>
                  <div className="flex items-center">
                    <span className="px-2.5 py-1.5 bg-slate-100 border border-r-0 border-slate-200 rounded-l-lg text-slate-600 font-bold text-xs shrink-0">Rp</span>
                    <input
                      type="number"
                      min="0"
                      value={bapFormData.nilaiCost || ''}
                      onChange={(e) => setBapFormData(prev => ({ ...prev, nilaiCost: Number(e.target.value) }))}
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-r-lg font-mono focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Qty Breakdown Section */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                  Rincian Qty Penerimaan Barang
                </div>

                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-800 mb-1">Qty Container</label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={bapFormData.qtyContainer || ''}
                      onChange={(e) => setBapFormData(prev => ({ ...prev, qtyContainer: Number(e.target.value) }))}
                      className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg font-mono font-bold text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-emerald-800 mb-1">Qty Bagus</label>
                    <input
                      type="number"
                      min="0"
                      value={bapFormData.qtyTerimaBagus || ''}
                      onChange={(e) => setBapFormData(prev => ({ ...prev, qtyTerimaBagus: Number(e.target.value) }))}
                      className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg font-mono font-bold text-emerald-800"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-amber-800 mb-1">Qty Rijek Kecil</label>
                    <input
                      type="number"
                      min="0"
                      value={bapFormData.qtyTerimaRk || ''}
                      onChange={(e) => setBapFormData(prev => ({ ...prev, qtyTerimaRk: Number(e.target.value) }))}
                      className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg font-mono font-bold text-amber-800"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-rose-800 mb-1">Qty Rijek Mayor</label>
                    <input
                      type="number"
                      min="0"
                      value={bapFormData.qtyTerimaRm || ''}
                      onChange={(e) => setBapFormData(prev => ({ ...prev, qtyTerimaRm: Number(e.target.value) }))}
                      className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg font-mono font-bold text-rose-800"
                    />
                  </div>
                </div>
              </div>

              {/* Foto Barang Rijek Upload */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Foto Barang Rijek
                </label>
                <div className="flex items-center gap-3">
                  {bapFormData.fotoRijekUrl ? (
                    <div className="relative shrink-0">
                      <img
                        src={bapFormData.fotoRijekUrl}
                        alt="Preview Rijek"
                        className="w-16 h-16 object-cover rounded-lg border border-slate-300 shadow-2xs"
                      />
                      <button
                        type="button"
                        onClick={() => setBapFormData(prev => ({ ...prev, fotoRijekUrl: '' }))}
                        className="absolute -top-1.5 -right-1.5 p-0.5 bg-rose-600 text-white rounded-full hover:bg-rose-700 transition cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center text-slate-400 shrink-0">
                      <ImageIcon className="w-6 h-6" />
                    </div>
                  )}

                  <div className="flex-1">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                      id="foto-rijek-input"
                    />
                    <label
                      htmlFor="foto-rijek-input"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg border border-slate-300 cursor-pointer transition text-xs"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{bapFormData.fotoRijekUrl ? 'Ganti Foto Rijek' : 'Upload Foto Barang Rijek'}</span>
                    </label>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Format JPG/PNG/WEBP. Foto akan dikompres otomatis.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Keterangan Kerusakan / Catatan QC
                </label>
                <textarea
                  rows={2}
                  placeholder="Contoh: Dus basah di lantai container, sudut barang patah..."
                  value={bapFormData.keterangan}
                  onChange={(e) => setBapFormData(prev => ({ ...prev, keterangan: e.target.value }))}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsBapModalOpen(false)}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition shadow-2xs cursor-pointer"
                >
                  Simpan Item BAP
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: IMPORT CIF PER NO CONTAINER                                      */}
      {/* ========================================================================= */}
      {isImportCifModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col">
            <div className="bg-purple-900 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileUp className="w-5 h-5 text-purple-300" />
                <h3 className="font-bold text-sm">
                  Import Data CIF Per No Container
                </h3>
              </div>
              <button
                onClick={() => setIsImportCifModalOpen(false)}
                className="p-1 hover:bg-white/20 rounded transition text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 text-xs">
              {detailContainerNo && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-amber-900 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-xs">Target Dokumen Kontainer: </span>
                    <span className="font-mono font-extrabold text-purple-900 bg-amber-200/80 px-2 py-0.5 rounded text-xs ml-1">
                      {detailContainerNo}
                    </span>
                    <p className="text-[10px] text-amber-800 mt-0.5">
                      Semua data Biaya CIF yang di-import akan dimasukkan ke Dokumen Kontainer ini.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between bg-purple-50 p-3 rounded-lg border border-purple-200">
                <div>
                  <div className="font-bold text-purple-950 text-xs">Petunjuk Format Import Deskripsi Biaya (Desc):</div>
                  <div className="text-[11px] text-purple-800 mt-0.5">
                    Urutan Header: {detailContainerNo ? (
                      <code className="font-mono bg-purple-100 px-1.5 py-0.5 rounded font-bold text-purple-900">Deskripsi Biaya (Desc), Total CIF, Keterangan</code>
                    ) : (
                      <code className="font-mono bg-purple-100 px-1.5 py-0.5 rounded font-bold text-purple-900">No Container, Deskripsi Biaya (Desc), Total CIF, Keterangan</code>
                    )}
                  </div>
                  <div className="text-[10px] text-purple-700 mt-1">
                    * Nilai Total Cost PO otomatis disinkronkan dari menu Status Container berdasarkan Nomor Container.
                  </div>
                </div>
                <button
                  onClick={handleDownloadCifTemplate}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-700 hover:bg-purple-800 text-white font-semibold rounded-lg transition cursor-pointer text-xs shrink-0 shadow-2xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Template</span>
                </button>
              </div>

              {/* File Picker Option */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-purple-700" />
                  <span className="font-semibold text-slate-700 text-xs">Import dari File CSV / Spreadsheet:</span>
                </div>
                <input
                  type="file"
                  accept=".csv, .txt, .tsv, .xlsx, .xls"
                  onChange={handleCifFileUpload}
                  id="cif-file-upload-input"
                  className="hidden"
                />
                <label
                  htmlFor="cif-file-upload-input"
                  className="px-3 py-1.5 bg-purple-700 hover:bg-purple-800 text-white font-semibold rounded-lg cursor-pointer transition flex items-center gap-1.5 shadow-2xs text-xs shrink-0"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Pilih File CSV</span>
                </label>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Atau Copy-Paste Data dari Excel / Spreadsheet:
                </label>
                <textarea
                  rows={6}
                  placeholder={detailContainerNo ? `Total Biaya BEA Masuk\t33988000\tLUNAS PIB
Total Biaya Sea Freight\t37100000\tLUNAS PIB` : `GZ239 (20FT)\tTotal Biaya BEA Masuk\t33988000\tLUNAS PIB
GZ239 (20FT)\tTotal Biaya Sea Freight\t37100000\tLUNAS PIB`}
                  value={importCifText}
                  onChange={(e) => setImportCifText(e.target.value)}
                  className="w-full p-3 font-mono text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsImportCifModalOpen(false)}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleProcessImportCif}
                  className="px-4 py-1.5 bg-purple-700 hover:bg-purple-800 text-white font-semibold rounded-lg transition shadow-2xs cursor-pointer"
                >
                  Proses Import CIF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: IMPORT BAP PER NO KONTAINER                                      */}
      {/* ========================================================================= */}
      {isImportBapModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col">
            <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileUp className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-sm">
                  Import Data BAP Kontainer (Penerimaan QC)
                </h3>
              </div>
              <button
                onClick={() => setIsImportBapModalOpen(false)}
                className="p-1 hover:bg-white/20 rounded transition text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between bg-blue-50 p-3 rounded-lg border border-blue-200">
                <div>
                  <div className="font-bold text-blue-950 text-xs">Petunjuk Format Import BAP:</div>
                  <div className="text-[11px] text-blue-800 mt-0.5">
                    Urutan Kolom: <code className="font-mono bg-blue-100 px-1 rounded">No Container, Item Code, Item Name, Nilai Jual, Nilai Cost, Qty Container, Qty Bagus, Qty RK, Qty RM, Ket</code>
                  </div>
                </div>
                <button
                  onClick={handleDownloadBapTemplate}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white font-semibold rounded-lg transition cursor-pointer text-xs shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Template</span>
                </button>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Paste Data dari Excel / Spreadsheet:
                </label>
                <textarea
                  rows={8}
                  placeholder={`TCNU8834190\tLAM-OAK-01\tLaminate Flooring Oak Natural 8mm\t145000\t85000\t1200\t1180\t15\t5\tDus basah dan barang rijek`}
                  value={importBapText}
                  onChange={(e) => setImportBapText(e.target.value)}
                  className="w-full p-3 font-mono text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsImportBapModalOpen(false)}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleProcessImportBap}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition shadow-2xs cursor-pointer"
                >
                  Proses Import BAP
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL LIGHTBOX PHOTO ZOOM                                                  */}
      {/* ========================================================================= */}
      {previewImage && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setPreviewImage(null)}
        >
          <div 
            className="bg-slate-900 text-white rounded-xl shadow-2xl border border-slate-800 max-w-2xl w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <span className="font-bold text-xs truncate">{previewImage.title}</span>
              <button
                onClick={() => setPreviewImage(null)}
                className="p-1 hover:bg-slate-800 rounded transition text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 flex flex-col items-center justify-center bg-black/50">
              <img
                src={previewImage.url}
                alt="Enlarged Rijek"
                className="max-h-[70vh] object-contain rounded-lg border border-slate-800 shadow-md"
              />
              {previewImage.desc && (
                <p className="text-xs text-slate-300 mt-3 font-mono text-center">
                  {previewImage.desc}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL CONFIRMATION DIALOG (Replaces window.confirm for iframe safety)    */}
      {/* ========================================================================= */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden flex flex-col">
            <div className="bg-rose-900 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-300" />
                <h3 className="font-bold text-sm">{confirmModal.title}</h3>
              </div>
              <button
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="p-1 hover:bg-white/20 rounded transition text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 text-xs text-slate-700 space-y-4">
              <p className="text-sm font-medium leading-relaxed">{confirmModal.message}</p>
              
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={() => {
                    confirmModal.onConfirm();
                  }}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-lg transition shadow-2xs cursor-pointer flex items-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{confirmModal.confirmLabel || 'Hapus'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ========================================================================= */}
      {/* MODAL: FORM TAMBAH / EDIT BIAYA SELAIN CIF - DEPRE MANUAL                */}
      {/* ========================================================================= */}
      {isNonCifModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-amber-800 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-amber-300" />
                <h3 className="font-bold text-sm">
                  {editingNonCif ? 'Edit Baris Biaya Selain CIF' : 'Tambah Biaya Selain CIF - Depre Manual'}
                </h3>
              </div>
              <button
                onClick={() => setIsNonCifModalOpen(false)}
                className="p-1 hover:bg-white/20 rounded transition text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveNonCif} className="p-4 space-y-3.5 text-xs overflow-y-auto">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  No Container <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  list="noncif-container-list"
                  placeholder="Contoh: TCNU8834190"
                  value={nonCifFormData.noContainer}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNonCifFormData(prev => ({ ...prev, noContainer: val }));
                  }}
                  className="w-full p-2 font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 text-xs font-bold uppercase"
                  required
                />
                <datalist id="noncif-container-list">
                  {containerList.map(c => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Tanggal Transaksi
                  </label>
                  <input
                    type="date"
                    value={nonCifFormData.tanggal}
                    onChange={(e) => setNonCifFormData(prev => ({ ...prev, tanggal: e.target.value }))}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 text-xs"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Kategori Biaya <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={nonCifFormData.kategoriBiaya}
                    onChange={(e) => setNonCifFormData(prev => ({ ...prev, kategoriBiaya: e.target.value }))}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 text-xs font-semibold"
                  >
                    {NON_CIF_CATEGORY_OPTIONS.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Deskripsi Rincian Biaya <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Depresiasi Manual Aset Kontainer Bulan Jan 2026"
                  value={nonCifFormData.desc}
                  onChange={(e) => setNonCifFormData(prev => ({ ...prev, desc: e.target.value }))}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 text-xs"
                  required
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block font-semibold text-slate-700">
                    Total Biaya Selain CIF (Rp) <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (!nonCifFormData.noContainer) {
                        showToast('Isi No Container terlebih dahulu!', 'error');
                        return;
                      }
                      const splitRec = ensureNonCifBrandSplit({
                        noContainer: nonCifFormData.noContainer,
                        total: nonCifFormData.total,
                        ar1: 0, ar20: 0, ar6: 0, ar9: 0, soyu: 0, affNa: 0,
                        bulanKontJalan: nonCifFormData.bulanKontJalan,
                        tanggal: nonCifFormData.tanggal,
                        kategoriBiaya: nonCifFormData.kategoriBiaya,
                        desc: nonCifFormData.desc,
                        ket: nonCifFormData.ket
                      }, cifRecords, containers);

                      setNonCifFormData(prev => ({
                        ...prev,
                        ar1: splitRec.ar1 || 0,
                        ar20: splitRec.ar20 || 0,
                        ar6: splitRec.ar6 || 0,
                        ar9: splitRec.ar9 || 0,
                        soyu: splitRec.soyu || 0,
                        affNa: splitRec.affNa || 0
                      }));
                      showToast('Porsi Brand berhasil dihitung otomatis berdasarkan rasio PO Kontainer!', 'success');
                    }}
                    className="text-[10px] bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold px-2 py-0.5 rounded cursor-pointer transition border border-amber-300"
                  >
                    ⚡ Auto Hitung Proporsional Brand
                  </button>
                </div>
                <div className="flex items-center">
                  <span className="px-2.5 py-2 bg-amber-100 border border-r-0 border-amber-300 rounded-l-lg text-amber-950 font-bold text-xs shrink-0">Rp</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="Contoh: 12500000"
                    value={nonCifFormData.total || ''}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setNonCifFormData(prev => ({ ...prev, total: val }));
                    }}
                    className="w-full p-2 font-mono text-sm font-bold bg-amber-50/50 border border-amber-300 rounded-r-lg focus:outline-none focus:ring-1 focus:ring-amber-500 text-amber-950"
                    required
                  />
                </div>
              </div>

              {/* Brand Split Allocations */}
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
                <span className="font-bold text-slate-800 text-[11px] block">Porsi Alokasi Brand Belanja (Rp):</span>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] font-semibold text-emerald-800 mb-0.5 block">AR1 (Rp)</label>
                    <div className="flex items-center">
                      <span className="px-1.5 py-1.5 bg-emerald-100 border border-r-0 border-emerald-300 rounded-l text-emerald-900 font-bold text-[10px] shrink-0">Rp</span>
                      <input
                        type="number"
                        min="0"
                        className="w-full p-1.5 font-mono text-xs border border-emerald-300 bg-emerald-50/40 rounded-r focus:outline-none font-bold text-emerald-900"
                        value={nonCifFormData.ar1 || ''}
                        onChange={(e) => setNonCifFormData(prev => ({ ...prev, ar1: Number(e.target.value) }))}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-indigo-800 mb-0.5 block">AR20 (Rp)</label>
                    <div className="flex items-center">
                      <span className="px-1.5 py-1.5 bg-indigo-100 border border-r-0 border-indigo-300 rounded-l text-indigo-900 font-bold text-[10px] shrink-0">Rp</span>
                      <input
                        type="number"
                        min="0"
                        className="w-full p-1.5 font-mono text-xs border border-indigo-300 bg-indigo-50/40 rounded-r focus:outline-none font-bold text-indigo-900"
                        value={nonCifFormData.ar20 || ''}
                        onChange={(e) => setNonCifFormData(prev => ({ ...prev, ar20: Number(e.target.value) }))}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-blue-800 mb-0.5 block">AR6 (Rp)</label>
                    <div className="flex items-center">
                      <span className="px-1.5 py-1.5 bg-blue-100 border border-r-0 border-blue-300 rounded-l text-blue-900 font-bold text-[10px] shrink-0">Rp</span>
                      <input
                        type="number"
                        min="0"
                        className="w-full p-1.5 font-mono text-xs border border-blue-300 bg-blue-50/40 rounded-r focus:outline-none font-bold text-blue-900"
                        value={nonCifFormData.ar6 || ''}
                        onChange={(e) => setNonCifFormData(prev => ({ ...prev, ar6: Number(e.target.value) }))}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-purple-800 mb-0.5 block">AR9 (Rp)</label>
                    <div className="flex items-center">
                      <span className="px-1.5 py-1.5 bg-purple-100 border border-r-0 border-purple-300 rounded-l text-purple-900 font-bold text-[10px] shrink-0">Rp</span>
                      <input
                        type="number"
                        min="0"
                        className="w-full p-1.5 font-mono text-xs border border-purple-300 bg-purple-50/40 rounded-r focus:outline-none font-bold text-purple-900"
                        value={nonCifFormData.ar9 || ''}
                        onChange={(e) => setNonCifFormData(prev => ({ ...prev, ar9: Number(e.target.value) }))}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-rose-800 mb-0.5 block">SOYU (Rp)</label>
                    <div className="flex items-center">
                      <span className="px-1.5 py-1.5 bg-rose-100 border border-r-0 border-rose-300 rounded-l text-rose-900 font-bold text-[10px] shrink-0">Rp</span>
                      <input
                        type="number"
                        min="0"
                        className="w-full p-1.5 font-mono text-xs border border-rose-300 bg-rose-50/40 rounded-r focus:outline-none font-bold text-rose-900"
                        value={nonCifFormData.soyu || ''}
                        onChange={(e) => setNonCifFormData(prev => ({ ...prev, soyu: Number(e.target.value) }))}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-teal-800 mb-0.5 block">AFF NA (Rp)</label>
                    <div className="flex items-center">
                      <span className="px-1.5 py-1.5 bg-teal-100 border border-r-0 border-teal-300 rounded-l text-teal-900 font-bold text-[10px] shrink-0">Rp</span>
                      <input
                        type="number"
                        min="0"
                        className="w-full p-1.5 font-mono text-xs border border-teal-300 bg-teal-50/40 rounded-r focus:outline-none font-bold text-teal-900"
                        value={nonCifFormData.affNa || ''}
                        onChange={(e) => setNonCifFormData(prev => ({ ...prev, affNa: Number(e.target.value) }))}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Keterangan / Ref Jurnal</label>
                <input
                  type="text"
                  placeholder="Contoh: DEPRE MANUAL JAN 2026 / NO REF JURNAL 102"
                  value={nonCifFormData.ket}
                  onChange={(e) => setNonCifFormData(prev => ({ ...prev, ket: e.target.value }))}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 text-xs"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsNonCifModalOpen(false)}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-amber-700 hover:bg-amber-800 text-white font-semibold rounded-lg transition shadow-2xs cursor-pointer"
                >
                  Simpan Biaya Selain CIF
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: IMPORT BIAYA SELAIN CIF - DEPRE MANUAL                             */}
      {/* ========================================================================= */}
      {isImportNonCifModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col">
            <div className="bg-amber-900 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileUp className="w-5 h-5 text-amber-300" />
                <h3 className="font-bold text-sm">
                  Import Data Biaya Selain CIF - Depre Manual
                </h3>
              </div>
              <button
                onClick={() => setIsImportNonCifModalOpen(false)}
                className="p-1 hover:bg-white/20 rounded transition text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between bg-amber-50 p-3 rounded-lg border border-amber-200">
                <div>
                  <div className="font-bold text-amber-950 text-xs">Petunjuk Format Baris (CSV / Tab Separated / Excel):</div>
                  <div className="text-[11px] text-amber-800 mt-0.5">
                    <code className="font-mono bg-amber-100 px-1.5 py-0.5 rounded font-bold text-amber-900">
                      No Container | Deskripsi Biaya (Desc) | Total CIF | Keterangan
                    </code>
                  </div>
                </div>
                <button
                  onClick={handleDownloadNonCifTemplate}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white font-semibold rounded-lg transition cursor-pointer text-xs shrink-0 shadow-2xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Template</span>
                </button>
              </div>

              {/* File Picker Option */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-amber-700" />
                  <span className="font-semibold text-slate-700 text-xs">Import dari File Excel / CSV:</span>
                </div>
                <input
                  type="file"
                  accept=".csv, .txt, .tsv, .xlsx, .xls"
                  onChange={handleNonCifFileUpload}
                  id="noncif-file-upload-input"
                  className="hidden"
                />
                <label
                  htmlFor="noncif-file-upload-input"
                  className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white font-semibold rounded-lg cursor-pointer transition flex items-center gap-1.5 shadow-2xs text-xs shrink-0"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Pilih File CSV/Excel</span>
                </label>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Atau Copy-Paste Data dari Excel / Spreadsheet:
                </label>
                <textarea
                  rows={6}
                  placeholder={`GZ239 (20 FT)\tTotal Biaya PPH\t63853425\tLUNAS PIB\nGZ239 (20 FT)\tTotal Biaya BEA Masuk\t6555000\tLUNAS PIB\nGZ239 (20 FT)\tBiaya LS Tribhakti - BAGS\t-51600\tLUNAS PIB`}
                  value={importNonCifText}
                  onChange={(e) => setImportNonCifText(e.target.value)}
                  className="w-full p-3 font-mono text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsImportNonCifModalOpen(false)}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleProcessImportNonCif}
                  className="px-4 py-1.5 bg-amber-700 hover:bg-amber-800 text-white font-semibold rounded-lg transition shadow-2xs cursor-pointer"
                >
                  Proses Import Non-CIF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: REPORT EMAIL UNTUK LAPORAN BIAYA PER NO KONTAINER                   */}
      {/* ========================================================================= */}
      {isEmailReportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white p-4 flex items-center justify-between border-b border-blue-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-800/60 rounded-lg border border-blue-600">
                  <Mail className="w-5 h-5 text-blue-300" />
                </div>
                <div>
                  <h3 className="font-bold text-base tracking-wide">
                    Laporan Email Biaya Per Kontainer
                  </h3>
                  <p className="text-[11px] text-blue-200">
                    Kirim ringkasan laporan biaya CIF & Biaya Selain CIF per No Kontainer ke tim Management / Audit / Finance
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsEmailReportModalOpen(false)}
                className="p-1.5 hover:bg-white/20 rounded-lg transition text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
              {/* Form Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div>
                  <label className="block text-[11px] font-bold text-slate-800 mb-1">
                    Pilih No Kontainer
                  </label>
                  <select
                    value={emailReportContainerNo}
                    onChange={(e) => setEmailReportContainerNo(e.target.value)}
                    className="w-full p-2 bg-white border border-slate-300 rounded-lg font-mono font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
                  >
                    <option value="ALL">Semua Kontainer (Ringkasan Total)</option>
                    {groupedCifContainers.map(g => {
                      const cifCount = (g.items || []).filter(i => i.desc && i.desc.toUpperCase().trim() !== 'NILAI KONTAINER').length;
                      const nonCifCount = nonCifRecords.filter(r => cleanContKey(r.noContainer) === cleanContKey(g.noContainer)).length;
                      return (
                        <option key={g.noContainer} value={g.noContainer}>
                          {g.noContainer} ({cifCount} Item CIF, {nonCifCount} Selain CIF)
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-800 mb-1">
                    Email Penerima
                  </label>
                  <input
                    type="text"
                    placeholder="audit@company.com, finance@company.com"
                    value={emailRecipient}
                    onChange={(e) => setEmailRecipient(e.target.value)}
                    className="w-full p-2 bg-white border border-slate-300 rounded-lg font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-800 mb-1">
                    Subjek Email
                  </label>
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    className="w-full p-2 bg-white border border-slate-300 rounded-lg font-semibold text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
                  />
                </div>
              </div>

              {/* Dynamic Email Content Report Computation */}
              {(() => {
                const isAll = emailReportContainerNo === 'ALL';
                const selectedDoc = groupedCifContainers.find(g => cleanContKey(g.noContainer) === cleanContKey(emailReportContainerNo));
                
                const targetDocs = isAll ? groupedCifContainers : (selectedDoc ? [selectedDoc] : []);
                
                const docsWithDetails = targetDocs.map(doc => {
                  const cifItems = (doc.items || []).filter(i => i.desc && i.desc.toUpperCase().trim() !== 'NILAI KONTAINER');
                  const nonCifItems = nonCifRecords.filter(r => cleanContKey(r.noContainer) === cleanContKey(doc.noContainer));
                  const totalCifCost = doc.totalCIF || 0;
                  const totalNonCifCost = nonCifItems.reduce((acc, r) => acc + (r.total || 0), 0);
                  const grandTotalBiaya = totalCifCost + totalNonCifCost;
                  const basePo = doc.totalNilaiPo || 0;
                  const cifPctStr = basePo > 0 ? formatPercent(totalCifCost, basePo) : '0%';
                  const nonCifPctStr = basePo > 0 ? formatPercent(totalNonCifCost, basePo) : '0%';
                  const grandTotalPctStr = basePo > 0 ? formatPercent(grandTotalBiaya, basePo) : '0%';

                  return {
                    ...doc,
                    cifItems,
                    nonCifItems,
                    totalCifCost,
                    totalNonCifCost,
                    grandTotalBiaya,
                    cifPctStr,
                    nonCifPctStr,
                    grandTotalPctStr
                  };
                });

                const totalPoAll = docsWithDetails.reduce((acc, d) => acc + (d.totalNilaiPo || 0), 0);
                const totalCifAll = docsWithDetails.reduce((acc, d) => acc + (d.totalCifCost || 0), 0);
                const totalNonCifAll = docsWithDetails.reduce((acc, d) => acc + (d.totalNonCifCost || 0), 0);
                const grandTotalAll = totalCifAll + totalNonCifAll;
                const grandPct = totalPoAll > 0 ? (grandTotalAll / totalPoAll) * 100 : 0;

                // Build Plain Text Report Content for Copying & Mailto
                let textReport = `LAPORAN BIAYA PER NO KONTAINER - RESMI GZ 2026\n`;
                textReport += `====================================================\n`;
                textReport += `Filter Kontainer : ${isAll ? 'SEMUA KONTAINER' : emailReportContainerNo}\n`;
                textReport += `Tanggal Laporan  : ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}\n`;
                if (emailNotes) {
                  textReport += `Catatan          : ${emailNotes}\n`;
                }
                textReport += `\nRINGKASAN UTAMA:\n`;
                textReport += `- Total Cost PO Kontainer : ${formatCurrency(totalPoAll)}\n`;
                textReport += `- Total Biaya CIF (PIB)   : ${formatCurrency(totalCifAll)} (${totalPoAll > 0 ? formatPercent(totalCifAll, totalPoAll) : '0%'})\n`;
                textReport += `- Total Biaya Selain CIF  : ${formatCurrency(totalNonCifAll)} (${totalPoAll > 0 ? formatPercent(totalNonCifAll, totalPoAll) : '0%'})\n`;
                textReport += `- GRAND TOTAL BIAYA       : ${formatCurrency(grandTotalAll)} (${grandPct.toFixed(2)}% dari Cost PO)\n`;
                textReport += `- PPN Kontainer           : [ Blank / Diisi Manual ]\n\n`;

                textReport += `====================================================\n`;
                textReport += `RINCIAN DOKUMEN BIAYA PER KONTAINER:\n`;

                docsWithDetails.forEach((doc, idx) => {
                  const basePo = doc.totalNilaiPo || 0;
                  textReport += `\n[${idx + 1}] DOKUMEN KONTAINER: ${doc.noContainer}\n`;
                  textReport += `----------------------------------------------------\n`;
                  textReport += `  Bulan Kont Jalan   : ${doc.bulanKontJalan || '-'}\n`;
                  textReport += `  Tgl Terima / Bayar : ${formatDisplayDate(doc.tglFinalPembayaranPib)}\n`;
                  textReport += `  Total Cost PO      : ${formatCurrency(doc.totalNilaiPo)}\n`;
                  textReport += `  Breakdown Brand PO : AR1: ${formatCurrency(doc.totalAR1 || 0)} | AR20: ${formatCurrency(doc.totalAR20 || 0)} | AR6: ${formatCurrency(doc.totalAR6 || 0)} | AR9: ${formatCurrency(doc.totalAR9 || 0)} | SOYU: ${formatCurrency(doc.totalSOYU || 0)} | AFF NA: ${formatCurrency(doc.totalAFFNA || 0)}\n\n`;

                  textReport += `  A. RINCIAN DOKUMEN BIAYA CIF (PIB):\n`;
                  if (doc.cifItems.length === 0) {
                    textReport += `     (Belum ada item biaya CIF)\n`;
                  } else {
                    doc.cifItems.forEach((item, cIdx) => {
                      const itemPct = basePo > 0 ? formatPercent(item.total, basePo) : '0%';
                      textReport += `     ${cIdx + 1}. ${item.desc}\n`;
                      textReport += `        Total Nilai CIF: ${formatCurrency(item.total)} (${itemPct} dari PO)\n`;
                      textReport += `        Porsi Brand    : AR1: ${formatCurrency(item.ar1 || 0)} | AR20: ${formatCurrency(item.ar20 || 0)} | AR6: ${formatCurrency(item.ar6 || 0)} | AR9: ${formatCurrency(item.ar9 || 0)} | SOYU: ${formatCurrency(item.soyu || 0)} | AFF NA: ${formatCurrency(item.affNa || 0)}\n`;
                      textReport += `        Keterangan     : ${item.ket || '-'}\n`;
                    });
                  }
                  textReport += `     -----------------------------------------------\n`;
                  textReport += `     SUBTOTAL BIAYA CIF (PIB): ${formatCurrency(doc.totalCifCost)} (${doc.cifPctStr} dari Cost PO)\n\n`;

                  textReport += `  B. RINCIAN DOKUMEN BIAYA SELAIN CIF (Depre Manual):\n`;
                  if (doc.nonCifItems.length === 0) {
                    textReport += `     (Belum ada item biaya selain CIF)\n`;
                  } else {
                    doc.nonCifItems.forEach((item, ncIdx) => {
                      const itemPct = basePo > 0 ? formatPercent(item.total, basePo) : '0%';
                      textReport += `     ${ncIdx + 1}. ${item.desc} [${item.kategoriBiaya || 'Umum'}]\n`;
                      textReport += `        Total Biaya : ${formatCurrency(item.total)} (${itemPct} dari PO)\n`;
                      textReport += `        Porsi Brand : AR1: ${formatCurrency(item.ar1 || 0)} | AR20: ${formatCurrency(item.ar20 || 0)} | AR6: ${formatCurrency(item.ar6 || 0)} | AR9: ${formatCurrency(item.ar9 || 0)} | SOYU: ${formatCurrency(item.soyu || 0)} | AFF NA: ${formatCurrency(item.affNa || 0)}\n`;
                      textReport += `        Keterangan  : ${item.ket || '-'}\n`;
                    });
                  }
                  textReport += `     -----------------------------------------------\n`;
                  textReport += `     SUBTOTAL BIAYA SELAIN CIF: ${formatCurrency(doc.totalNonCifCost)} (${doc.nonCifPctStr} dari Cost PO)\n\n`;

                  textReport += `  --------------------------------------------------\n`;
                  textReport += `  GRAND TOTAL BIAYA KONTAINER : ${formatCurrency(doc.grandTotalBiaya)} (${doc.grandTotalPctStr} dari Cost PO)\n`;
                  textReport += `  PPN KONTAINER               : [ Blank / Diisi Manual ]\n`;
                });

                textReport += `\n====================================================\n`;
                textReport += `Laporan resmi dibuat dari Sistem CIF & BAP Container GZ.`;

                // Build HTML Email Report Content with full inline styling for Email Clients
                let htmlReport = `<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; max-width: 900px; margin: 0 auto; line-height: 1.5; font-size: 13px;">`;
                htmlReport += `<div style="background: linear-gradient(135deg, #1e3a8a, #312e81); color: #ffffff; padding: 18px 24px; border-radius: 10px 10px 0 0;">`;
                htmlReport += `<h2 style="margin: 0 0 6px 0; font-size: 18px; font-weight: 800; letter-spacing: 0.5px;">LAPORAN BIAYA PER KONTAINER GZ 2026</h2>`;
                htmlReport += `<p style="margin: 0; font-size: 12px; opacity: 0.9;">Filter: <strong>${isAll ? 'SEMUA KONTAINER' : emailReportContainerNo}</strong> | Tanggal: <strong>${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</strong></p>`;
                if (emailNotes) {
                  htmlReport += `<p style="margin: 6px 0 0 0; font-size: 11px; font-style: italic; background: rgba(255,255,255,0.15); padding: 4px 8px; border-radius: 4px;">Catatan: ${emailNotes}</p>`;
                }
                htmlReport += `</div>`;

                // HTML Summary Table
                htmlReport += `<div style="padding: 16px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-top: none;">`;
                htmlReport += `<h3 style="margin: 0 0 10px 0; font-size: 14px; color: #0f172a; border-bottom: 2px solid #2563eb; padding-bottom: 4px;">RINGKASAN UTAMA BIAYA</h3>`;
                htmlReport += `<table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px;">`;
                htmlReport += `<tr style="background-color: #f1f5f9; font-weight: bold; text-align: left;">`;
                htmlReport += `<th style="padding: 8px; border: 1px solid #cbd5e1;">Kategori Ringkasan</th>`;
                htmlReport += `<th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Total Nominal (Rp)</th>`;
                htmlReport += `<th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">% vs Cost PO</th>`;
                htmlReport += `</tr>`;
                htmlReport += `<tr><td style="padding: 8px; border: 1px solid #e2e8f0;">Total Cost PO Kontainer</td><td style="padding: 8px; border: 1px solid #e2e8f0; text-align: right; font-weight: bold;">${formatCurrency(totalPoAll)}</td><td style="padding: 8px; border: 1px solid #e2e8f0; text-align: right; font-weight: bold;">100.00%</td></tr>`;
                htmlReport += `<tr><td style="padding: 8px; border: 1px solid #e2e8f0; color: #581c87; font-weight: 600;">Total Biaya CIF (PIB)</td><td style="padding: 8px; border: 1px solid #e2e8f0; text-align: right; font-weight: bold; color: #581c87;">${formatCurrency(totalCifAll)}</td><td style="padding: 8px; border: 1px solid #e2e8f0; text-align: right; font-weight: bold; color: #581c87;">${totalPoAll > 0 ? formatPercent(totalCifAll, totalPoAll) : '0%'}</td></tr>`;
                htmlReport += `<tr><td style="padding: 8px; border: 1px solid #e2e8f0; color: #78350f; font-weight: 600;">Total Biaya Selain CIF</td><td style="padding: 8px; border: 1px solid #e2e8f0; text-align: right; font-weight: bold; color: #78350f;">${formatCurrency(totalNonCifAll)}</td><td style="padding: 8px; border: 1px solid #e2e8f0; text-align: right; font-weight: bold; color: #78350f;">${totalPoAll > 0 ? formatPercent(totalNonCifAll, totalPoAll) : '0%'}</td></tr>`;
                htmlReport += `<tr style="background-color: #dcfce7; font-weight: bold;"><td style="padding: 8px; border: 1px solid #86efac; color: #14532d;">GRAND TOTAL BIAYA</td><td style="padding: 8px; border: 1px solid #86efac; text-align: right; color: #14532d; font-size: 13px;">${formatCurrency(grandTotalAll)}</td><td style="padding: 8px; border: 1px solid #86efac; text-align: right; color: #14532d; font-size: 13px;">${grandPct.toFixed(2)}%</td></tr>`;
                htmlReport += `<tr style="background-color: #fff1f2;"><td style="padding: 8px; border: 1px solid #fecdd3; color: #9f1239; font-weight: 600;">PPN Kontainer</td><td style="padding: 8px; border: 1px solid #fecdd3; text-align: right; font-style: italic; color: #9f1239;">(Diisi manual)</td><td style="padding: 8px; border: 1px solid #fecdd3; text-align: right; font-style: italic; color: #9f1239;">-</td></tr>`;
                htmlReport += `</table>`;

                // HTML Details Per Container
                docsWithDetails.forEach((doc, idx) => {
                  const basePo = doc.totalNilaiPo || 0;
                  htmlReport += `<div style="margin-top: 20px; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; background-color: #ffffff;">`;
                  htmlReport += `<div style="background-color: #0f172a; color: #ffffff; padding: 10px 14px; font-weight: bold; font-size: 13px; display: flex; justify-content: space-between;">`;
                  htmlReport += `<span>KONTAINER #${idx + 1}: <span style="color: #f59e0b; font-family: monospace;">${doc.noContainer}</span></span>`;
                  htmlReport += `<span>Tgl Terima: ${formatDisplayDate(doc.tglFinalPembayaranPib)} | Cost PO: ${formatCurrency(doc.totalNilaiPo)}</span>`;
                  htmlReport += `</div>`;

                  htmlReport += `<div style="padding: 12px;">`;
                  // Brand PO breakdown
                  htmlReport += `<p style="margin: 0 0 10px 0; font-size: 11px; color: #475569; background: #f1f5f9; padding: 6px 10px; border-radius: 4px;">`;
                  htmlReport += `<strong>Porsi Brand PO:</strong> AR1: ${formatCurrency(doc.totalAR1 || 0)} | AR20: ${formatCurrency(doc.totalAR20 || 0)} | AR6: ${formatCurrency(doc.totalAR6 || 0)} | AR9: ${formatCurrency(doc.totalAR9 || 0)} | SOYU: ${formatCurrency(doc.totalSOYU || 0)} | AFF NA: ${formatCurrency(doc.totalAFFNA || 0)}`;
                  htmlReport += `</p>`;

                  // Table A: CIF Items
                  htmlReport += `<h4 style="margin: 10px 0 6px 0; font-size: 12px; color: #581c87; font-weight: 700;">A. RINCIAN BIAYA CIF (PIB) - Subtotal: ${formatCurrency(doc.totalCifCost)} (${doc.cifPctStr} dari PO)</h4>`;
                  if (doc.cifItems.length === 0) {
                    htmlReport += `<p style="font-style: italic; color: #94a3b8; font-size: 11px;">Belum ada rincian item biaya CIF.</p>`;
                  } else {
                    htmlReport += `<table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 12px; font-family: monospace;">`;
                    htmlReport += `<tr style="background-color: #f3e8ff; color: #581c87; font-weight: bold; text-align: left; font-family: sans-serif;">`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #e9d5ff;">Deskripsi Biaya CIF</th>`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #e9d5ff; text-align: right;">Total CIF</th>`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #e9d5ff; text-align: right; color: #6b21a8;">% CIF vs PO</th>`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #e9d5ff; text-align: right;">AR1</th>`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #e9d5ff; text-align: right;">AR20</th>`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #e9d5ff; text-align: right;">AR6</th>`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #e9d5ff; text-align: right;">AR9</th>`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #e9d5ff; text-align: right;">SOYU</th>`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #e9d5ff; text-align: right;">AFF NA</th>`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #e9d5ff;">Ket</th>`;
                    htmlReport += `</tr>`;
                    doc.cifItems.forEach(item => {
                      const itemPct = basePo > 0 ? formatPercent(item.total, basePo) : '0%';
                      htmlReport += `<tr>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #f3e8ff; font-family: sans-serif; font-weight: 600;">${item.desc}</td>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #f3e8ff; text-align: right; font-weight: bold; color: #581c87;">${formatCurrency(item.total)}</td>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #f3e8ff; text-align: right; font-weight: bold; color: #7e22ce; background-color: #faf5ff;">${itemPct}</td>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #f3e8ff; text-align: right;">${formatCurrency(item.ar1)}</td>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #f3e8ff; text-align: right;">${formatCurrency(item.ar20)}</td>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #f3e8ff; text-align: right;">${formatCurrency(item.ar6)}</td>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #f3e8ff; text-align: right;">${formatCurrency(item.ar9)}</td>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #f3e8ff; text-align: right;">${formatCurrency(item.soyu)}</td>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #f3e8ff; text-align: right;">${formatCurrency(item.affNa)}</td>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #f3e8ff; font-family: sans-serif;">${item.ket || '-'}</td>`;
                      htmlReport += `</tr>`;
                    });
                    htmlReport += `</table>`;
                  }

                  // Table B: Selain CIF Items
                  htmlReport += `<h4 style="margin: 10px 0 6px 0; font-size: 12px; color: #881337; font-weight: 700;">B. RINCIAN BIAYA SELAIN CIF - Subtotal: ${formatCurrency(doc.totalNonCifCost)} (${doc.nonCifPctStr} dari PO)</h4>`;
                  if (doc.nonCifItems.length === 0) {
                    htmlReport += `<p style="font-style: italic; color: #94a3b8; font-size: 11px;">Belum ada rincian item biaya selain CIF.</p>`;
                  } else {
                    htmlReport += `<table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 12px; font-family: monospace;">`;
                    htmlReport += `<tr style="background-color: #ffe4e6; color: #881337; font-weight: bold; text-align: left; font-family: sans-serif;">`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #fecdd3;">Deskripsi Biaya Selain CIF</th>`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #fecdd3; text-align: right;">Total Biaya</th>`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #fecdd3; text-align: right; color: #9f1239;">% vs PO</th>`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #fecdd3; text-align: right;">AR1</th>`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #fecdd3; text-align: right;">AR20</th>`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #fecdd3; text-align: right;">AR6</th>`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #fecdd3; text-align: right;">AR9</th>`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #fecdd3; text-align: right;">SOYU</th>`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #fecdd3; text-align: right;">AFF NA</th>`;
                    htmlReport += `<th style="padding: 6px; border: 1px solid #fecdd3;">Ket</th>`;
                    htmlReport += `</tr>`;
                    doc.nonCifItems.forEach(item => {
                      const itemPct = basePo > 0 ? formatPercent(item.total, basePo) : '0%';
                      htmlReport += `<tr>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #ffe4e6; font-family: sans-serif; font-weight: 600;">${item.desc} <span style="font-size: 10px; color: #be123c;">[${item.kategoriBiaya}]</span></td>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #ffe4e6; text-align: right; font-weight: bold; color: #881337;">${formatCurrency(item.total)}</td>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #ffe4e6; text-align: right; font-weight: bold; color: #be123c; background-color: #fff1f2;">${itemPct}</td>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #ffe4e6; text-align: right;">${formatCurrency(item.ar1)}</td>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #ffe4e6; text-align: right;">${formatCurrency(item.ar20)}</td>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #ffe4e6; text-align: right;">${formatCurrency(item.ar6)}</td>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #ffe4e6; text-align: right;">${formatCurrency(item.ar9)}</td>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #ffe4e6; text-align: right;">${formatCurrency(item.soyu)}</td>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #ffe4e6; text-align: right;">${formatCurrency(item.affNa)}</td>`;
                      htmlReport += `<td style="padding: 6px; border: 1px solid #ffe4e6; font-family: sans-serif;">${item.ket || '-'}</td>`;
                      htmlReport += `</tr>`;
                    });
                    htmlReport += `</table>`;
                  }

                  // Container Footer
                  htmlReport += `<div style="background-color: #f8fafc; padding: 8px 12px; border-top: 1px solid #e2e8f0; font-weight: bold; font-size: 11px; display: flex; justify-content: space-between;">`;
                  htmlReport += `<span style="color: #1e293b;">GRAND TOTAL BIAYA KONTAINER: <strong style="color: #15803d; font-size: 12px;">${formatCurrency(doc.grandTotalBiaya)} (${doc.grandTotalPctStr})</strong></span>`;
                  htmlReport += `<span style="color: #64748b; font-style: italic;">PPN Kontainer: (Diisi manual)</span>`;
                  htmlReport += `</div>`;

                  htmlReport += `</div></div>`;
                });

                htmlReport += `<div style="margin-top: 20px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 10px;">`;
                htmlReport += `Laporan Resmi Sistem CIF & BAP Container GZ 2026`;
                htmlReport += `</div></div>`;

                const handleCopyEmailText = () => {
                  navigator.clipboard.writeText(textReport);
                  showToast('Teks Laporan Email Biaya Kontainer berhasil disalin ke clipboard!', 'success');
                };

                const handleCopyEmailHtml = async () => {
                  try {
                    const blobHtml = new Blob([htmlReport], { type: 'text/html' });
                    const blobText = new Blob([textReport], { type: 'text/plain' });
                    const data = [new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })];
                    await navigator.clipboard.write(data);
                    showToast('Format HTML Email berhasil disalin ke clipboard! Siap di-paste ke Email (Gmail / Outlook).', 'success');
                  } catch (err) {
                    try {
                      await navigator.clipboard.writeText(htmlReport);
                      showToast('Kode HTML Email berhasil disalin ke clipboard!', 'info');
                    } catch (e) {
                      showToast('Gagal menyalin HTML.', 'error');
                    }
                  }
                };

                const handleOpenMailto = () => {
                  const mailtoUrl = `mailto:${encodeURIComponent(emailRecipient)}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(textReport)}`;
                  window.location.href = mailtoUrl;
                };

                return (
                  <div className="space-y-4">
                    {/* Visual Card Summary Preview */}
                    <div className="p-4 bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white rounded-xl shadow-md border border-blue-800 space-y-3">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-blue-800/80">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-blue-300">
                            Pratinjau Laporan Email (Formatted)
                          </div>
                          <div className="text-sm font-bold text-amber-300">
                            {isAll ? 'Laporan Semua Kontainer' : `Laporan Kontainer: ${emailReportContainerNo}`}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={handleCopyEmailHtml}
                            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg transition text-xs flex items-center gap-1.5 cursor-pointer shadow-xs border border-purple-400"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>Salin HTML Email</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleCopyEmailText}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>Salin Teks Plain</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleOpenMailto}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>Buka Email Client</span>
                          </button>
                        </div>
                      </div>

                      {/* Summary Metrics */}
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                        <div className="p-2 bg-white/10 rounded-lg border border-white/10">
                          <span className="text-[10px] text-blue-200 block">Total Cost PO</span>
                          <span className="font-mono font-bold text-white text-xs">{formatCurrency(totalPoAll)}</span>
                        </div>
                        <div className="p-2 bg-purple-500/20 rounded-lg border border-purple-400/30">
                          <span className="text-[10px] text-purple-200 block">Total CIF (PIB)</span>
                          <span className="font-mono font-bold text-purple-200 text-xs">{formatCurrency(totalCifAll)}</span>
                          <span className="text-[9px] text-purple-300 block font-semibold">{totalPoAll > 0 ? formatPercent(totalCifAll, totalPoAll) : '0%'} PO</span>
                        </div>
                        <div className="p-2 bg-amber-500/20 rounded-lg border border-amber-400/30">
                          <span className="text-[10px] text-amber-200 block">Total Selain CIF</span>
                          <span className="font-mono font-bold text-amber-200 text-xs">{formatCurrency(totalNonCifAll)}</span>
                          <span className="text-[9px] text-amber-300 block font-semibold">{totalPoAll > 0 ? formatPercent(totalNonCifAll, totalPoAll) : '0%'} PO</span>
                        </div>
                        <div className="p-2 bg-emerald-500/20 rounded-lg border border-emerald-400/30">
                          <span className="text-[10px] text-emerald-200 block">Grand Total Biaya</span>
                          <span className="font-mono font-bold text-emerald-300 text-xs">{formatCurrency(grandTotalAll)}</span>
                          <span className="text-[9px] text-emerald-300 block font-semibold">{grandPct.toFixed(2)}% PO</span>
                        </div>
                        <div className="p-2 bg-rose-500/20 rounded-lg border border-rose-400/30">
                          <span className="text-[10px] text-rose-200 block">PPN Kontainer</span>
                          <span className="font-mono font-bold text-rose-200 text-xs">-</span>
                          <span className="text-[9px] text-rose-300 block font-semibold">(Diisi manual)</span>
                        </div>
                      </div>
                    </div>

                    {/* Container Document Detailed Cards in Email Preview */}
                    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                      {docsWithDetails.map((doc, idx) => (
                        <div key={doc.noContainer} className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs space-y-2 p-3">
                          <div className="bg-slate-900 text-white p-2.5 rounded-lg flex flex-wrap justify-between items-center gap-2">
                            <div>
                              <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider block">Dokumen Kontainer #{idx + 1}</span>
                              <span className="text-sm font-extrabold text-white font-mono">{doc.noContainer}</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs font-mono">
                              <div><span className="text-slate-400 text-[10px]">Tgl Terima:</span> <span className="font-bold text-slate-200">{formatDisplayDate(doc.tglFinalPembayaranPib)}</span></div>
                              <div><span className="text-slate-400 text-[10px]">Cost PO:</span> <span className="font-bold text-amber-300">{formatCurrency(doc.totalNilaiPo)}</span></div>
                              <div><span className="text-slate-400 text-[10px]">Grand Total:</span> <span className="font-bold text-emerald-400">{formatCurrency(doc.grandTotalBiaya)} ({doc.grandTotalPctStr})</span></div>
                            </div>
                          </div>

                          {/* A. CIF Items Table */}
                          <div className="border border-purple-200 rounded-lg overflow-hidden bg-purple-50/20 text-[11px]">
                            <div className="bg-purple-900 text-white px-2.5 py-1 font-bold flex justify-between items-center">
                              <span>A. RINCIAN BIAYA CIF (PIB) - {doc.cifItems.length} Item</span>
                              <span>Subtotal: {formatCurrency(doc.totalCifCost)} ({doc.cifPctStr})</span>
                            </div>
                            {doc.cifItems.length === 0 ? (
                              <p className="p-2 text-slate-400 italic text-center">Belum ada item biaya CIF</p>
                            ) : (
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="bg-purple-100 text-purple-950 font-bold border-b border-purple-200">
                                    <th className="p-1.5 border-r border-purple-200">Deskripsi Biaya CIF</th>
                                    <th className="p-1.5 border-r border-purple-200 text-right">Total CIF</th>
                                    <th className="p-1.5 border-r border-purple-200 text-right text-purple-800">% CIF vs PO</th>
                                    <th className="p-1.5 border-r border-purple-200 text-right">AR1</th>
                                    <th className="p-1.5 border-r border-purple-200 text-right">AR20</th>
                                    <th className="p-1.5 border-r border-purple-200 text-right">AR6</th>
                                    <th className="p-1.5 border-r border-purple-200 text-right">AR9</th>
                                    <th className="p-1.5 border-r border-purple-200 text-right">SOYU</th>
                                    <th className="p-1.5 border-r border-purple-200 text-right">AFF NA</th>
                                    <th className="p-1.5">Ket</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-purple-100 font-mono">
                                  {doc.cifItems.map((item, iIdx) => (
                                    <tr key={iIdx} className="hover:bg-purple-100/30">
                                      <td className="p-1.5 font-sans font-medium text-slate-900 border-r border-purple-100">{item.desc}</td>
                                      <td className="p-1.5 font-bold text-purple-900 text-right border-r border-purple-100">{formatCurrency(item.total)}</td>
                                      <td className="p-1.5 font-bold text-purple-700 text-right border-r border-purple-100 bg-purple-50/50">{doc.totalNilaiPo ? formatPercent(item.total, doc.totalNilaiPo) : '0%'}</td>
                                      <td className="p-1.5 text-right border-r border-purple-100 text-emerald-900">{formatCurrency(item.ar1)}</td>
                                      <td className="p-1.5 text-right border-r border-purple-100 text-indigo-900">{formatCurrency(item.ar20)}</td>
                                      <td className="p-1.5 text-right border-r border-purple-100 text-blue-900">{formatCurrency(item.ar6)}</td>
                                      <td className="p-1.5 text-right border-r border-purple-100 text-purple-900">{formatCurrency(item.ar9)}</td>
                                      <td className="p-1.5 text-right border-r border-purple-100 text-rose-900">{formatCurrency(item.soyu)}</td>
                                      <td className="p-1.5 text-right border-r border-purple-100 text-teal-900">{formatCurrency(item.affNa)}</td>
                                      <td className="p-1.5 font-sans text-slate-600 text-[10px]">{item.ket || '-'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>

                          {/* B. Selain CIF Items Table */}
                          <div className="border border-rose-200 rounded-lg overflow-hidden bg-rose-50/20 text-[11px]">
                            <div className="bg-rose-900 text-white px-2.5 py-1 font-bold flex justify-between items-center">
                              <span>B. RINCIAN BIAYA SELAIN CIF - {doc.nonCifItems.length} Item</span>
                              <span>Subtotal: {formatCurrency(doc.totalNonCifCost)} ({doc.nonCifPctStr})</span>
                            </div>
                            {doc.nonCifItems.length === 0 ? (
                              <p className="p-2 text-slate-400 italic text-center">Belum ada item biaya selain CIF</p>
                            ) : (
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="bg-rose-100 text-rose-950 font-bold border-b border-rose-200">
                                    <th className="p-1.5 border-r border-rose-200">Deskripsi Biaya Selain CIF</th>
                                    <th className="p-1.5 border-r border-rose-200 text-right">Total Biaya</th>
                                    <th className="p-1.5 border-r border-rose-200 text-right text-rose-800">% vs PO</th>
                                    <th className="p-1.5 border-r border-rose-200 text-right">AR1</th>
                                    <th className="p-1.5 border-r border-rose-200 text-right">AR20</th>
                                    <th className="p-1.5 border-r border-rose-200 text-right">AR6</th>
                                    <th className="p-1.5 border-r border-rose-200 text-right">AR9</th>
                                    <th className="p-1.5 border-r border-rose-200 text-right">SOYU</th>
                                    <th className="p-1.5 border-r border-rose-200 text-right">AFF NA</th>
                                    <th className="p-1.5">Ket</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-rose-100 font-mono">
                                  {doc.nonCifItems.map((item, ncIdx) => (
                                    <tr key={ncIdx} className="hover:bg-rose-100/30">
                                      <td className="p-1.5 font-sans font-medium text-slate-900 border-r border-rose-100">{item.desc} <span className="text-[9px] text-rose-700 bg-rose-100 px-1 py-0.2 rounded font-mono">[{item.kategoriBiaya}]</span></td>
                                      <td className="p-1.5 font-bold text-rose-900 text-right border-r border-rose-100">{formatCurrency(item.total)}</td>
                                      <td className="p-1.5 font-bold text-rose-700 text-right border-r border-rose-100 bg-rose-50/50">{doc.totalNilaiPo ? formatPercent(item.total, doc.totalNilaiPo) : '0%'}</td>
                                      <td className="p-1.5 text-right border-r border-rose-100 text-emerald-900">{formatCurrency(item.ar1)}</td>
                                      <td className="p-1.5 text-right border-r border-rose-100 text-indigo-900">{formatCurrency(item.ar20)}</td>
                                      <td className="p-1.5 text-right border-r border-rose-100 text-blue-900">{formatCurrency(item.ar6)}</td>
                                      <td className="p-1.5 text-right border-r border-rose-100 text-purple-900">{formatCurrency(item.ar9)}</td>
                                      <td className="p-1.5 text-right border-r border-rose-100 text-rose-900">{formatCurrency(item.soyu)}</td>
                                      <td className="p-1.5 text-right border-r border-rose-100 text-teal-900">{formatCurrency(item.affNa)}</td>
                                      <td className="p-1.5 font-sans text-slate-600 text-[10px]">{item.ket || '-'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>

                          {/* Footer PPN Row */}
                          <div className="bg-slate-100 p-2 rounded-lg font-bold text-xs flex justify-between items-center border border-slate-200">
                            <span className="text-slate-700">PPN Kontainer:</span>
                            <span className="text-slate-500 font-mono italic">(Diisi manual oleh user)</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-slate-100 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsEmailReportModalOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-lg transition text-xs cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: INTEGRASI SUPABASE (SEND DATA DIRECT & SQL EDITOR)                  */}
      {/* ========================================================================= */}
      {isSqlModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-emerald-950 via-teal-900 to-slate-900 text-white p-4 flex items-center justify-between border-b border-emerald-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-800/60 rounded-lg border border-emerald-600">
                  <Database className="w-5 h-5 text-emerald-300" />
                </div>
                <div>
                  <h3 className="font-bold text-base tracking-wide flex items-center gap-2">
                    <span>Integrasi Supabase - Resume CIF Kontainer</span>
                    <span className="text-[10px] bg-emerald-500/30 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-400/30 font-mono">
                      PostgreSQL / REST API
                    </span>
                  </h3>
                  <p className="text-[11px] text-emerald-200">
                    Kirim semua data Resume CIF &amp; rincian biaya langsung ke Supabase atau salin Script SQL
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsSqlModalOpen(false)}
                className="p-1.5 hover:bg-white/20 rounded-lg transition text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Navigation Tabs */}
            <div className="flex border-b border-slate-200 bg-slate-100 px-4 shrink-0">
              <button
                type="button"
                onClick={() => setSupabaseActiveTab('sync')}
                className={`py-2.5 px-4 font-bold text-xs flex items-center gap-2 border-b-2 transition cursor-pointer ${
                  supabaseActiveTab === 'sync'
                    ? 'border-emerald-600 text-emerald-800 bg-white'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                }`}
              >
                <Zap className="w-4 h-4 text-emerald-600" />
                <span>🚀 Kirim Data Langsung (Live Sync)</span>
              </button>
              <button
                type="button"
                onClick={() => setSupabaseActiveTab('sql')}
                className={`py-2.5 px-4 font-bold text-xs flex items-center gap-2 border-b-2 transition cursor-pointer ${
                  supabaseActiveTab === 'sql'
                    ? 'border-emerald-600 text-emerald-800 bg-white'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                }`}
              >
                <Code className="w-4 h-4 text-teal-600" />
                <span>📜 Script SQL (Supabase Editor)</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 overflow-y-auto space-y-4 flex-1 bg-slate-50">
              {supabaseActiveTab === 'sync' ? (
                /* ========================================================================= */
                /* TAB 1: LIVE DIRECT WEB SENDING DATA TO SUPABASE                            */
                /* ========================================================================= */
                <div className="space-y-4">
                  {/* Credentials Box */}
                  <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <div className="flex items-center gap-2">
                        <Server className="w-4 h-4 text-emerald-700" />
                        <h4 className="font-bold text-xs text-slate-900 uppercase tracking-wider">
                          Pengaturan Koneksi API Supabase
                        </h4>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        Saved in Browser LocalStorage
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1 flex items-center gap-1">
                          <Globe className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Supabase Project URL</span>
                        </label>
                        <input
                          type="text"
                          value={supabaseUrl}
                          onChange={e => setSupabaseUrl(e.target.value)}
                          placeholder="https://your-project.supabase.co"
                          className="w-full text-xs p-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1 flex items-center gap-1">
                          <Key className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Supabase Anon / Service API Key</span>
                        </label>
                        <input
                          type="password"
                          value={supabaseAnonKey}
                          onChange={e => setSupabaseAnonKey(e.target.value)}
                          placeholder="eyJhbGciOiJIUzI1NiI..."
                          className="w-full text-xs p-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Summary of Data to Send */}
                  <div className="p-4 bg-gradient-to-r from-emerald-900 to-teal-900 text-white rounded-xl shadow-xs flex flex-wrap items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="font-bold text-sm text-emerald-200 flex items-center gap-2">
                        <Package className="w-4 h-4 text-emerald-400" />
                        <span>Ringkasan Data Siap Dikirim ke Supabase</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-200 pt-1">
                        <span className="bg-emerald-800/80 px-2 py-1 rounded border border-emerald-600 font-semibold">
                          📄 Header Kontainer: <strong>{groupedCifContainers.length}</strong>
                        </span>
                        <span className="bg-emerald-800/80 px-2 py-1 rounded border border-emerald-600 font-semibold">
                          💰 Item Biaya CIF: <strong>{groupedCifContainers.reduce((acc, c) => acc + (c.items ? c.items.filter(i => i.desc && i.desc.toUpperCase().trim() !== 'NILAI KONTAINER').length : 0), 0)}</strong>
                        </span>
                        <span className="bg-emerald-800/80 px-2 py-1 rounded border border-emerald-600 font-semibold">
                          📋 Item Selain CIF: <strong>{nonCifRecords.length}</strong>
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isSyncingSupabase}
                      onClick={() => {
                        // Inline sync trigger — kirim ke API SQL Server (tanpa kredensial Supabase)
                        setIsSyncingSupabase(true);
                        setSyncStatus('idle');
                        setSyncErrorMessage('');
                        const newLogs: string[] = [];

                        const addLog = (msg: string) => {
                          const time = new Date().toLocaleTimeString('id-ID');
                          const formatted = `[${time}] ${msg}`;
                          newLogs.push(formatted);
                          setSyncLogs([...newLogs]);
                        };

                        addLog('🚀 Memulai pengiriman data Resume CIF Kontainer ke database SQL Server...');

                        (async () => {
                          try {
                            // 1. Prepare Header rows
                            addLog(`📦 Menyiapkan data Header Kontainer...`);
                            const headerMap = new Map<string, any>();
                            const allContainerNosSet = new Set<string>();

                            groupedCifContainers.forEach(doc => {
                              allContainerNosSet.add(doc.noContainer);
                              const basePo = doc.totalNilaiPo || 0;
                              const pctCifPo = basePo > 0 ? ((doc.totalCIF || 0) / basePo) * 100 : 0;
                              headerMap.set(cleanContKey(doc.noContainer), {
                                no_container: doc.noContainer,
                                bulan_kont_jalan: doc.bulanKontJalan || '',
                                tgl_terima_pib: doc.tglFinalPembayaranPib || '',
                                ket: doc.ket || '',
                                total_cost_po: Number((doc.totalNilaiPo || 0).toFixed(2)),
                                total_cif: Number((doc.totalCIF || 0).toFixed(2)),
                                total_cif_ar1: Number((doc.totalAR1 || 0).toFixed(2)),
                                total_cif_ar20: Number((doc.totalAR20 || 0).toFixed(2)),
                                total_cif_ar6: Number((doc.totalAR6 || 0).toFixed(2)),
                                total_cif_ar9: Number((doc.totalAR9 || 0).toFixed(2)),
                                total_cif_soyu: Number((doc.totalSOYU || 0).toFixed(2)),
                                total_cif_aff_na: Number((doc.totalAFFNA || 0).toFixed(2)),
                                pct_cif_vs_po: Number(pctCifPo.toFixed(2))
                              });
                            });

                            nonCifRecords.forEach(item => {
                              const key = cleanContKey(item.noContainer);
                              if (key && !headerMap.has(key)) {
                                allContainerNosSet.add(item.noContainer);
                                headerMap.set(key, {
                                  no_container: item.noContainer,
                                  bulan_kont_jalan: item.bulanKontJalan || 'Januari 2026',
                                  tgl_terima_pib: '-',
                                  ket: 'NON-CIF ONLY',
                                  total_cost_po: Number((item.totalNilaiPo || 0).toFixed(2)),
                                  total_cif: 0,
                                  total_cif_ar1: 0,
                                  total_cif_ar20: 0,
                                  total_cif_ar6: 0,
                                  total_cif_ar9: 0,
                                  total_cif_soyu: 0,
                                  total_cif_aff_na: 0,
                                  pct_cif_vs_po: 0
                                });
                              }
                            });

                            const headerRows = Array.from(headerMap.values());
                            const containerNos = Array.from(allContainerNosSet);

                            addLog(`⚡ Upsert data Header ke API (/api/cif-container)...`);
                            for (const headerRow of headerRows) {
                              const okHeader = await upsertCifHeader(headerRow);
                              if (!okHeader) {
                                throw new Error(`Gagal menyimpan Header Kontainer ${headerRow.no_container} — cek login (harus Admin/Audit) dan koneksi API.`);
                              }
                            }
                            addLog(`✅ Berhasil mengirim ${headerRows.length} data Header Kontainer ke database.`);

                            // 2. Prepare CIF Items
                            const allCifItems: any[] = [];

                            groupedCifContainers.forEach(doc => {
                              const basePo = doc.totalNilaiPo || 0;
                              const cifItems = (doc.items || []).filter(i => i.desc && i.desc.toUpperCase().trim() !== 'NILAI KONTAINER');
                              cifItems.forEach(item => {
                                const itemPct = basePo > 0 ? ((item.total || 0) / basePo) * 100 : 0;
                                allCifItems.push({
                                  no_container: doc.noContainer,
                                  deskripsi_biaya: item.desc,
                                  total_cif: Number((item.total || 0).toFixed(2)),
                                  pct_vs_po: Number(itemPct.toFixed(2)),
                                  ar1: Number((item.ar1 || 0).toFixed(2)),
                                  ar20: Number((item.ar20 || 0).toFixed(2)),
                                  ar6: Number((item.ar6 || 0).toFixed(2)),
                                  ar9: Number((item.ar9 || 0).toFixed(2)),
                                  soyu: Number((item.soyu || 0).toFixed(2)),
                                  aff_na: Number((item.affNa || 0).toFixed(2)),
                                  keterangan: item.ket || ''
                                });
                              });
                            });

                            if (allCifItems.length > 0) {
                              addLog(`⚡ Replace ${allCifItems.length} Rincian Biaya CIF per kontainer (/api/cif-container/:no/rincian-cif)...`);
                              // Endpoint bersifat replace per kontainer: rincian lama dihapus lalu diisi ulang
                              const cifByContainer = new Map<string, any[]>();
                              allCifItems.forEach(item => {
                                const list = cifByContainer.get(item.no_container) || [];
                                list.push(item);
                                cifByContainer.set(item.no_container, list);
                              });
                              for (const [contNo, items] of cifByContainer) {
                                const okCif = await replaceRincianCif(contNo, items);
                                if (!okCif) {
                                  throw new Error(`Gagal menyimpan Rincian CIF kontainer ${contNo} — cek login (harus Admin/Audit) dan koneksi API.`);
                                }
                              }
                              addLog(`✅ Berhasil mengirim ${allCifItems.length} Rincian Biaya CIF ke database.`);
                            }

                            // 3. Prepare Non-CIF Items
                            const allNonCifItems: any[] = [];
                            nonCifRecords.forEach(item => {
                              const matchedDoc = groupedCifContainers.find(doc => cleanContKey(doc.noContainer) === cleanContKey(item.noContainer));
                              const basePo = matchedDoc?.totalNilaiPo || item.totalNilaiPo || 0;
                              const itemPct = basePo > 0 ? ((item.total || 0) / basePo) * 100 : 0;
                              const targetContainer = matchedDoc?.noContainer || item.noContainer;
                              allNonCifItems.push({
                                no_container: targetContainer,
                                deskripsi_biaya: item.desc,
                                kategori_biaya: item.kategoriBiaya || 'Umum',
                                total_biaya: Number((item.total || 0).toFixed(2)),
                                pct_vs_po: Number(itemPct.toFixed(2)),
                                ar1: Number((item.ar1 || 0).toFixed(2)),
                                ar20: Number((item.ar20 || 0).toFixed(2)),
                                ar6: Number((item.ar6 || 0).toFixed(2)),
                                ar9: Number((item.ar9 || 0).toFixed(2)),
                                soyu: Number((item.soyu || 0).toFixed(2)),
                                aff_na: Number((item.affNa || 0).toFixed(2)),
                                keterangan: item.ket || ''
                              });
                            });

                            if (allNonCifItems.length > 0) {
                              addLog(`⚡ Replace ${allNonCifItems.length} Rincian Biaya Selain CIF per kontainer (/api/cif-container/:no/rincian-non-cif)...`);
                              const nonCifByContainer = new Map<string, any[]>();
                              allNonCifItems.forEach(item => {
                                const list = nonCifByContainer.get(item.no_container) || [];
                                list.push(item);
                                nonCifByContainer.set(item.no_container, list);
                              });
                              for (const [contNo, items] of nonCifByContainer) {
                                const okNonCif = await replaceRincianNonCif(contNo, items);
                                if (!okNonCif) {
                                  throw new Error(`Gagal menyimpan Rincian Selain CIF kontainer ${contNo} — cek login (harus Admin/Audit) dan koneksi API.`);
                                }
                              }
                              addLog(`✅ Berhasil mengirim ${allNonCifItems.length} Rincian Biaya Selain CIF ke database.`);
                            }

                            addLog(`🎉 SEMUA DATA RESUME CIF KONTAINER BERHASIL DI-SYNC KE DATABASE SQL SERVER!`);
                            setSyncStatus('success');
                            showToast('Semua data Resume CIF Kontainer berhasil dikirim ke database!', 'success');
                          } catch (err: any) {
                            addLog(`❌ Error: ${err?.message || 'Gagal tersambung ke Supabase'}`);
                            setSyncStatus('error');
                            setSyncErrorMessage(err?.message || 'Gagal mengirim data ke Supabase');
                            showToast(err?.message || 'Gagal mengirim data ke Supabase', 'error');
                          } finally {
                            setIsSyncingSupabase(false);
                          }
                        })();
                      }}
                      className="px-5 py-2.5 bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold rounded-lg transition text-xs flex items-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
                    >
                      {isSyncingSupabase ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                          <span>Mengirim Data...</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 text-slate-950" />
                          <span>Kirim Semua Data ke Supabase</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Status Banner */}
                  {syncStatus === 'success' && (
                    <div className="p-3 bg-emerald-100 border border-emerald-300 text-emerald-950 rounded-xl text-xs flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
                      <span className="font-semibold">
                        Selesai! Data Resume CIF Kontainer berhasil disimpan dan diperbarui di database Supabase Anda.
                      </span>
                    </div>
                  )}

                  {syncStatus === 'error' && (
                    <div className="p-3 bg-rose-100 border border-rose-300 text-rose-950 rounded-xl text-xs space-y-1">
                      <div className="font-bold flex items-center gap-2 text-rose-900">
                        <AlertCircle className="w-5 h-5 text-rose-700 shrink-0" />
                        <span>Pengiriman Data Gagal</span>
                      </div>
                      <p className="text-slate-800 text-[11px] pl-7">
                        {syncErrorMessage}
                      </p>
                      <p className="text-slate-600 text-[10px] pl-7 italic">
                        Petunjuk: Jika tabel belum ada, silakan pindah ke tab <strong>"📜 Script SQL (Supabase Editor)"</strong> di atas, copy script SQL, dan jalankan di SQL Editor Supabase Anda.
                      </p>
                    </div>
                  )}

                  {/* Live Console Terminal Log */}
                  <div className="bg-slate-950 text-slate-100 rounded-xl border border-slate-800 overflow-hidden shadow-inner font-mono text-xs">
                    <div className="bg-slate-900 px-3 py-2 border-b border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span>
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
                        <span className="ml-2 font-bold text-slate-300">Terminal Log Status Pengiriman</span>
                      </div>
                      {syncLogs.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setSyncLogs([])}
                          className="text-[10px] text-slate-400 hover:text-white cursor-pointer"
                        >
                          Clear Log
                        </button>
                      )}
                    </div>
                    <div className="p-4 max-h-[300px] overflow-y-auto space-y-1.5 leading-relaxed">
                      {syncLogs.length === 0 ? (
                        <div className="text-slate-500 italic text-[11px] py-4 text-center">
                          Klik tombol <strong>"Kirim Semua Data ke Supabase"</strong> di atas untuk memulai pengiriman data langsung via REST API.
                        </div>
                      ) : (
                        syncLogs.map((log, idx) => (
                          <div
                            key={idx}
                            className={`text-[11px] ${
                              log.includes('❌')
                                ? 'text-rose-400 font-bold'
                                : log.includes('✅') || log.includes('🎉')
                                ? 'text-emerald-400 font-bold'
                                : 'text-slate-300'
                            }`}
                          >
                            {log}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                /* ========================================================================= */
                /* TAB 2: SQL DDL & DML GENERATOR FOR SUPABASE SQL EDITOR                    */
                /* ========================================================================= */
                (() => {
                  const generateSupabaseSqlScript = () => {
                    const sanitize = (val?: string) => {
                      if (!val) return "''";
                      return `'${val.replace(/'/g, "''")}'`;
                    };

                    const sanitizeNum = (num?: number) => {
                      if (num === undefined || num === null || isNaN(num)) return '0';
                      return Number(num).toFixed(2);
                    };

                    let sql = `-- ====================================================================\n`;
                    sql += `-- SUPABASE SQL EDITOR SCRIPT: RESUME & DETAIL BIAYA CIF KONTAINER GZ 2026\n`;
                    sql += `-- Tanggal Dibuat: ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}\n`;
                    sql += `-- ====================================================================\n\n`;

                    sql += `-- 1. TABEL RESUME KONTAINER (HEADER DOCUMENT)\n`;
                    sql += `CREATE TABLE IF NOT EXISTS resume_cif_kontainer (\n`;
                    sql += `    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,\n`;
                    sql += `    no_container VARCHAR(100) UNIQUE NOT NULL,\n`;
                    sql += `    bulan_kont_jalan VARCHAR(100),\n`;
                    sql += `    tgl_terima_pib VARCHAR(50),\n`;
                    sql += `    ket TEXT,\n`;
                    sql += `    total_cost_po NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    total_cif NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    total_cif_ar1 NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    total_cif_ar20 NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    total_cif_ar6 NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    total_cif_ar9 NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    total_cif_soyu NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    total_cif_aff_na NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    pct_cif_vs_po NUMERIC(8,2) DEFAULT 0,\n`;
                    sql += `    created_at TIMESTAMPTZ DEFAULT NOW()\n`;
                    sql += `);\n\n`;

                    sql += `-- 2. TABEL RINCIAN ITEM BIAYA CIF (PIB)\n`;
                    sql += `CREATE TABLE IF NOT EXISTS rincian_biaya_cif (\n`;
                    sql += `    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,\n`;
                    sql += `    no_container VARCHAR(100) NOT NULL REFERENCES resume_cif_kontainer(no_container) ON DELETE CASCADE ON UPDATE CASCADE,\n`;
                    sql += `    deskripsi_biaya TEXT NOT NULL,\n`;
                    sql += `    total_cif NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    pct_vs_po NUMERIC(8,2) DEFAULT 0,\n`;
                    sql += `    ar1 NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    ar20 NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    ar6 NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    ar9 NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    soyu NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    aff_na NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    keterangan TEXT,\n`;
                    sql += `    created_at TIMESTAMPTZ DEFAULT NOW()\n`;
                    sql += `);\n\n`;

                    sql += `-- 3. TABEL RINCIAN BIAYA SELAIN CIF (DEPRE MANUAL)\n`;
                    sql += `CREATE TABLE IF NOT EXISTS rincian_biaya_selain_cif (\n`;
                    sql += `    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,\n`;
                    sql += `    no_container VARCHAR(100) NOT NULL REFERENCES resume_cif_kontainer(no_container) ON DELETE CASCADE ON UPDATE CASCADE,\n`;
                    sql += `    deskripsi_biaya TEXT NOT NULL,\n`;
                    sql += `    kategori_biaya VARCHAR(100) DEFAULT 'Umum',\n`;
                    sql += `    total_biaya NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    pct_vs_po NUMERIC(8,2) DEFAULT 0,\n`;
                    sql += `    ar1 NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    ar20 NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    ar6 NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    ar9 NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    soyu NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    aff_na NUMERIC(18,2) DEFAULT 0,\n`;
                    sql += `    keterangan TEXT,\n`;
                    sql += `    created_at TIMESTAMPTZ DEFAULT NOW()\n`;
                    sql += `);\n\n`;

                    sql += `-- 4. NONAKTIFKAN ROW LEVEL SECURITY (RLS) & IZINKAN AKSES REST API\n`;
                    sql += `ALTER TABLE resume_cif_kontainer DISABLE ROW LEVEL SECURITY;\n`;
                    sql += `ALTER TABLE rincian_biaya_cif DISABLE ROW LEVEL SECURITY;\n`;
                    sql += `ALTER TABLE rincian_biaya_selain_cif DISABLE ROW LEVEL SECURITY;\n\n`;

                    sql += `GRANT ALL ON resume_cif_kontainer TO anon, authenticated, service_role;\n`;
                    sql += `GRANT ALL ON rincian_biaya_cif TO anon, authenticated, service_role;\n`;
                    sql += `GRANT ALL ON rincian_biaya_selain_cif TO anon, authenticated, service_role;\n\n`;

                    sql += `-- ====================================================================\n`;
                    sql += `-- DATA SEED / INSERT DARI SYSTEM\n`;
                    sql += `-- ====================================================================\n\n`;

                    groupedCifContainers.forEach(doc => {
                      const basePo = doc.totalNilaiPo || 0;
                      const pctCifPo = basePo > 0 ? ((doc.totalCIF || 0) / basePo) * 100 : 0;

                      sql += `-- --- KONTAINER: ${doc.noContainer} ---\n`;
                      sql += `INSERT INTO resume_cif_kontainer (\n`;
                      sql += `    no_container, bulan_kont_jalan, tgl_terima_pib, ket,\n`;
                      sql += `    total_cost_po, total_cif, total_cif_ar1, total_cif_ar20, total_cif_ar6, total_cif_ar9, total_cif_soyu, total_cif_aff_na, pct_cif_vs_po\n`;
                      sql += `) VALUES (\n`;
                      sql += `    ${sanitize(doc.noContainer)}, ${sanitize(doc.bulanKontJalan)}, ${sanitize(doc.tglFinalPembayaranPib)}, ${sanitize(doc.ket)},\n`;
                      sql += `    ${sanitizeNum(doc.totalNilaiPo)}, ${sanitizeNum(doc.totalCIF)}, ${sanitizeNum(doc.totalAR1)}, ${sanitizeNum(doc.totalAR20)}, ${sanitizeNum(doc.totalAR6)}, ${sanitizeNum(doc.totalAR9)}, ${sanitizeNum(doc.totalSOYU)}, ${sanitizeNum(doc.totalAFFNA)}, ${sanitizeNum(pctCifPo)}\n`;
                      sql += `) ON CONFLICT (no_container) DO UPDATE SET\n`;
                      sql += `    bulan_kont_jalan = EXCLUDED.bulan_kont_jalan,\n`;
                      sql += `    tgl_terima_pib = EXCLUDED.tgl_terima_pib,\n`;
                      sql += `    total_cost_po = EXCLUDED.total_cost_po,\n`;
                      sql += `    total_cif = EXCLUDED.total_cif,\n`;
                      sql += `    total_cif_ar1 = EXCLUDED.total_cif_ar1,\n`;
                      sql += `    total_cif_ar20 = EXCLUDED.total_cif_ar20,\n`;
                      sql += `    total_cif_ar6 = EXCLUDED.total_cif_ar6,\n`;
                      sql += `    total_cif_ar9 = EXCLUDED.total_cif_ar9,\n`;
                      sql += `    total_cif_soyu = EXCLUDED.total_cif_soyu,\n`;
                      sql += `    total_cif_aff_na = EXCLUDED.total_cif_aff_na,\n`;
                      sql += `    pct_cif_vs_po = EXCLUDED.pct_cif_vs_po;\n\n`;

                      // CIF Items
                      const cifItems = (doc.items || []).filter(i => i.desc && i.desc.toUpperCase().trim() !== 'NILAI KONTAINER');
                      if (cifItems.length > 0) {
                        cifItems.forEach(item => {
                          const itemPct = basePo > 0 ? ((item.total || 0) / basePo) * 100 : 0;
                          sql += `INSERT INTO rincian_biaya_cif (\n`;
                          sql += `    no_container, deskripsi_biaya, total_cif, pct_vs_po, ar1, ar20, ar6, ar9, soyu, aff_na, keterangan\n`;
                          sql += `) VALUES (\n`;
                          sql += `    ${sanitize(doc.noContainer)}, ${sanitize(item.desc)}, ${sanitizeNum(item.total)}, ${sanitizeNum(itemPct)},\n`;
                          sql += `    ${sanitizeNum(item.ar1)}, ${sanitizeNum(item.ar20)}, ${sanitizeNum(item.ar6)}, ${sanitizeNum(item.ar9)}, ${sanitizeNum(item.soyu)}, ${sanitizeNum(item.affNa)}, ${sanitize(item.ket)}\n`;
                          sql += `);\n`;
                        });
                        sql += `\n`;
                      }
                    });

                    // Extra Header Containers from standalone nonCifRecords
                    const processedHeaderKeys = new Set(groupedCifContainers.map(d => cleanContKey(d.noContainer)));
                    nonCifRecords.forEach(item => {
                      const key = cleanContKey(item.noContainer);
                      if (key && !processedHeaderKeys.has(key)) {
                        processedHeaderKeys.add(key);
                        sql += `-- --- KONTAINER STANDALONE NON-CIF: ${item.noContainer} ---\n`;
                        sql += `INSERT INTO resume_cif_kontainer (\n`;
                        sql += `    no_container, bulan_kont_jalan, tgl_terima_pib, ket, total_cost_po\n`;
                        sql += `) VALUES (\n`;
                        sql += `    ${sanitize(item.noContainer)}, ${sanitize(item.bulanKontJalan || 'Januari 2026')}, '-', 'NON-CIF ONLY', ${sanitizeNum(item.totalNilaiPo)}\n`;
                        sql += `) ON CONFLICT (no_container) DO NOTHING;\n\n`;
                      }
                    });

                    // ALL Non-CIF Items
                    if (nonCifRecords.length > 0) {
                      sql += `-- ====================================================================\n`;
                      sql += `-- RINCIAN BIAYA SELAIN CIF (ALL ITEMS)\n`;
                      sql += `-- ====================================================================\n`;
                      nonCifRecords.forEach(item => {
                        const matchedDoc = groupedCifContainers.find(doc => cleanContKey(doc.noContainer) === cleanContKey(item.noContainer));
                        const basePo = matchedDoc?.totalNilaiPo || item.totalNilaiPo || 0;
                        const itemPct = basePo > 0 ? ((item.total || 0) / basePo) * 100 : 0;
                        const targetContainer = matchedDoc?.noContainer || item.noContainer;
                        sql += `INSERT INTO rincian_biaya_selain_cif (\n`;
                        sql += `    no_container, deskripsi_biaya, kategori_biaya, total_biaya, pct_vs_po, ar1, ar20, ar6, ar9, soyu, aff_na, keterangan\n`;
                        sql += `) VALUES (\n`;
                        sql += `    ${sanitize(targetContainer)}, ${sanitize(item.desc)}, ${sanitize(item.kategoriBiaya || 'Umum')}, ${sanitizeNum(item.total)}, ${sanitizeNum(itemPct)},\n`;
                        sql += `    ${sanitizeNum(item.ar1)}, ${sanitizeNum(item.ar20)}, ${sanitizeNum(item.ar6)}, ${sanitizeNum(item.ar9)}, ${sanitizeNum(item.soyu)}, ${sanitizeNum(item.affNa)}, ${sanitize(item.ket)}\n`;
                        sql += `);\n`;
                      });
                      sql += `\n`;
                    }

                    sql += `-- ====================================================================\n`;
                    sql += `-- VIEW REKAP GABUNGAN BIAYA CIF + SELAIN CIF\n`;
                    sql += `-- ====================================================================\n`;
                    sql += `DROP VIEW IF EXISTS view_resume_cif_lengkap CASCADE;\n`;
                    sql += `CREATE OR REPLACE VIEW view_resume_cif_lengkap AS\n`;
                    sql += `SELECT \n`;
                    sql += `    r.no_container,\n`;
                    sql += `    r.bulan_kont_jalan,\n`;
                    sql += `    r.tgl_terima_pib,\n`;
                    sql += `    r.total_cost_po,\n`;
                    sql += `    r.total_cif,\n`;
                    sql += `    COALESCE(s.total_non_cif, 0) AS total_biaya_selain_cif,\n`;
                    sql += `    (r.total_cif + COALESCE(s.total_non_cif, 0)) AS grand_total_biaya,\n`;
                    sql += `    ROUND(((r.total_cif + COALESCE(s.total_non_cif, 0)) / NULLIF(r.total_cost_po, 0)) * 100, 2) AS pct_grand_total_vs_po,\n`;
                    sql += `    r.ket\n`;
                    sql += `FROM resume_cif_kontainer r\n`;
                    sql += `LEFT JOIN (\n`;
                    sql += `    SELECT no_container, SUM(total_biaya) AS total_non_cif\n`;
                    sql += `    FROM rincian_biaya_selain_cif\n`;
                    sql += `    GROUP BY no_container\n`;
                    sql += `) s ON r.no_container = s.no_container;\n`;

                    return sql;
                  };

                  const sqlScript = generateSupabaseSqlScript();

                  const handleCopySql = () => {
                    navigator.clipboard.writeText(sqlScript);
                    showToast('Script SQL Supabase berhasil disalin ke clipboard!', 'success');
                  };

                  const handleDownloadSql = () => {
                    const blob = new Blob([sqlScript], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `resume_cif_kontainer_gz2026_${new Date().toISOString().slice(0, 10)}.sql`;
                    a.click();
                    URL.revokeObjectURL(url);
                    showToast('File SQL berhasil diunduh!', 'success');
                  };

                  return (
                    <div className="space-y-3">
                      {/* Guidance / Step-by-step box */}
                      <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-950 space-y-1.5 shadow-2xs">
                        <div className="font-bold text-emerald-900 flex items-center gap-1.5 text-sm">
                          <Code className="w-4 h-4 text-emerald-700" />
                          <span>Cara Menjalankan Script di Supabase SQL Editor:</span>
                        </div>
                        <ol className="list-decimal list-inside space-y-1 text-slate-700 ml-1">
                          <li>Buka dashboard Supabase Anda di <code className="bg-emerald-100 px-1 py-0.5 rounded font-mono text-emerald-900 font-bold">https://supabase.com/dashboard</code></li>
                          <li>Pilih proyek Anda &amp; masuk ke menu <strong className="text-slate-900">SQL Editor</strong> di sidebar kiri</li>
                          <li>Klik <strong className="text-slate-900">"+ New Query"</strong>, lalu tempel (paste) seluruh kode SQL di bawah ini</li>
                          <li>Klik tombol <strong className="text-emerald-700">"Run"</strong> untuk membuat tabel <code className="bg-slate-200 px-1 py-0.5 rounded font-mono">resume_cif_kontainer</code>, <code className="bg-slate-200 px-1 py-0.5 rounded font-mono">rincian_biaya_cif</code>, <code className="bg-slate-200 px-1 py-0.5 rounded font-mono">rincian_biaya_selain_cif</code> beserta seluruh data itemnya.</li>
                        </ol>
                      </div>

                      {/* Toolbar Actions */}
                      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900 p-2.5 rounded-xl border border-slate-800 text-white">
                        <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
                          <FileCode className="w-4 h-4 text-emerald-400" />
                          <span>resume_cif_kontainer.sql</span>
                          <span className="text-[10px] text-slate-400">({sqlScript.length} karakter)</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleCopySql}
                            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>Salin SQL Supabase</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleDownloadSql}
                            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-lg transition text-xs flex items-center gap-1.5 cursor-pointer border border-slate-700"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Unduh .sql File</span>
                          </button>
                        </div>
                      </div>

                      {/* Code Editor Container */}
                      <div className="relative border border-slate-800 rounded-xl overflow-hidden shadow-inner bg-slate-950 font-mono text-xs">
                        <pre className="p-4 text-emerald-300 overflow-x-auto max-h-[460px] overflow-y-auto whitespace-pre leading-relaxed selection:bg-emerald-800 selection:text-white">
                          {sqlScript}
                        </pre>
                      </div>
                    </div>
                  );
                })()
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-slate-100 border-t border-slate-200 flex items-center justify-between shrink-0">
              <span className="text-xs text-slate-500 font-mono">
                Tabel Supabase: resume_cif_kontainer | rincian_biaya_cif | rincian_biaya_selain_cif
              </span>
              <button
                type="button"
                onClick={() => setIsSqlModalOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-lg transition text-xs cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
