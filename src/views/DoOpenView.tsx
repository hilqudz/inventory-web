import React, { useState, useMemo } from 'react';
import { 
  Clock, 
  Plus, 
  FileSpreadsheet, 
  Download, 
  Trash2, 
  X, 
  CheckSquare, 
  Square, 
  AlertCircle,
  RefreshCw,
  Sparkles,
  Send,
  Truck,
  ShieldAlert,
  Search,
  Filter,
  DollarSign,
  Package,
  RotateCcw,
  CheckCircle2,
  BarChart3,
  FileText,
  ChevronDown,
  ChevronUp,
  Pencil,
  Check,
  ArrowUpDown,
  Camera,
  Eye,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { DoOpenRecord, RequestDoRecord, DateCategoryFilter, MasterItem, TransactionRecord, getDoOpenLogistikGroup, UserProfile, ItemCatalogPhoto } from '../types';
import { SortableHeader } from '../components/SortableHeader';
import { SearchableSelect } from '../components/SearchableSelect';
import { ReportDoOpenModal } from '../components/ReportDoOpenModal';
import { sortData, SortConfig } from '../utils/sorting';
import { exportToExcel } from '../utils/excel';
import { bulkDeleteDocs, clearCollectionDocs, COLLECTIONS, db, autoReconcileDoOpen, isFirestoreQuotaExceeded } from '../api';
import { clearSupabaseTable, deleteDoOpen, addRequestDoOpen, addDoOpen, generateUUID, updateDoOpenKeteranganByDocumentNo, bulkAddRequestDoOpen } from '../api';
import { saveLocalCache } from '../utils/localCache';
import { addDoc, collection, doc, deleteDoc, updateDoc, setDoc } from 'firebase/firestore';

interface DoOpenViewProps {
  records: DoOpenRecord[];
  transaksiKeluar?: TransactionRecord[];
  requestDoOpenRecords?: RequestDoRecord[];
  masterItems: MasterItem[];
  catalogPhotos?: ItemCatalogPhoto[];
  currentUser: UserProfile | null;
  onOpenImport: () => void;
  onRequestDeleteConfirm: (title: string, message: string, onConfirm: () => Promise<void>, isAll?: boolean, count?: number) => void;
  onAutoReconciledNotice?: (deletedCount: number, deletedDocs: string[]) => void;
  onRunAutoReconcile?: () => Promise<any>;
  onRequestDoOpenCreate?: (newRequests: RequestDoRecord[]) => void;
  onUpdateDoOpenRecord?: (updatedRecord: DoOpenRecord) => void;
  onNavigateToCatalog?: (itemCode?: string) => void;
}

function formatDateDisplay(dateStr?: string): string {
  if (!dateStr) return '-';
  if (dateStr.includes('T')) dateStr = dateStr.split('T')[0];
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts.length === 3 && parts[0].length === 4) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
  }
  return dateStr;
}

export const DoOpenView: React.FC<DoOpenViewProps> = ({
  records,
  transaksiKeluar = [],
  requestDoOpenRecords = [],
  masterItems,
  catalogPhotos = [],
  currentUser,
  onOpenImport,
  onRequestDeleteConfirm,
  onAutoReconciledNotice,
  onRunAutoReconcile,
  onRequestDoOpenCreate,
  onUpdateDoOpenRecord,
  onNavigateToCatalog
}) => {
  // Lightbox Photo Modal State
  const [activeDoPhotoModal, setActiveDoPhotoModal] = useState<{ photoUrl: string; itemCode: string; itemName: string; notes?: string } | null>(null);
  // Inline Editing State (Keterangan saja — No DOSL sudah gak bisa diedit
  // lewat tabel ini lagi, sesuai permintaan user)
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<'keterangan' | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [savingInline, setSavingInline] = useState(false);

  const handleSaveInlineEdit = async (id: string) => {
    const target = records.find(r => r.id === id);
    if (!target || !editingField) return;

    const newVal = editingValue.trim() || '-';
    setSavingInline(true);

    try {
      // Keterangan berlaku untuk SEMUA item di No DO yang sama (bukan cuma
      // baris yang diedit) — permintaan user: 1 catatan mewakili seluruh
      // No DO, bukan per-item, karena kalau per-item bikin gampang kelupaan
      // isi & jadi gak konsisten kayak yang kejadian kemarin.
      const docNoUpper = (target.documentNo || '').trim().toUpperCase();
      const matchingLines = records.filter(r => (r.documentNo || '').trim().toUpperCase() === docNoUpper);

      // WAJIB cek hasilnya — updateDoOpenKeteranganByDocumentNo balikin
      // true/false (bukan throw) kalau gagal (mis. role OPR ditolak server,
      // WRITE_ROLES cuma izinkan Admin/Audit/Team Gudang). Kalau tidak
      // dicek, local state tetap keupdate seolah berhasil padahal gak
      // pernah kesimpen ke database (bug yang sama kayak kasus lain).
      const savedOk = await updateDoOpenKeteranganByDocumentNo(target.documentNo, newVal);
      if (!savedOk) {
        alert('Gagal menyimpan Keterangan (sesi mungkin sudah kedaluwarsa, atau role kamu tidak punya akses ubah data ini).');
        return;
      }

      if (!isFirestoreQuotaExceeded) {
        for (const line of matchingLines) {
          if (!line.id) continue;
          try {
            await setDoc(doc(db, COLLECTIONS.DO_OPEN, line.id), { keterangan: newVal }, { merge: true });
          } catch (e) {
            console.warn('Notice: updateDoc Firestore:', e);
          }
        }
      }

      if (onUpdateDoOpenRecord) {
        for (const line of matchingLines) {
          onUpdateDoOpenRecord({ ...line, keterangan: newVal });
        }
      }
    } catch (err) {
      console.error('Error saving inline edit:', err);
    } finally {
      setSavingInline(false);
      setEditingRowId(null);
      setEditingField(null);
    }
  };
  // General filters (search, date)
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Dropdown filters
  const [selectedAreaRm, setSelectedAreaRm] = useState('');
  const [selectedAreaSpv, setSelectedAreaSpv] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedToLocation, setSelectedToLocation] = useState('');
  const [selectedGroupName, setSelectedGroupName] = useState('');

  // Table selection & sorting
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'postingDate', direction: 'desc' });

  // Modal & Async states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [isReportDoOpenOpen, setIsReportDoOpenOpen] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [requestSuccessNotice, setRequestSuccessNotice] = useState<string | null>(null);
  const [isDashboardMinimized, setIsDashboardMinimized] = useState(false);
const [isFilterMinimized, setIsFilterMinimized] = useState(false);

  // Form State for Adding DO OPEN
  const [postingDate, setPostingDate] = useState(new Date().toISOString().slice(0, 10));
  const [entryName, setEntryName] = useState('Sales Admin RM'); // Area RM OPR
  const [documentNo, setDocumentNo] = useState(`DO-2026-${Math.floor(100 + Math.random() * 900)}`);
  const [noDosl, setNoDosl] = useState('-'); // No DOSL
  const [itemCode, setItemCode] = useState(masterItems[0]?.itemCode || 'ITM-101');
  const [category, setCategory] = useState('DO SUDAH DI LOGISTIK'); // Status DO OPEN
  const [remark, setRemark] = useState('SPV Logistik Main Area'); // Area SPV OPR
  const [qty, setQty] = useState<number | ''>(25);
  const [fromLocation, setFromLocation] = useState('Gudang Utama A');
  const [toLocation, setToLocation] = useState('Customer PT Konstruksi');
  const [keterangan, setKeterangan] = useState('-'); // Keterangan
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form State for Request DO OPEN Modal
  const [reqPostingDate, setReqPostingDate] = useState(new Date().toISOString().slice(0, 10));
  const [reqDocumentNo, setReqDocumentNo] = useState('');
  const [reqItemCode, setReqItemCode] = useState('');
  const [reqQty, setReqQty] = useState<number | ''>(1);
  const [reqEntryName, setReqEntryName] = useState('Sales Admin RM');
  const [reqRemark, setReqRemark] = useState('SPV Logistik Area');
  const [reqFromLocation, setReqFromLocation] = useState('Gudang Utama A');
  const [reqToLocation, setReqToLocation] = useState('Customer PT Konstruksi');
  const [reqCategory, setReqCategory] = useState('DO SUDAH DI LOGISTIK');
  const [reqKeterangan, setReqKeterangan] = useState('');
  const [reqError, setReqError] = useState<string | null>(null);
  const [reqDoOpenId, setReqDoOpenId] = useState('');

  // Master Items Price Map for fast lookups
  const masterMap = useMemo(() => {
    const map = new Map<string, MasterItem>();
    masterItems.forEach(m => map.set(m.itemCode, m));
    return map;
  }, [masterItems]);

  // Catalog Photo Map by Item Code
  const catalogPhotoMap = useMemo(() => {
    const map = new Map<string, ItemCatalogPhoto>();
    if (catalogPhotos) {
      catalogPhotos.forEach(p => {
        if (p.itemCode) map.set(p.itemCode, p);
      });
    }
    return map;
  }, [catalogPhotos]);

  // Map of No DO (documentNo) that have already been requested
  const requestedDoMap = useMemo(() => {
    const map = new Map<string, { requestKirimDate: string; status: string }>();

    // 1. From active requestDoOpenRecords (PENDING or APPROVED)
    if (requestDoOpenRecords) {
      requestDoOpenRecords.forEach(req => {
        if (!req.documentNo) return;
        const key = req.documentNo.trim().toUpperCase();
        if (req.status === 'PENDING' || req.status === 'APPROVED') {
          let reqDate = req.requestKirimDate;
          if (!reqDate && req.requestedAt) {
            reqDate = req.requestedAt.slice(0, 10);
          }
          if (!reqDate) {
            reqDate = new Date().toISOString().slice(0, 10);
          }
          map.set(key, { requestKirimDate: reqDate, status: req.status });
        }
      });
    }

    // 2. From records themselves (if requestKirimDate is saved on DoOpenRecord)
    records.forEach(r => {
      if (!r.documentNo) return;
      const key = r.documentNo.trim().toUpperCase();
      if (r.requestKirimDate && !map.has(key)) {
        map.set(key, { requestKirimDate: r.requestKirimDate, status: 'PENDING' });
      }
    });

    return map;
  }, [requestDoOpenRecords, records]);

  // Dynamic Options for Dropdowns
  const areaRmOptions = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => { if (r.entryName && r.entryName.trim()) set.add(r.entryName.trim()); });
    return Array.from(set).sort();
  }, [records]);

  const areaSpvOptions = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => { if (r.remark && r.remark.trim()) set.add(r.remark.trim()); });
    return Array.from(set).sort();
  }, [records]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => { if (r.category && r.category.trim()) set.add(r.category.trim()); });
    return Array.from(set).sort();
  }, [records]);

  const toLocationOptions = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => { if (r.toLocation && r.toLocation.trim()) set.add(r.toLocation.trim()); });
    return Array.from(set).sort();
  }, [records]);

  const groupNameOptions = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => {
      const m = masterMap.get(r.itemCode);
      const g = (m?.groupName || 'Tanpa Group').trim() || 'Tanpa Group';
      set.add(g);
    });
    return Array.from(set).sort();
  }, [records, masterMap]);

  const canDelete = currentUser?.role === 'Audit';
// OPR juga diizinkan edit Keterangan (beda dari WRITE_ROLES backend yang
// umum buat field lain kayak No DOSL/Qty/dst) — OPR yang sehari-hari pakai
// tabel ini buat isi Keterangan sebelum klik Request per baris.
const canEditDoOpenFields = currentUser?.role === 'Admin' || currentUser?.role === 'Audit' || currentUser?.role === 'Team Gudang' || currentUser?.role === 'OPR';
  const isOprRole = currentUser?.role === 'OPR';
  // OPR & Team Gudang cuma boleh lihat Nilai Jual, bukan Nilai Beli/modal
  // (permintaan Pak Irvan 2026-08-19).
  const showJualOnly = currentUser?.role === 'OPR' || currentUser?.role === 'Team Gudang';

  // Gabungan 2 opsi status tetap (posisi barang) + statusOptions dinamis,
  // dipakai SearchableSelect (butuh satu array flat, bukan <option> JSX).
  const statusFilterOptions = useMemo(() => {
    const fixed = ['BARANG SUDAH DI LOGISTIK (SIAP KIRIM)'];
    if (!isOprRole) fixed.push('BARANG MASIH ADA DI AREA QC');
    const rest = statusOptions.filter(opt => !fixed.includes(opt));
    return [...fixed, ...rest];
  }, [statusOptions, isOprRole]);

  // Filtered Records
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      // OPR Role Constraint: ONLY DO OPEN STATUS SUDAH DI LOGISTIK (SIAP KIRIM)
      if (isOprRole && getDoOpenLogistikGroup(r.category) !== 'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)') {
        return false;
      }

      // Search
      const query = searchQuery.toLowerCase().trim();
      const m = masterMap.get(r.itemCode);
      const matchSearch = !query || 
        (r.documentNo && r.documentNo.toLowerCase().includes(query)) ||
        (r.noDosl && r.noDosl.toLowerCase().includes(query)) ||
        (r.itemCode && r.itemCode.toLowerCase().includes(query)) ||
        (m?.itemName && m.itemName.toLowerCase().includes(query)) ||
        (m?.groupName && m.groupName.toLowerCase().includes(query)) ||
        (r.remark && r.remark.toLowerCase().includes(query)) ||
        (r.keterangan && r.keterangan.toLowerCase().includes(query)) ||
        (r.entryName && r.entryName.toLowerCase().includes(query)) ||
        (r.fromLocation && r.fromLocation.toLowerCase().includes(query)) ||
        (r.toLocation && r.toLocation.toLowerCase().includes(query));

      // Date Range
      let matchDate = true;
      if (startDate) matchDate = matchDate && r.postingDate >= startDate;
      if (endDate) matchDate = matchDate && r.postingDate <= endDate;

      // Dropdown Filters
      const matchAreaRm = !selectedAreaRm || (r.entryName || '').trim().toLowerCase() === selectedAreaRm.trim().toLowerCase();
      const matchAreaSpv = !selectedAreaSpv || (r.remark || '').trim().toLowerCase() === selectedAreaSpv.trim().toLowerCase();
      
      let matchStatus = true;
      if (selectedStatus) {
        if (
          selectedStatus === 'BARANG MASIH ADA DI AREA QC' || 
          selectedStatus === 'BARANG MASIH DI AREA QC' ||
          selectedStatus === 'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)' || 
          selectedStatus === 'BARANG SUDAH DI LOGISTIK'
        ) {
          matchStatus = getDoOpenLogistikGroup(r.category) === getDoOpenLogistikGroup(selectedStatus);
        } else {
          matchStatus = (r.category || '').trim().toLowerCase() === selectedStatus.trim().toLowerCase();
        }
      }

      const matchToLoc = !selectedToLocation || (r.toLocation || '').trim().toLowerCase() === selectedToLocation.trim().toLowerCase();
      const matchGroup = !selectedGroupName || ((m?.groupName || 'Tanpa Group').trim().toLowerCase() === selectedGroupName.trim().toLowerCase());

      return matchSearch && matchDate && matchAreaRm && matchAreaSpv && matchStatus && matchToLoc && matchGroup;
    });
  }, [records, searchQuery, startDate, endDate, selectedAreaRm, selectedAreaSpv, selectedStatus, selectedToLocation, selectedGroupName, isOprRole, masterMap]);

  // Group Name Breakdown Dashboard Metrics
  const groupNameBreakdown = useMemo(() => {
    const map: Record<string, {
      groupName: string;
      docSet: Set<string>;
      recordCount: number;
      totalQty: number;
      totalNilaiJual: number;
    }> = {};

    filteredRecords.forEach(r => {
      const m = masterMap.get(r.itemCode);
      const grp = (m?.groupName || 'Tanpa Group').trim() || 'Tanpa Group';
      const q = Number(r.qty) || 0;
      const docNo = (r.documentNo || '').trim().toUpperCase();
      const nj = q * (m?.hargaJual || 0);

      if (!map[grp]) {
        map[grp] = {
          groupName: grp,
          docSet: new Set<string>(),
          recordCount: 0,
          totalQty: 0,
          totalNilaiJual: 0
        };
      }

      if (docNo) map[grp].docSet.add(docNo);
      map[grp].recordCount += 1;
      map[grp].totalQty += q;
      map[grp].totalNilaiJual += nj;
    });

    return Object.values(map).map(g => ({
      groupName: g.groupName,
      docCount: g.docSet.size,
      recordCount: g.recordCount,
      totalQty: g.totalQty,
      totalNilaiJual: g.totalNilaiJual
    })).sort((a, b) => b.totalQty - a.totalQty);
  }, [filteredRecords, masterMap]);

  // Custom Resolvers for DO OPEN Sorting
  const customResolvers = useMemo(() => ({
    hargaBeliSatuan: (r: DoOpenRecord) => {
      const m = masterMap.get(r.itemCode);
      return m?.hargaBeli || 0;
    },
    hargaBeli: (r: DoOpenRecord) => {
      const m = masterMap.get(r.itemCode);
      return m?.hargaBeli || 0;
    },
    totalHargaBeli: (r: DoOpenRecord) => {
      const m = masterMap.get(r.itemCode);
      return (Number(r.qty) || 0) * (m?.hargaBeli || 0);
    },
    nilaiBeli: (r: DoOpenRecord) => {
      const m = masterMap.get(r.itemCode);
      return (Number(r.qty) || 0) * (m?.hargaBeli || 0);
    },
    hargaJualSatuan: (r: DoOpenRecord) => {
      const m = masterMap.get(r.itemCode);
      return m?.hargaJual || 0;
    },
    hargaJual: (r: DoOpenRecord) => {
      const m = masterMap.get(r.itemCode);
      return m?.hargaJual || 0;
    },
    totalHargaJual: (r: DoOpenRecord) => {
      const m = masterMap.get(r.itemCode);
      return (Number(r.qty) || 0) * (m?.hargaJual || 0);
    },
    nilaiJual: (r: DoOpenRecord) => {
      const m = masterMap.get(r.itemCode);
      return (Number(r.qty) || 0) * (m?.hargaJual || 0);
    },
    itemName: (r: DoOpenRecord) => {
      const m = masterMap.get(r.itemCode);
      return m?.itemName || '';
    },
    groupName: (r: DoOpenRecord) => {
      const m = masterMap.get(r.itemCode);
      return m?.groupName || '';
    }
  }), [masterMap]);

  // Sorted Records
  const sortedRecords = useMemo(() => {
    return sortData(filteredRecords, sortConfig, customResolvers);
  }, [filteredRecords, sortConfig, customResolvers]);

  // Pagination — cegah render ribuan baris DOM sekaligus (lihat MasterItemView)
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(sortedRecords.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedRecords = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return sortedRecords.slice(start, start + PAGE_SIZE);
  }, [sortedRecords, safePage]);
  React.useEffect(() => {
    setPage(1);
  }, [searchQuery, startDate, endDate, selectedAreaRm, selectedAreaSpv, selectedStatus, selectedToLocation, selectedGroupName, sortConfig]);

  // Dashboard Metrics for Filtered Data (Count Unique No DO / DocumentNo)
  const dashboardSummary = useMemo(() => {
    let totalQty = 0;
    let totalNilaiJual = 0;
    let totalNilaiBeli = 0;
    let qtySudahLogistik = 0;
    let qtyQC = 0;

    const uniqueDoSet = new Set<string>();
    const logistikDocSet = new Set<string>();
    const qcDocSet = new Set<string>();

    filteredRecords.forEach(r => {
      const q = Number(r.qty) || 0;
      totalQty += q;

      const docNo = (r.documentNo || '').trim().toUpperCase();
      if (docNo) uniqueDoSet.add(docNo);

      const m = masterMap.get(r.itemCode);
      if (m) {
        totalNilaiJual += q * (m.hargaJual || 0);
        totalNilaiBeli += q * (m.hargaBeli || 0);
      }

      const isLogistik = getDoOpenLogistikGroup(r.category) === 'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)';
      if (isLogistik) {
        if (docNo) logistikDocSet.add(docNo);
        qtySudahLogistik += q;
      } else {
        if (docNo) qcDocSet.add(docNo);
        qtyQC += q;
      }
    });

    return {
      totalUniqueDo: uniqueDoSet.size,
      totalLineItems: filteredRecords.length,
      totalRecords: uniqueDoSet.size, // backward compatibility
      totalQty,
      totalNilaiJual,
      totalNilaiBeli,
      countSudahLogistik: logistikDocSet.size,
      qtySudahLogistik,
      countQC: qcDocSet.size,
      qtyQC
    };
  }, [filteredRecords, masterMap]);

  // Header Sort Toggle
  const handleSort = (field: string) => {
    setSortConfig(prev => {
      if (prev.key === field) {
        if (prev.direction === 'asc') return { key: field, direction: 'desc' };
        if (prev.direction === 'desc') return { key: null, direction: null };
      }
      return { key: field, direction: 'asc' };
    });
  };

  // Reset All Filters
  const handleResetFilters = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setSearchQuery('');
    setStartDate('');
    setEndDate('');
    setSelectedAreaRm('');
    setSelectedAreaSpv('');
    setSelectedStatus('');
    setSelectedToLocation('');
    setSelectedGroupName('');
    setSelectedIds([]);
  };

  // Select / Deselect All
  const handleSelectAll = () => {
    if (selectedIds.length === sortedRecords.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(sortedRecords.map(i => i.id!).filter(Boolean));
    }
  };

  // Requirement 1: User Checklist 1 No DO, line No DO yang sama otomatis ke-checklist juga
  const handleToggleSelect = (id: string) => {
    const targetRecord = records.find(r => r.id === id);
    if (!targetRecord || !targetRecord.documentNo) {
      setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
      return;
    }

    const targetDocNo = targetRecord.documentNo.trim().toUpperCase();
    const matchingIds = records
      .filter(r => r.id && (r.documentNo || '').trim().toUpperCase() === targetDocNo)
      .map(r => r.id!);

    setSelectedIds(prev => {
      const isCurrentlySelected = prev.includes(id);
      if (isCurrentlySelected) {
        // Uncheck all lines with same DocumentNo
        const setMatching = new Set(matchingIds);
        return prev.filter(i => !setMatching.has(i));
      } else {
        // Check all lines with same DocumentNo
        const combined = new Set([...prev, ...matchingIds]);
        return Array.from(combined);
      }
    });
  };

  // Run Manual Auto-Reconcile Trigger
  const handleRunReconciliation = async () => {
    setIsReconciling(true);
    try {
      let res;
      if (onRunAutoReconcile) {
        res = await onRunAutoReconcile();
      } else {
        res = await autoReconcileDoOpen(records, transaksiKeluar);
      }

      if (res && res.deletedCount > 0) {
        if (onAutoReconciledNotice) {
          onAutoReconciledNotice(res.deletedCount, res.deletedDocs);
        } else {
          alert(`Berhasil merekonsiliasi! ${res.deletedCount} No DO (No: ${res.deletedDocs.join(', ')}) yang ada di Transaksi Keluar telah otomatis terhapus dari DO OPEN.`);
        }
      } else if (res && res.deletedCount === 0) {
        alert('Rekonsiliasi Selesai. Tidak ada No DO di DO OPEN yang terekam di Transaksi Keluar.');
      }
    } catch (err: any) {
      console.error(err);
      alert(`Gagal rekonsiliasi: ${err.message || 'Error'}`);
    } finally {
      setIsReconciling(false);
    }
  };

  // Single Item Request DO OPEN
  const handleSingleRequestDoOpen = async (record: DoOpenRecord) => {
    const docNoUpper = (record.documentNo || '').trim().toUpperCase();
    const reqInfo = requestedDoMap.get(docNoUpper);
    if (reqInfo) {
      alert(`No DO ${record.documentNo} sudah pernah di-request kirim pada tanggal ${formatDateDisplay(reqInfo.requestKirimDate)} dan tidak dapat di-request lagi.`);
      return;
    }

    // Find all matching lines with the same No DO to request all lines at once
    const matchingLines = records.filter(r => (r.documentNo || '').trim().toUpperCase() === docNoUpper);
    const linesToProcess = matchingLines.length > 0 ? matchingLines : [record];

    // Keterangan gak bisa diubah lagi setelah request dibuat (snapshot sekali
    // ambil) — ingetin dulu kalau masih kosong. Klik Request di 1 baris ikut
    // me-request SEMUA baris dengan No DO yang sama (linesToProcess), jadi
    // hitung per-item yang masih kosong supaya jelas bukan cuma baris yang
    // diklik yang dicek.
    const emptyKeteranganLines = linesToProcess.filter(l => !l.keterangan || l.keterangan.trim() === '' || l.keterangan.trim() === '-');
    if (emptyKeteranganLines.length > 0) {
      const confirmed = window.confirm(`No DO ini punya ${linesToProcess.length} item, dan ${emptyKeteranganLines.length} di antaranya Keterangan-nya masih kosong. Yakin mau lanjut kirim Request untuk semua item?\n\nKeterangan tidak bisa diubah lagi setelah request dikirim.`);
      if (!confirmed) return;
    }

    setIsSubmittingRequest(true);
    const todayIso = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();
    const userIdentifier = currentUser?.displayName || currentUser?.email || 'User Operational';

    try {
      const createdRequests: RequestDoRecord[] = [];

      for (const lineItem of linesToProcess) {
        const reqRecordPayload: RequestDoRecord = {
          id: generateUUID(),
          doOpenId: lineItem.id || '',
          postingDate: lineItem.postingDate || todayIso,
          entryName: lineItem.entryName || 'Sales Admin RM',
          documentNo: lineItem.documentNo,
          noDosl: lineItem.noDosl || '-',
          itemCode: lineItem.itemCode,
          category: lineItem.category || 'DO SUDAH DI LOGISTIK',
          remark: lineItem.remark || 'SPV Logistik Area',
          qty: Number(lineItem.qty) || 0,
          fromLocation: lineItem.fromLocation || '',
          toLocation: lineItem.toLocation || '',
          keterangan: lineItem.keterangan || '-',
          requestedBy: userIdentifier,
          requestedAt: nowIso,
          requestKirimDate: todayIso,
          status: 'PENDING'
        };
        createdRequests.push(reqRecordPayload);
      }

      // 1. Primary DB: Insert to Supabase
      await bulkAddRequestDoOpen(createdRequests);

      // 2. Backup DB: Firestore (only if quota not exceeded)
      if (!isFirestoreQuotaExceeded) {
        for (const reqItem of createdRequests) {
          try {
            await addDoc(collection(db, COLLECTIONS.REQUEST_DO_OPEN), reqItem);
          } catch (e) {
            console.warn("Firestore addDoc notice:", e);
          }
          if (reqItem.doOpenId) {
            try {
              await setDoc(doc(db, COLLECTIONS.DO_OPEN, reqItem.doOpenId), {
                requestKirimDate: todayIso,
                requestKirimAt: nowIso,
                requestKirimBy: userIdentifier
              }, { merge: true });
            } catch (e) {
              console.warn(`Could not update DO OPEN doc ${reqItem.doOpenId}:`, e);
            }
          }
        }
      }

      if (onRequestDoOpenCreate && createdRequests.length > 0) {
        onRequestDoOpenCreate(createdRequests);
      }

      setRequestSuccessNotice(`Berhasil membuat Request Kirim DO OPEN untuk No DO: ${record.documentNo} (${formatDateDisplay(todayIso)})! Permintaan telah otomatis muncul di Menu Request DO OPEN secara real-time.`);
      setTimeout(() => setRequestSuccessNotice(null), 8000);
    } catch (err: any) {
      console.error(err);
      alert(`Gagal mengirim Request DO OPEN: ${err.message || 'Error'}`);
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  // Bulk REQUEST DO OPEN ACTION
  const handleRequestDoOpenBulk = async () => {
    if (selectedIds.length === 0) {
      // Open modal if no checkboxes selected
      setIsRequestModalOpen(true);
      return;
    }

    const selectedRecords = records.filter(r => selectedIds.includes(r.id!));
    
    // Check if any selected records are already requested
    const unrequestedRecords = selectedRecords.filter(r => {
      const docNoUpper = (r.documentNo || '').trim().toUpperCase();
      return !requestedDoMap.has(docNoUpper);
    });

    if (unrequestedRecords.length === 0) {
      alert("Semua No DO yang Anda pilih sudah pernah di-request kirim sebelumnya.");
      return;
    }

    // Keterangan gak bisa diubah lagi setelah request dibuat — ingetin dulu
    // kalau ada yang masih kosong di antara yang mau di-request.
    const emptyKeteranganCount = unrequestedRecords.filter(r => !r.keterangan || r.keterangan.trim() === '' || r.keterangan.trim() === '-').length;
    if (emptyKeteranganCount > 0) {
      const confirmed = window.confirm(`${emptyKeteranganCount} dari ${unrequestedRecords.length} No DO yang dipilih Keterangan-nya masih kosong. Yakin mau lanjut kirim Request?\n\nKeterangan tidak bisa diubah lagi setelah request dikirim.`);
      if (!confirmed) return;
    }

    setIsSubmittingRequest(true);
    setRequestSuccessNotice(null);
    const todayIso = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();
    const userIdentifier = currentUser?.displayName || currentUser?.email || 'User Operational';
    const createdRequests: RequestDoRecord[] = [];

    try {
      for (const item of unrequestedRecords) {
        const reqRecordPayload: RequestDoRecord = {
          id: generateUUID(),
          doOpenId: item.id || '',
          postingDate: item.postingDate || todayIso,
          entryName: item.entryName || 'Sales Admin RM',
          documentNo: item.documentNo,
          noDosl: item.noDosl || '-',
          itemCode: item.itemCode,
          category: item.category || 'DO SUDAH DI LOGISTIK',
          remark: item.remark || '',
          qty: Number(item.qty) || 0,
          fromLocation: item.fromLocation || '',
          toLocation: item.toLocation || '',
          keterangan: item.keterangan || '-',
          requestedBy: userIdentifier,
          requestedAt: nowIso,
          requestKirimDate: todayIso,
          status: 'PENDING'
        };
        createdRequests.push(reqRecordPayload);
      }

      // 1. Primary DB: Insert all to Supabase in 1 batch
      await bulkAddRequestDoOpen(createdRequests);

      // 2. Backup DB: Firestore (only if quota not exceeded)
      if (!isFirestoreQuotaExceeded) {
        for (const reqItem of createdRequests) {
          try {
            await addDoc(collection(db, COLLECTIONS.REQUEST_DO_OPEN), reqItem);
          } catch (e) {
            console.warn("Firestore addDoc notice:", e);
          }
          if (reqItem.doOpenId) {
            try {
              await setDoc(doc(db, COLLECTIONS.DO_OPEN, reqItem.doOpenId), {
                requestKirimDate: todayIso,
                requestKirimAt: nowIso,
                requestKirimBy: userIdentifier
              }, { merge: true });
            } catch (e) {
              console.warn(`Could not update DO OPEN doc ${reqItem.doOpenId}:`, e);
            }
          }
        }
      }

      if (onRequestDoOpenCreate && createdRequests.length > 0) {
        onRequestDoOpenCreate(createdRequests);
      }

      setSelectedIds([]);
      const createdCount = createdRequests.length;
      const skippedCount = selectedRecords.length - unrequestedRecords.length;
      const skippedMsg = skippedCount > 0 ? ` (${skippedCount} item dilewati karena sudah di-request sebelumnya)` : '';
      setRequestSuccessNotice(`Berhasil membuat ${createdCount} Request DO OPEN! Permintaan telah otomatis dikirim ke Menu Request DO OPEN secara real-time.${skippedMsg}`);
      setTimeout(() => setRequestSuccessNotice(null), 8000);

    } catch (err: any) {
      console.error(err);
      alert(`Gagal mengirim Request DO OPEN: ${err.message || 'Error'}`);
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  // Save Modal Request DO OPEN Form
  const handleSaveModalRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqDocumentNo.trim() || !reqItemCode.trim() || !reqQty || Number(reqQty) <= 0) {
      setReqError('No DO (DocumentNo), Item Code, dan Qty (>0) wajib diisi.');
      return;
    }

    const docNoUpper = reqDocumentNo.trim().toUpperCase();
    const reqInfo = requestedDoMap.get(docNoUpper);
    if (reqInfo) {
      setReqError(`No DO ${reqDocumentNo.trim()} sudah pernah di-request kirim pada tanggal ${formatDateDisplay(reqInfo.requestKirimDate)} dan tidak dapat di-request lagi.`);
      return;
    }

    setIsSubmittingRequest(true);
    setReqError(null);
    const todayIso = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();
    const userIdentifier = currentUser?.displayName || currentUser?.email || 'User Operational';

    try {
      const reqRecordPayload: RequestDoRecord = {
        id: generateUUID(),
        doOpenId: reqDoOpenId || '',
        postingDate: reqPostingDate,
        entryName: reqEntryName.trim(),
        documentNo: reqDocumentNo.trim(),
        itemCode: reqItemCode.trim(),
        category: reqCategory.trim(),
        remark: reqRemark.trim(),
        qty: Number(reqQty),
        fromLocation: reqFromLocation.trim(),
        toLocation: reqToLocation.trim(),
        requestedBy: userIdentifier,
        requestedAt: nowIso,
        requestKirimDate: todayIso,
        status: 'PENDING',
        keterangan: reqKeterangan.trim()
      };

      // 1. Primary DB — WAJIB cek hasilnya, addRequestDoOpen balikin
      // true/false (bukan throw) kalau gagal, jadi kalau tidak dicek,
      // request yang gagal simpan tetap keliatan "berhasil" di layar
      // padahal tidak pernah masuk database (bug yang baru ditemukan).
      const savedOk = await addRequestDoOpen(reqRecordPayload);
      if (!savedOk) {
        throw new Error('Server menolak permintaan (sesi mungkin sudah kedaluwarsa, coba login ulang).');
      }

      // 2. Backup DB: Firestore (if quota not exceeded)
      if (!isFirestoreQuotaExceeded) {
        try {
          await addDoc(collection(db, COLLECTIONS.REQUEST_DO_OPEN), reqRecordPayload);
        } catch (e) {
          console.warn("Firestore addDoc notice:", e);
        }

        const matchingInRecords = records.filter(r => (r.documentNo || '').trim().toUpperCase() === docNoUpper);
        for (const lineItem of matchingInRecords) {
          if (lineItem.id) {
            try {
              await setDoc(doc(db, COLLECTIONS.DO_OPEN, lineItem.id), {
                requestKirimDate: todayIso,
                requestKirimAt: nowIso,
                requestKirimBy: userIdentifier
              }, { merge: true });
            } catch (e) {
              console.warn(`Could not update DO OPEN doc ${lineItem.id}:`, e);
            }
          }
        }
      }

      if (onRequestDoOpenCreate) {
        onRequestDoOpenCreate([reqRecordPayload]);
      }

      setIsRequestModalOpen(false);
      setRequestSuccessNotice(`Berhasil membuat Request DO OPEN untuk No DO: ${reqDocumentNo.trim()}! Permintaan telah dikirim ke Menu Request DO OPEN secara real-time.`);
      setTimeout(() => setRequestSuccessNotice(null), 8000);

      // Reset form
      setReqDocumentNo('');
      setReqItemCode('');
      setReqQty(1);
      setReqDoOpenId('');
      setReqKeterangan('');
    } catch (err: any) {
      console.error(err);
      setReqError(`Gagal mengirim Request DO OPEN: ${err.message || 'Error'}`);
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  // Add Record
  const handleSaveRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!documentNo.trim() || !itemCode.trim() || !qty || Number(qty) <= 0) {
      setFormError('No DO (DocumentNo), Item Code, dan Qty (>0) wajib diisi.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      const newDoOpenRecord = {
        postingDate,
        entryName: entryName.trim(),
        documentNo: documentNo.trim(),
        noDosl: noDosl.trim() || '-',
        itemCode: itemCode.trim(),
        category: category.trim(),
        remark: remark.trim(),
        qty: Number(qty),
        fromLocation: fromLocation.trim(),
        toLocation: toLocation.trim(),
        keterangan: keterangan.trim() || '-',
        createdAt: new Date().toISOString()
      };

      if (!isFirestoreQuotaExceeded) {
        try {
          await addDoc(collection(db, COLLECTIONS.DO_OPEN), newDoOpenRecord);
        } catch (e) {
          console.warn('Firestore addDoc DO_OPEN notice:', e);
        }
      }

      try {
        await addDoOpen(newDoOpenRecord);
      } catch (errSup) {
        console.warn('Notice: addDoOpen to Supabase:', errSup);
      }

      await autoReconcileDoOpen();
      setIsAddModalOpen(false);
    } catch (err: any) {
      console.error(err);
      setFormError(`Gagal menyimpan data: ${err.message || 'Error'}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Export Excel
  const handleExport = () => {
    const exportData = sortedRecords.map(r => {
      const m = masterMap.get(r.itemCode);
      const hjSatuan = m?.hargaJual || 0;
      const hbSatuan = m?.hargaBeli || 0;
      const totalNilaiJual = (Number(r.qty) || 0) * hjSatuan;
      const totalNilaiBeli = (Number(r.qty) || 0) * hbSatuan;

      return {
        PostingDate: r.postingDate,
        'Area RM OPR': r.entryName,
        DocumentNo: r.documentNo,
        'No DOSL': r.noDosl || '-',
        ItemCode: r.itemCode,
        'Item Name': m?.itemName || '-',
        'Group Name': m?.groupName || 'Tanpa Group',
        'Status DO OPEN': r.category,
        'Area SPV OPR': r.remark,
        Qty: r.qty,
        'Harga Jual': hjSatuan,
        'Total Harga Jual': totalNilaiJual,
        'Harga Beli': hbSatuan,
        'Total Harga Beli': totalNilaiBeli,
        From: r.fromLocation,
        To: r.toLocation,
        Keterangan: r.keterangan || '-'
      };
    });
    exportToExcel(exportData, 'DO_OPEN_Gudang', 'DO OPEN');
  };

  // Delete Selected
  const handleDeleteSelected = () => {
    if (!selectedIds.length) return;
    onRequestDeleteConfirm(
      'Hapus DO OPEN Terpilih',
      `Apakah Anda yakin ingin menghapus ${selectedIds.length} data DO OPEN tercentang?`,
      async () => {
        await bulkDeleteDocs(COLLECTIONS.DO_OPEN, selectedIds);
        for (const id of selectedIds) {
          try {
            await deleteDoOpen(id);
          } catch (e) {
            console.warn('Error deleting DO OPEN from Supabase:', e);
          }
        }
        setSelectedIds([]);
      },
      false,
      selectedIds.length
    );
  };

  // Delete All
  const handleDeleteAll = () => {
    onRequestDeleteConfirm(
      'Hapus Seluruh Data DO OPEN',
      'Apakah Anda yakin ingin menghapus SELURUH data DO OPEN di database?',
      async () => {
        await clearCollectionDocs(COLLECTIONS.DO_OPEN);
        await clearSupabaseTable('do_open');
        saveLocalCache(COLLECTIONS.DO_OPEN, [], true);
        setSelectedIds([]);
      },
      true,
      records.length
    );
  };

  // Delete Single
  const handleDeleteSingle = (id: string, docNo: string) => {
    onRequestDeleteConfirm(
      'Hapus DO OPEN',
      `Hapus data DO OPEN nomor ${docNo}?`,
      async () => {
        if (!isFirestoreQuotaExceeded) {
          try {
            await deleteDoc(doc(db, COLLECTIONS.DO_OPEN, id));
          } catch (e) {
            console.warn('Firestore deleteDoc DO_OPEN notice:', e);
          }
        }
        if (id) {
          try {
            await deleteDoOpen(id);
          } catch (e) {
            console.warn('Error deleting DO OPEN from Supabase:', e);
          }
        }
      },
      false,
      1
    );
  };

  return (
    <div className="space-y-4">
      
      {/* Header View */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded-lg border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Clock className="w-4.5 h-4.5 text-amber-600" />
            DO OPEN (Pending Delivery Orders)
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Monitor & ajukan Request DO OPEN yang sudah di area Logistik untuk diposting pengiriman.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Prominent Request DO OPEN Button */}
          <button
            onClick={handleRequestDoOpenBulk}
            disabled={isSubmittingRequest}
            className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded shadow-xs transition"
            title="Ajukan Request DO OPEN terpilih ke PIC Gudang"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Request DO OPEN {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}</span>
          </button>

          {!isOprRole && (
            <button
              onClick={handleRunReconciliation}
              disabled={isReconciling}
              className="flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded shadow-xs transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isReconciling ? 'animate-spin' : ''}`} />
              Cek Rekonsiliasi DO
            </button>
          )}

          {!isOprRole && (
            <button
              onClick={() => setIsReportDoOpenOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded shadow-xs transition"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Report DO OPEN
            </button>
          )}

          {!isOprRole && (
            <button
              onClick={() => {
                setDocumentNo(`DO-2026-${Math.floor(100 + Math.random() * 900)}`);
                setIsAddModalOpen(true);
              }}
              className="flex items-center gap-1 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded shadow-xs transition"
            >
              <Plus className="w-3.5 h-3.5" />
              Input DO OPEN
            </button>
          )}

          {!isOprRole && (
            <button
              onClick={onOpenImport}
              className="flex items-center gap-1 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded shadow-xs transition"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-amber-400" />
              Import Excel
            </button>
          )}

          <button
            onClick={handleExport}
            className="flex items-center gap-1 px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded transition border border-slate-300"
          >
            <Download className="w-3.5 h-3.5" />
            Export Excel
          </button>
        </div>
      </div>

      {/* Request Success Alert Banner */}
      {requestSuccessNotice && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-lg text-xs font-semibold flex items-center justify-between shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{requestSuccessNotice}</span>
          </div>
          <button onClick={() => setRequestSuccessNotice(null)} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* DASHBOARD SUMMARY PANEL (MINIMIZABLE) */}
      <div className="bg-amber-50/40 border border-amber-200/80 rounded-xl overflow-hidden shadow-2xs transition-all">
        {/* Dashboard Header Bar with Minimize/Expand Toggle */}
        <button 
          type="button"
          onClick={() => setIsDashboardMinimized(prev => !prev)}
          className={`w-full bg-gradient-to-r from-amber-100/80 via-white to-amber-50/80 p-2.5 sm:p-3 flex items-center justify-between cursor-pointer select-none transition hover:bg-amber-100/90 text-left ${
            !isDashboardMinimized ? 'border-b border-amber-200/60' : ''
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="p-1.5 bg-amber-500/10 text-amber-700 rounded-lg shrink-0">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0">
              <span className="text-xs font-bold text-amber-950 uppercase tracking-wider shrink-0">
                Dashboard Summary DO OPEN
              </span>
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300 rounded-full shrink-0">
                {dashboardSummary.totalUniqueDo} DO | {dashboardSummary.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs
              </span>
              <span className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-mono font-bold bg-blue-100 text-blue-900 border border-blue-300 rounded-full shrink-0">
                {showJualOnly
                  ? `Total Nilai Jual: Rp ${dashboardSummary.totalNilaiJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`
                  : `Total Nilai Harga Beli: Rp ${dashboardSummary.totalNilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-100/90 hover:bg-amber-200 px-2.5 py-1.5 rounded-lg border border-amber-300/80 transition shrink-0 ml-2 shadow-2xs">
            {isDashboardMinimized ? (
              <>
                <ChevronDown className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span className="whitespace-nowrap">Buka Dashboard</span>
              </>
            ) : (
              <>
                <ChevronUp className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span className="whitespace-nowrap">Minimize</span>
              </>
            )}
          </div>
        </button>

        {/* Collapsible Content */}
        {!isDashboardMinimized && (
          <div className="p-3 space-y-3 bg-white/60">
            {/* GRID SUMMARY CARDS */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              
              {/* Total Records & Qty */}
              <div className="bg-white p-3 rounded-lg border border-amber-200 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">Total DO OPEN (Filter)</span>
                  <div className="p-1 bg-amber-100 text-amber-700 rounded">
                    <Clock className="w-3.5 h-3.5" />
                  </div>
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-base font-bold font-mono text-amber-900">
                    {dashboardSummary.totalUniqueDo.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                  </span>
                  <span className="text-[10px] text-slate-500 font-medium">DO</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5 font-medium">
                  Total Qty: <strong className="text-amber-800 font-mono">{dashboardSummary.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</strong> pcs
                </div>
              </div>

              {/* Total Nilai (Harga Beli / Jual, tergantung role) */}
              <div className="bg-white p-3 rounded-lg border border-blue-200 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">
                    {showJualOnly ? 'Total Nilai (Jual)' : 'Total Nilai (Harga Beli)'}
                  </span>
                  <div className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-bold font-mono text-[10px]">
                    Rp
                  </div>
                </div>
                <div className="mt-1">
                  <span className="text-base font-bold font-mono text-blue-800">
                    Rp {(showJualOnly ? dashboardSummary.totalNilaiJual : dashboardSummary.totalNilaiBeli).toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div className="text-[10px] text-blue-600 mt-0.5">
                  {showJualOnly ? 'Nilai Jual Barang DO' : 'Nilai Modal Barang DO'}
                </div>
              </div>

              {/* Total Nilai Jual — kartu tambahan, cuma buat role yang sudah lihat
                  Harga Beli juga (Admin/Audit). OPR/Team Gudang cukup satu kartu di
                  atas (sudah nilai jual duluan), gak perlu kartu ganda. */}
              {!showJualOnly && (
                <div className="bg-white p-3 rounded-lg border border-emerald-200 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">Total Nilai (Jual)</span>
                    <div className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-bold font-mono text-[10px]">
                      Rp
                    </div>
                  </div>
                  <div className="mt-1">
                    <span className="text-base font-bold font-mono text-emerald-800">
                      Rp {dashboardSummary.totalNilaiJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  <div className="text-[10px] text-emerald-600 mt-0.5">
                    Nilai Jual Barang DO
                  </div>
                </div>
              )}

              {/* Status Logistik Breakdown */}
              <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Status Barang</span>
                  <Truck className="w-3.5 h-3.5 text-slate-500" />
                </div>
                <div className="mt-1 space-y-1 text-[11px]">
                  <div className="flex items-center justify-between text-emerald-800 font-medium">
                    <span>Sudah di Logistik:</span>
                    <span className="font-mono font-bold">{dashboardSummary.countSudahLogistik} DO ({dashboardSummary.qtySudahLogistik} pcs)</span>
                  </div>
                  <div className="flex items-center justify-between text-amber-800 font-medium">
                    <span>Masih di Area QC:</span>
                    <span className="font-mono font-bold">{dashboardSummary.countQC} DO ({dashboardSummary.qtyQC} pcs)</span>
                  </div>
                </div>
              </div>

            </div>

            {/* DASHBOARD GROUP NAME BREAKDOWN */}
            <div className="bg-white p-3.5 rounded-lg border border-amber-200/80 shadow-2xs space-y-2">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-amber-600" />
                  <span className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                    Dashboard DO OPEN Berdasarkan Group Name ({groupNameBreakdown.length} Group)
                  </span>
                </div>
                {selectedGroupName && (
                  <button
                    onClick={() => setSelectedGroupName('')}
                    className="text-[10px] font-bold text-amber-700 hover:text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-300 flex items-center gap-1 transition cursor-pointer"
                  >
                    <span>Filter Active: <strong>{selectedGroupName}</strong></span>
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {groupNameBreakdown.length === 0 ? (
                <div className="text-center py-2 text-slate-400 text-xs">Tidak ada data Group Name untuk ditampilkan.</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 pt-1">
                  {groupNameBreakdown.map((g) => {
                    const isSelected = selectedGroupName === g.groupName;
                    return (
                      <div
                        key={g.groupName}
                        onClick={() => setSelectedGroupName(isSelected ? '' : g.groupName)}
                        className={`p-2.5 rounded-lg border cursor-pointer transition flex flex-col justify-between ${
                          isSelected
                            ? 'bg-amber-600 text-white border-amber-700 shadow-sm'
                            : 'bg-slate-50 hover:bg-amber-50/70 border-slate-200 text-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className={`text-[11px] font-bold truncate ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                            {g.groupName}
                          </span>
                          <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-bold shrink-0 ${
                            isSelected ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {g.docCount} DO
                          </span>
                        </div>
                        <div className="text-[10px] space-y-0.5">
                          <div className={`flex justify-between font-mono ${isSelected ? 'text-amber-100' : 'text-slate-600'}`}>
                            <span>Qty:</span>
                            <span className="font-bold">{g.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                          </div>
                          <div className={`flex justify-between font-mono ${isSelected ? 'text-amber-100' : 'text-slate-500'}`}>
                            <span>Items:</span>
                            <span>{g.recordCount} baris</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* DROPDOWN FILTERS SECTION (MINIMIZABLE) */}
      {/* Sengaja TIDAK overflow-hidden di sini — beda dari panel Dashboard Summary
          di atas, panel ini isinya ada dropdown SearchableSelect yang popup-nya
          position:absolute, ke-clip kalau parent overflow-hidden. */}
      <div className="bg-slate-900 text-slate-200 rounded-lg border border-slate-800 shadow-md">
        <button
          type="button"
          onClick={() => setIsFilterMinimized(prev => !prev)}
          className={`w-full flex flex-wrap items-center justify-between gap-2 p-3.5 text-left cursor-pointer select-none hover:bg-slate-800/60 transition rounded-t-lg ${
            !isFilterMinimized ? 'border-b border-slate-800' : 'rounded-b-lg'
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wider">
            <Filter className="w-3.5 h-3.5 text-blue-400" />
            <span>Filter DO OPEN (Drop Down Method)</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); handleResetFilters(); }}
              className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded transition border cursor-pointer ${
                (selectedAreaRm || selectedAreaSpv || selectedStatus || selectedToLocation || selectedGroupName || searchQuery || startDate || endDate)
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 border-amber-400 shadow-sm'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
              title="Reset semua filter ke kondisi awal"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Filter</span>
            </span>

            <span className="flex items-center gap-1 text-[11px] font-bold text-slate-200 bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 rounded-lg border border-slate-700 transition shadow-2xs">
              {isFilterMinimized ? (
                <>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-300" />
                  <span className="whitespace-nowrap">Buka Filter</span>
                </>
              ) : (
                <>
                  <ChevronUp className="w-3.5 h-3.5 text-slate-300" />
                  <span className="whitespace-nowrap">Minimize</span>
                </>
              )}
            </span>
          </div>
        </button>

        {!isFilterMinimized && (
          <div className="p-3.5 space-y-3">
            {/* Grid of Dropdowns */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5 text-xs">

              {/* Dropdown 1: Area RM OPR */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1">Area RM OPR (EntryName)</label>
                <SearchableSelect
                  value={selectedAreaRm}
                  onChange={setSelectedAreaRm}
                  options={areaRmOptions}
                  placeholder="-- Semua Area RM OPR --"
                />
              </div>

              {/* Dropdown 2: Area SPV OPR */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1">Area SPV OPR (Remark)</label>
                <SearchableSelect
                  value={selectedAreaSpv}
                  onChange={setSelectedAreaSpv}
                  options={areaSpvOptions}
                  placeholder="-- Semua Area SPV OPR --"
                />
              </div>

              {/* Dropdown 3: Status DO OPEN */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1">Status / Posisi Barang</label>
                <SearchableSelect
                  value={selectedStatus}
                  onChange={setSelectedStatus}
                  options={statusFilterOptions}
                  placeholder="-- Semua Status / Posisi Barang --"
                />
              </div>

              {/* Dropdown 4: Group Name */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1">Group Name (Group Barang)</label>
                <SearchableSelect
                  value={selectedGroupName}
                  onChange={setSelectedGroupName}
                  options={groupNameOptions}
                  placeholder="-- Semua Group Name --"
                />
              </div>

              {/* Dropdown 5: Destination (To) */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1">Tujuan (To Location)</label>
                <SearchableSelect
                  value={selectedToLocation}
                  onChange={setSelectedToLocation}
                  options={toLocationOptions}
                  placeholder="-- Semua Tujuan (To) --"
                />
              </div>

            </div>

            {/* Free Text Search, Date Filters & Menu Sort Row */}
            <div className="pt-2 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1">Cari Kata Kunci (Pencarian Bebas)</label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari No DO, Item Code, dsb..."
                    className="w-full pl-8 pr-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1">Dari Tanggal (PostingDate)</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1">Sampai Tanggal (PostingDate)</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Menu Sort / Dropdown Urutkan Posting Date */}
              <div>
                <label className="block text-[10px] font-bold text-amber-400 mb-1 flex items-center gap-1">
                  <ArrowUpDown className="w-3 h-3 text-amber-400" />
                  Menu Sort (Posting Date)
                </label>
                <select
                  value={
                    sortConfig.key === 'postingDate'
                      ? sortConfig.direction === 'desc'
                        ? 'postingDate_desc'
                        : 'postingDate_asc'
                      : sortConfig.key === 'documentNo'
                      ? sortConfig.direction === 'asc'
                        ? 'documentNo_asc'
                        : 'documentNo_desc'
                      : sortConfig.key === 'qty'
                      ? sortConfig.direction === 'desc'
                        ? 'qty_desc'
                        : 'qty_asc'
                      : 'custom'
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'postingDate_desc') {
                      setSortConfig({ key: 'postingDate', direction: 'desc' });
                    } else if (val === 'postingDate_asc') {
                      setSortConfig({ key: 'postingDate', direction: 'asc' });
                    } else if (val === 'documentNo_asc') {
                      setSortConfig({ key: 'documentNo', direction: 'asc' });
                    } else if (val === 'documentNo_desc') {
                      setSortConfig({ key: 'documentNo', direction: 'desc' });
                    } else if (val === 'qty_desc') {
                      setSortConfig({ key: 'qty', direction: 'desc' });
                    } else if (val === 'qty_asc') {
                      setSortConfig({ key: 'qty', direction: 'asc' });
                    }
                  }}
                  className="w-full px-2.5 py-1.5 bg-slate-800 border border-amber-500/60 rounded text-amber-300 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer shadow-xs"
                >
                  <option value="postingDate_desc">📅 Posting Date Terbaru (Teratas)</option>
                  <option value="postingDate_asc">📅 Posting Date Terlama (Teratas)</option>
                  <option value="documentNo_asc">📦 No DO / DocNo (A - Z)</option>
                  <option value="documentNo_desc">📦 No DO / DocNo (Z - A)</option>
                  <option value="qty_desc">📊 Qty Terbanyak</option>
                  <option value="qty_asc">📊 Qty Tersedikit</option>
                  {sortConfig.key !== 'postingDate' && sortConfig.key !== 'documentNo' && sortConfig.key !== 'qty' && (
                    <option value="custom" disabled>
                      [Urutkan: {sortConfig.key} ({sortConfig.direction?.toUpperCase()})]
                    </option>
                  )}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bulk Action Controls */}
      {selectedIds.length > 0 && (
        <div className="p-2.5 bg-amber-50 border border-amber-300 rounded flex flex-wrap items-center justify-between gap-2 text-xs animate-in fade-in">
          <span className="font-semibold text-amber-900">
            Terpilih {selectedIds.length} DO OPEN dari tabel
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRequestDoOpenBulk}
              disabled={isSubmittingRequest}
              className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded shadow-xs transition"
            >
              <Send className="w-3.5 h-3.5" />
              {isSubmittingRequest ? 'Mengirim Request...' : 'Request DO OPEN Terpilih'}
            </button>
            {canDelete && (
              <button
                onClick={handleDeleteSelected}
                className="flex items-center gap-1 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Hapus Terpilih
              </button>
            )}
          </div>
        </div>
      )}

      {/* Table Card */}
      <div className="bg-white rounded border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between bg-slate-100/70">
          <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
            Daftar DO OPEN ({sortedRecords.length})
          </span>

          {canDelete && (
            <button
              onClick={handleDeleteAll}
              disabled={records.length === 0}
              className="flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-40"
            >
              <Trash2 className="w-3 h-3" />
              Hapus Semua Data
            </button>
          )}
        </div>

        <div className="overflow-x-auto max-h-[calc(100vh-280px)]">
          <table className="w-full text-left data-grid text-[11px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="p-2 text-center w-8">
                  <button onClick={handleSelectAll} className="text-slate-400 hover:text-slate-600">
                    {selectedIds.length === sortedRecords.length && sortedRecords.length > 0 ? (
                      <CheckSquare className="w-3.5 h-3.5 text-amber-600" />
                    ) : (
                      <Square className="w-3.5 h-3.5" />
                    )}
                  </button>
                </th>

                <SortableHeader
                  label="PostingDate"
                  field="postingDate"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />

                <SortableHeader
                  label="Area RM OPR"
                  field="entryName"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />

                <SortableHeader
                  label="No DO (DocNo)"
                  field="documentNo"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />

                <SortableHeader
                  label="No DOSL"
                  field="noDosl"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />

                <SortableHeader
                  label="ItemCode"
                  field="itemCode"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />

                <th className="p-2 text-center w-14">Foto</th>

                <SortableHeader
                  label="Item Name"
                  field="itemName"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />

                <SortableHeader
                  label="Group Name"
                  field="groupName"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />

                <SortableHeader
                  label="Status DO OPEN"
                  field="category"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />

                <SortableHeader
                  label="Area SPV OPR"
                  field="remark"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />

                <SortableHeader
                  label="Qty"
                  field="qty"
                  align="right"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />

                <SortableHeader
                  label="Harga Jual"
                  field="hargaJual"
                  align="right"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />

                <SortableHeader
                  label="Total Harga Jual"
                  field="totalHargaJual"
                  align="right"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />

                {!showJualOnly && (
                  <>
                    <SortableHeader
                      label="Harga Beli"
                      field="hargaBeli"
                      align="right"
                      currentSortKey={sortConfig.key}
                      currentDirection={sortConfig.direction}
                      onSort={handleSort}
                    />

                    <SortableHeader
                      label="Total Harga Beli"
                      field="totalHargaBeli"
                      align="right"
                      currentSortKey={sortConfig.key}
                      currentDirection={sortConfig.direction}
                      onSort={handleSort}
                    />
                  </>
                )}

                <SortableHeader
                  label="From"
                  field="fromLocation"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />

                <SortableHeader
                  label="To"
                  field="toLocation"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />

                <SortableHeader
                  label="Keterangan"
                  field="keterangan"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />

                <th className="p-2 text-center w-24">Aksi</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {paginatedRecords.length === 0 ? (
                <tr>
                  <td colSpan={showJualOnly ? 17 : 19} className="p-6 text-center text-slate-400 text-xs">
                    Tidak ada data DO OPEN yang memenuhi filter.
                  </td>
                </tr>
              ) : (
                paginatedRecords.map((r) => {
                  const isSelected = selectedIds.includes(r.id!);
                  const isLogistik = getDoOpenLogistikGroup(r.category) === 'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)';

                  const m = masterMap.get(r.itemCode);
                  const nilaiJual = (Number(r.qty) || 0) * (m?.hargaJual || 0);
                  const nilaiBeli = (Number(r.qty) || 0) * (m?.hargaBeli || 0);

                  const docNoUpper = (r.documentNo || '').trim().toUpperCase();
                  const reqInfo = requestedDoMap.get(docNoUpper);
                  const isAlreadyRequested = Boolean(reqInfo);

                  return (
                    <tr 
                      key={r.id} 
                      className={`hover:bg-slate-50 transition ${isSelected ? 'bg-amber-50/40' : ''}`}
                    >
                      <td className="p-2 text-center">
                        <button 
                          onClick={() => handleToggleSelect(r.id!)}
                          className="text-slate-400 hover:text-amber-600"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-3.5 h-3.5 text-amber-600" />
                          ) : (
                            <Square className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </td>
                      <td className="p-2 font-mono text-slate-600">{r.postingDate}</td>
                      <td className="p-2 font-medium text-slate-800">{r.entryName || '-'}</td>
                      <td className="p-2 font-mono font-bold text-amber-800">
                        <div className="flex flex-col items-start gap-0.5">
                          <span>{r.documentNo}</span>
                          {isAlreadyRequested && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-extrabold rounded bg-indigo-50 text-indigo-700 border border-indigo-200/80 shadow-2xs">
                              <Send className="w-2.5 h-2.5 text-indigo-600 shrink-0" />
                              <span>Req Kirim: {formatDateDisplay(reqInfo?.requestKirimDate)}</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-2 font-mono font-semibold text-slate-700">
                        <span>{r.noDosl || '-'}</span>
                      </td>
                      <td className="p-2 font-mono font-bold text-slate-800">{r.itemCode}</td>
                      <td className="p-2 text-center">
                        {(() => {
                          const catPhoto = catalogPhotoMap.get(r.itemCode);
                          if (catPhoto) {
                            return (
                              <button
                                onClick={() => setActiveDoPhotoModal({
                                  photoUrl: catPhoto.photoUrl,
                                  itemCode: r.itemCode,
                                  itemName: m?.itemName || r.itemCode,
                                  notes: catPhoto.notes
                                })}
                                className="group relative inline-block cursor-pointer"
                                title={`Klik untuk memperbesar gambar produk (${r.itemCode})`}
                              >
                                <img
                                  src={catPhoto.photoUrl}
                                  alt={r.itemCode}
                                  className="w-9 h-9 object-cover rounded-md border border-slate-300 shadow-2xs group-hover:scale-110 group-hover:border-blue-500 transition duration-150 mx-auto"
                                />
                                <span className="absolute -top-1 -right-1 p-0.5 bg-blue-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition">
                                  <Eye className="w-2.5 h-2.5" />
                                </span>
                              </button>
                            );
                          } else {
                            return (
                              <button
                                onClick={() => onNavigateToCatalog && onNavigateToCatalog(r.itemCode)}
                                className="p-1 text-slate-300 hover:text-amber-600 hover:bg-amber-50 rounded transition inline-block"
                                title={`Belum ada foto untuk '${r.itemCode}'. Klik untuk upload ke Katalog.`}
                              >
                                <Camera className="w-4 h-4 mx-auto" />
                              </button>
                            );
                          }
                        })()}
                      </td>
                      <td className="p-2 font-medium text-slate-800 whitespace-nowrap">{m?.itemName || '-'}</td>
                      <td className="p-2 whitespace-nowrap">
                        <span className="inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-700 rounded border border-slate-200">
                          {m?.groupName || 'Tanpa Group'}
                        </span>
                      </td>
                      <td className="p-2">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.2 text-[10px] font-bold rounded border ${
                          isLogistik 
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}>
                          {isLogistik ? <Truck className="w-3 h-3 text-emerald-600" /> : <ShieldAlert className="w-3 h-3 text-amber-600" />}
                          {r.category || 'BELUM SHIPPING KE LOGISTIK'}
                        </span>
                      </td>
                      <td className="p-2 text-slate-600">{r.remark || '-'}</td>
                      <td className="p-2 text-right font-mono font-bold text-amber-700 text-xs">
                        {r.qty}
                      </td>
                      <td className="p-2 text-right font-mono text-emerald-700">
                        Rp {(m?.hargaJual || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-emerald-800">
                        Rp {nilaiJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                      </td>
                      {!showJualOnly && (
                        <>
                          <td className="p-2 text-right font-mono text-blue-700">
                            Rp {(m?.hargaBeli || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-blue-800">
                            Rp {nilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                          </td>
                        </>
                      )}
                      <td className="p-2 text-slate-600">{r.fromLocation || '-'}</td>
                      <td className="p-2 text-slate-600">{r.toLocation || '-'}</td>
                      <td className="p-2 text-slate-600 font-sans min-w-[150px] max-w-[220px]">
                        {editingRowId === r.id && editingField === 'keterangan' ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveInlineEdit(r.id!);
                                if (e.key === 'Escape') { setEditingRowId(null); setEditingField(null); }
                              }}
                              placeholder="Isi keterangan..."
                              className="w-full px-2 py-0.5 border border-amber-400 rounded bg-white text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveInlineEdit(r.id!)}
                              disabled={savingInline}
                              className="p-1 bg-amber-600 hover:bg-amber-700 text-white rounded shrink-0 cursor-pointer"
                              title="Simpan Keterangan"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => { setEditingRowId(null); setEditingField(null); }}
                              className="p-1 bg-slate-200 hover:bg-slate-300 text-slate-600 rounded shrink-0 cursor-pointer"
                              title="Batal"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : !canEditDoOpenFields ? (
                          <span className="truncate block font-medium text-slate-800" title={r.keterangan || '-'}>
                            {r.keterangan && r.keterangan !== '-' ? r.keterangan : '-'}
                          </span>
                        ) : (
                          <div
                            className="group flex items-center justify-between gap-1 cursor-pointer hover:bg-amber-50/80 p-1 rounded border border-transparent hover:border-amber-200 transition"
                            onClick={() => {
                              setEditingRowId(r.id!);
                              setEditingField('keterangan');
                              setEditingValue(r.keterangan || '');
                            }}
                            title="Klik untuk mengisi atau mengubah Keterangan"
                          >
                            <span className="truncate flex-1 font-medium text-slate-800" title={r.keterangan || '-'}>
                              {r.keterangan && r.keterangan !== '-' ? (
                                r.keterangan
                              ) : (
                                <span className="text-amber-600/80 italic text-[10px] font-normal flex items-center gap-1">
                                  <Pencil className="w-2.5 h-2.5" />
                                  <span>+ Isi Keterangan</span>
                                </span>
                              )}
                            </span>
                            {r.keterangan && r.keterangan !== '-' && (
                              <Pencil className="w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition shrink-0" />
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {isAlreadyRequested ? (
                            <span 
                              className="px-2 py-0.5 bg-slate-100 text-slate-500 border border-slate-200 rounded text-[10px] font-semibold flex items-center gap-1 cursor-not-allowed select-none"
                              title={`No DO ${r.documentNo} telah di-request kirim pada tanggal ${formatDateDisplay(reqInfo?.requestKirimDate)}`}
                            >
                              <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                              <span>Sudah Request</span>
                            </span>
                          ) : (
                            <button
                              onClick={() => handleSingleRequestDoOpen(r)}
                              disabled={isSubmittingRequest}
                              className="p-1 px-1.5 rounded transition text-[10px] font-bold flex items-center gap-0.5 text-indigo-700 hover:text-white hover:bg-indigo-600 bg-indigo-50 border border-indigo-200 shadow-2xs"
                              title="Kirim Request DO OPEN ke PIC Gudang"
                            >
                              <Send className="w-3 h-3" />
                              <span className="hidden sm:inline">Request</span>
                            </button>
                          )}

                          {canDelete && (
                            <button
                              onClick={() => handleDeleteSingle(r.id!, r.documentNo)}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                              title="Hapus DO OPEN"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 p-2 pt-3 text-xs text-slate-600 font-mono border-t border-slate-100 mt-1">
          <div>
            Menampilkan {sortedRecords.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1} - {Math.min(safePage * PAGE_SIZE, sortedRecords.length)} dari {sortedRecords.length.toLocaleString('id-ID', { maximumFractionDigits: 0 })} DO OPEN
          </div>
          <div className="flex items-center gap-1">
            <button
              disabled={safePage <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Prev</span>
            </button>
            <span className="px-3 py-1 bg-slate-50 border border-slate-200 rounded font-bold">
              {safePage} / {totalPages}
            </span>
            <button
              disabled={safePage >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Request DO OPEN Modal */}
      {isRequestModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 border border-slate-100 animate-in fade-in zoom-in duration-200">
            
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-lg font-bold text-indigo-900 flex items-center gap-2">
                <Send className="w-5 h-5 text-indigo-600" />
                Form Ajukan Request DO OPEN
              </h3>
              <button onClick={() => setIsRequestModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {reqError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                {reqError}
              </div>
            )}

            <form onSubmit={handleSaveModalRequest} className="mt-4 space-y-3 text-xs">
              
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Pilih Data DO OPEN (Opsional / Auto-fill)</label>
                <select
                  value={reqDoOpenId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setReqDoOpenId(id);
                    const selected = records.find(r => r.id === id);
                    if (selected) {
                      setReqDocumentNo(selected.documentNo || '');
                      setReqItemCode(selected.itemCode || '');
                      setReqQty(selected.qty || 1);
                      setReqEntryName(selected.entryName || 'Sales Admin RM');
                      setReqRemark(selected.remark || 'SPV Logistik Area');
                      setReqFromLocation(selected.fromLocation || 'Gudang Utama A');
                      setReqToLocation(selected.toLocation || 'Customer PT Konstruksi');
                      setReqCategory(selected.category || 'DO SUDAH DI LOGISTIK');
                      setReqPostingDate(selected.postingDate || new Date().toISOString().slice(0, 10));
                    }
                  }}
                  className="w-full px-3 py-2 bg-indigo-50/50 border border-indigo-200 rounded-xl font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">-- Pilih dari Daftar DO OPEN atau Isi Manual --</option>
                  {records.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.documentNo} | {r.itemCode} (Qty: {r.qty}) - {r.category}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tanggal Request *</label>
                  <input
                    type="date"
                    required
                    value={reqPostingDate}
                    onChange={(e) => setReqPostingDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">No DO (DocumentNo) *</label>
                  <input
                    type="text"
                    required
                    value={reqDocumentNo}
                    onChange={(e) => setReqDocumentNo(e.target.value)}
                    placeholder="DO-2026-901"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">ItemCode *</label>
                  <select
                    value={reqItemCode}
                    onChange={(e) => setReqItemCode(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">-- Pilih ItemCode --</option>
                    {masterItems.map(m => (
                      <option key={m.itemCode} value={m.itemCode}>
                        {m.itemCode} - {m.itemName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Qty Request *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={reqQty}
                    onChange={(e) => setReqQty(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Area RM OPR</label>
                  <input
                    type="text"
                    value={reqEntryName}
                    onChange={(e) => setReqEntryName(e.target.value)}
                    placeholder="Sales Admin RM"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Area SPV OPR</label>
                  <input
                    type="text"
                    value={reqRemark}
                    onChange={(e) => setReqRemark(e.target.value)}
                    placeholder="SPV Logistik Area"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">From</label>
                  <input
                    type="text"
                    value={reqFromLocation}
                    onChange={(e) => setReqFromLocation(e.target.value)}
                    placeholder="Gudang Utama A"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">To</label>
                  <input
                    type="text"
                    value={reqToLocation}
                    onChange={(e) => setReqToLocation(e.target.value)}
                    placeholder="Customer PT Jaya"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Keterangan / Komentar (opsional)</label>
                <textarea
                  value={reqKeterangan}
                  onChange={(e) => setReqKeterangan(e.target.value)}
                  placeholder="Catatan tambahan buat PIC Gudang, mis. alasan/urgensi request..."
                  rows={2}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsRequestModalOpen(false)}
                  className="px-4 py-2 font-medium text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRequest}
                  className="px-5 py-2 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-sm flex items-center gap-1.5"
                >
                  <Send className="w-4 h-4" />
                  {isSubmittingRequest ? 'Mengirim...' : 'Kirim Request DO OPEN'}
                </button>
              </div>

            </form>

          </div>
        </div>
      )}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 border border-slate-100 animate-in fade-in zoom-in duration-200">
            
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800">
                Input DO OPEN Baru
              </h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveRecord} className="mt-4 space-y-3 text-xs">
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">PostingDate *</label>
                  <input
                    type="date"
                    required
                    value={postingDate}
                    onChange={(e) => setPostingDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">No DO (DocumentNo) *</label>
                  <input
                    type="text"
                    required
                    value={documentNo}
                    onChange={(e) => setDocumentNo(e.target.value)}
                    placeholder="DO-2026-901"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">No DOSL</label>
                  <input
                    type="text"
                    value={noDosl}
                    onChange={(e) => setNoDosl(e.target.value)}
                    placeholder="DOSL-2026-001"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Keterangan</label>
                  <input
                    type="text"
                    value={keterangan}
                    onChange={(e) => setKeterangan(e.target.value)}
                    placeholder="Keterangan tambahan"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">ItemCode *</label>
                  <select
                    value={itemCode}
                    onChange={(e) => setItemCode(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {masterItems.map(m => (
                      <option key={m.itemCode} value={m.itemCode}>
                        {m.itemCode} - {m.itemName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Qty DO *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={qty}
                    onChange={(e) => setQty(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Area RM OPR (EntryName)</label>
                  <input
                    type="text"
                    value={entryName}
                    onChange={(e) => setEntryName(e.target.value)}
                    placeholder="Sales Admin RM"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Area SPV OPR (Remark)</label>
                  <input
                    type="text"
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                    placeholder="SPV Logistik Main Area"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Status DO OPEN (Category)</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="BELUM SHIPPING KE LOGISTIK">BELUM SHIPPING KE LOGISTIK (Area QC)</option>
                  <option value="BELUM DI RECEIPT LOGISTIK">BELUM DI RECEIPT LOGISTIK (Area QC)</option>
                  <option value="NOT POSTING SHIPPING">NOT POSTING SHIPPING (Sudah di Logistik)</option>
                  <option value="DO SUDAH DI LOGISTIK">DO SUDAH DI LOGISTIK (Sudah di Logistik)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">From (Pengirim)</label>
                  <input
                    type="text"
                    value={fromLocation}
                    onChange={(e) => setFromLocation(e.target.value)}
                    placeholder="Gudang Utama A"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">To (Tujuan)</label>
                  <input
                    type="text"
                    value={toLocation}
                    onChange={(e) => setToLocation(e.target.value)}
                    placeholder="Customer PT Jaya"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 font-medium text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition shadow-sm"
                >
                  {submitting ? 'Menyimpan...' : 'Simpan DO OPEN'}
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

      {/* REPORT DO OPEN MODAL */}
      <ReportDoOpenModal
        isOpen={isReportDoOpenOpen}
        onClose={() => setIsReportDoOpenOpen(false)}
        records={records}
        masterItems={masterItems}
      />

      {/* DO OPEN ITEM PHOTO LIGHTBOX MODAL */}
      {activeDoPhotoModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl text-white flex flex-col">
            <div className="p-3.5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 text-xs font-mono font-bold bg-blue-600 text-white rounded">
                  {activeDoPhotoModal.itemCode}
                </span>
                <span className="font-bold text-xs text-slate-100 truncate">
                  {activeDoPhotoModal.itemName}
                </span>
              </div>
              <button
                onClick={() => setActiveDoPhotoModal(null)}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-black/90 p-4 flex items-center justify-center max-h-[50vh] overflow-hidden">
              <img
                src={activeDoPhotoModal.photoUrl}
                alt={activeDoPhotoModal.itemCode}
                className="max-h-[45vh] max-w-full object-contain rounded-lg shadow-md"
              />
            </div>

            {activeDoPhotoModal.notes && (
              <div className="p-3 bg-slate-950 border-t border-slate-800 text-xs text-slate-300 italic">
                "{activeDoPhotoModal.notes}"
              </div>
            )}

            <div className="p-3 bg-slate-950 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setActiveDoPhotoModal(null)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
