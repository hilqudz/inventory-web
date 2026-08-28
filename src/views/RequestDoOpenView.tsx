import React, { useState, useMemo, useEffect } from 'react';
import { 
  Send, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  FileSpreadsheet, 
  Download, 
  Trash2, 
  Filter, 
  CheckSquare, 
  Square,
  AlertCircle,
  X,
  UserCheck,
  Plus
} from 'lucide-react';
import { RequestDoRecord, DateCategoryFilter, UserProfile, MasterItem } from '../types';
import { FilterBar } from '../components/FilterBar';
import { SortableHeader } from '../components/SortableHeader';
import { sortData, SortConfig } from '../utils/sorting';
import { exportToExcel } from '../utils/excel';
import { bulkDeleteDocs, clearCollectionDocs, COLLECTIONS, db, isFirestoreQuotaExceeded } from '../api';
import { updateDoc, setDoc, doc, deleteDoc, addDoc, collection } from 'firebase/firestore';
import { updateRequestDoOpenStatus, addRequestDoOpen, deleteRequestDoOpen, generateUUID } from '../api';

interface RequestDoOpenViewProps {
  requests: RequestDoRecord[];
  masterItems?: MasterItem[];
  currentUser: UserProfile | null;
  onOpenImport: () => void;
  onRequestDeleteConfirm: (title: string, message: string, onConfirm: () => Promise<void>, isAll?: boolean, count?: number) => void;
  onRequestStatusChange?: (allIds: string[], status: 'APPROVED' | 'REJECTED' | 'PENDING', approver: string, reason?: string) => void;
  onRequestCreate?: (newRequests: RequestDoRecord[]) => void;
  onRequestDelete?: (ids: string[]) => void;
}

export const RequestDoOpenView: React.FC<RequestDoOpenViewProps> = ({
  requests,
  masterItems = [],
  currentUser,
  onOpenImport,
  onRequestDeleteConfirm,
  onRequestStatusChange,
  onRequestCreate,
  onRequestDelete
}) => {
  const [filters, setFilters] = useState<DateCategoryFilter>({
    searchQuery: '',
    startDate: '',
    endDate: '',
    category: 'PENDING' // Default to PENDING so active queue only shows items needing action
  });

  const [selectedDocNos, setSelectedDocNos] = useState<string[]>([]);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'postingDate', direction: 'desc' });
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Modal State for Action Confirmations (Approve/Reject)
  const [actionModal, setActionModal] = useState<{
    type: 'BULK_APPROVE' | 'BULK_REJECT' | 'SINGLE_REJECT';
    docNo?: string;
    allIds: string[];
    count?: number;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState('Persediaan barang tidak mencukupi / Data tidak sesuai');

  // Group Requests by DocumentNo (1 row per unique No DO)
  const groupedRequests = useMemo(() => {
    const map = new Map<string, {
      documentNo: string;
      allIds: string[];
      postingDate: string;
      requestedAt?: string;
      entryName: string;
      remark: string;
      toLocation: string;
      requestedBy: string;
      status: 'PENDING' | 'APPROVED' | 'REJECTED';
      approvedBy?: string;
      approvedAt?: string;
      rejectionReason?: string;
      keterangan?: string;
    }>();

    requests.forEach(r => {
      const docNoStr = (r.documentNo || '').trim();
      if (!docNoStr) return;
      const key = docNoStr.toUpperCase();

      if (!map.has(key)) {
        map.set(key, {
          documentNo: docNoStr,
          allIds: r.id ? [r.id] : [],
          postingDate: r.postingDate,
          requestedAt: r.requestedAt,
          entryName: r.entryName || '',
          remark: r.remark || '',
          toLocation: r.toLocation || '',
          requestedBy: r.requestedBy || '',
          status: r.status || 'PENDING',
          approvedBy: r.approvedBy,
          approvedAt: r.approvedAt,
          rejectionReason: r.rejectionReason,
          keterangan: r.keterangan || ''
        });
      } else {
        const existing = map.get(key)!;
        if (r.id && !existing.allIds.includes(r.id)) {
          existing.allIds.push(r.id);
        }

        // Prioritize PENDING status if any line is PENDING
        if (r.status === 'PENDING') {
          existing.status = 'PENDING';
        } else if (existing.status !== 'PENDING' && r.status === 'APPROVED') {
          existing.status = 'APPROVED';
        }

        if (!existing.entryName && r.entryName) existing.entryName = r.entryName;
        if (!existing.remark && r.remark) existing.remark = r.remark;
        if (!existing.toLocation && r.toLocation) existing.toLocation = r.toLocation;
        if (!existing.requestedBy && r.requestedBy) existing.requestedBy = r.requestedBy;
        if (!existing.keterangan && r.keterangan) existing.keterangan = r.keterangan;
        if (r.requestedAt && (!existing.requestedAt || r.requestedAt > existing.requestedAt)) {
          existing.requestedAt = r.requestedAt;
          existing.postingDate = r.postingDate;
        }
      }
    });

    return Array.from(map.values());
  }, [requests]);

  // Form State for manual input
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [postingDate, setPostingDate] = useState(new Date().toISOString().slice(0, 10));
  const [documentNo, setDocumentNo] = useState(`DO-2026-${Math.floor(100 + Math.random() * 900)}`);
  const [itemCode, setItemCode] = useState(masterItems[0]?.itemCode || 'ITM-101');
  const [qty, setQty] = useState<number | ''>(10);
  const [entryName, setEntryName] = useState('Sales Admin RM');
  const [remark, setRemark] = useState('SPV Logistik Main Area');
  const [fromLocation, setFromLocation] = useState('Gudang Utama A');
  const [toLocation, setToLocation] = useState('Customer PT Konstruksi');
  const [keterangan, setKeterangan] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSort = (field: string) => {
    setSortConfig(prev => {
      if (prev.key === field) {
        if (prev.direction === 'asc') return { key: field, direction: 'desc' };
        if (prev.direction === 'desc') return { key: null, direction: null };
      }
      return { key: field, direction: 'asc' };
    });
  };

  // Filtered Requests
  const filteredRequests = useMemo(() => {
    return groupedRequests.filter(r => {
      // Search
      const query = filters.searchQuery.toLowerCase();
      const matchSearch = !query || 
        (r.documentNo && r.documentNo.toLowerCase().includes(query)) ||
        (r.requestedBy && r.requestedBy.toLowerCase().includes(query)) ||
        (r.entryName && r.entryName.toLowerCase().includes(query)) ||
        (r.remark && r.remark.toLowerCase().includes(query)) ||
        (r.toLocation && r.toLocation.toLowerCase().includes(query));

      // Date Range Filter
      let matchDate = true;
      if (filters.startDate) {
        matchDate = matchDate && r.postingDate >= filters.startDate;
      }
      if (filters.endDate) {
        matchDate = matchDate && r.postingDate <= filters.endDate;
      }

      // Status Filter (defaults to PENDING when no specific category selected)
      const matchStatus = filters.category ? r.status === filters.category : r.status === 'PENDING';

      return matchSearch && matchDate && matchStatus;
    });
  }, [groupedRequests, filters]);

  // Sorted Requests
  const sortedRequests = useMemo(() => {
    return sortData(filteredRequests, sortConfig);
  }, [filteredRequests, sortConfig]);

  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(sortedRequests.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedRequests = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return sortedRequests.slice(start, start + PAGE_SIZE);
  }, [sortedRequests, safePage]);

  useEffect(() => {
    setPage(1);
  }, [filters, sortConfig]);

  // Grouped Counts
  const pendingCount = groupedRequests.filter(r => r.status === 'PENDING').length;
  const approvedCount = groupedRequests.filter(r => r.status === 'APPROVED').length;
  const rejectedCount = groupedRequests.filter(r => r.status === 'REJECTED').length;

  // Select All
  const handleSelectAll = () => {
    if (selectedDocNos.length === filteredRequests.length) {
      setSelectedDocNos([]);
    } else {
      setSelectedDocNos(filteredRequests.map(i => i.documentNo));
    }
  };

  const handleToggleSelect = (docNo: string) => {
    setSelectedDocNos(prev => 
      prev.includes(docNo) ? prev.filter(d => d !== docNo) : [...prev, docNo]
    );
  };

  // Approve Request for a No DO (Approve all underlying records)
  const handleApprove = async (docNo: string, allIds: string[]) => {
    setProcessingId(docNo);
    try {
      const approver = currentUser?.displayName || currentUser?.email || 'PIC Gudang Logistik';
      const approvedAt = new Date().toISOString();

      // Update Supabase
      if (allIds.length > 0) {
        for (const reqId of allIds) {
          try {
            await updateRequestDoOpenStatus(reqId, 'APPROVED', approver, docNo);
          } catch (err) {
            console.warn(`Failed to approve doc ${reqId} in Supabase:`, err);
          }
        }
      }
      try {
        await updateRequestDoOpenStatus(docNo, 'APPROVED', approver, docNo);
      } catch (e) {}

      // Non-blocking Firestore update
      if (!isFirestoreQuotaExceeded && allIds.length > 0) {
        for (const reqId of allIds) {
          try {
            await Promise.race([
              setDoc(doc(db, COLLECTIONS.REQUEST_DO_OPEN, reqId), {
                status: 'APPROVED',
                approvedBy: approver,
                approvedAt
              }, { merge: true }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 1200))
            ]);
          } catch (err) {
            console.warn(`Firestore setDoc notice:`, err);
          }
        }
      }

      if (onRequestStatusChange) {
        onRequestStatusChange([...allIds, docNo], 'APPROVED', approver);
      }
    } catch (err: any) {
      console.error(err);
      alert(`Gagal approve request: ${err.message || 'Error'}`);
    } finally {
      setProcessingId(null);
    }
  };

  // Revert request yang sudah APPROVED/REJECTED balik ke PENDING — buat
  // testing atau membatalkan aksi yang salah (bukan alur harian normal).
  const handleRevert = async (docNo: string, allIds: string[]) => {
    if (!confirm(`Kembalikan request "${docNo}" ke status PENDING? Aksi approve/reject sebelumnya akan dibatalkan.`)) return;
    setProcessingId(docNo);
    try {
      const reverter = currentUser?.displayName || currentUser?.email || 'PIC Gudang Logistik';

      if (allIds.length > 0) {
        for (const reqId of allIds) {
          try {
            await updateRequestDoOpenStatus(reqId, 'PENDING', '', docNo);
          } catch (err) {
            console.warn(`Failed to revert doc ${reqId}:`, err);
          }
        }
      }
      try {
        await updateRequestDoOpenStatus(docNo, 'PENDING', '', docNo);
      } catch (e) {}

      if (onRequestStatusChange) {
        onRequestStatusChange([...allIds, docNo], 'PENDING', reverter);
      }
    } catch (err: any) {
      console.error(err);
      alert(`Gagal revert request: ${err.message || 'Error'}`);
    } finally {
      setProcessingId(null);
    }
  };

  // Open Bulk Approve Modal
  const handleOpenBulkApprove = () => {
    if (selectedDocNos.length === 0) return;
    const selectedSet = new Set(selectedDocNos.map(d => d.trim().toUpperCase()));
    const targetGrouped = groupedRequests.filter(g => selectedSet.has(g.documentNo.trim().toUpperCase()));
    const allIds = targetGrouped.flatMap(g => g.allIds);

    setActionModal({
      type: 'BULK_APPROVE',
      allIds,
      count: selectedDocNos.length
    });
  };

  // Open Single Reject Modal
  const handleOpenSingleReject = (docNo: string, allIds: string[]) => {
    setRejectReason('Persediaan barang tidak mencukupi / Data tidak sesuai');
    setActionModal({
      type: 'SINGLE_REJECT',
      docNo,
      allIds
    });
  };

  // Open Bulk Reject Modal
  const handleOpenBulkReject = () => {
    if (selectedDocNos.length === 0) return;
    const selectedSet = new Set(selectedDocNos.map(d => d.trim().toUpperCase()));
    const targetGrouped = groupedRequests.filter(g => selectedSet.has(g.documentNo.trim().toUpperCase()));
    const allIds = targetGrouped.flatMap(g => g.allIds);

    setRejectReason('Persediaan barang tidak mencukupi / Data tidak sesuai');
    setActionModal({
      type: 'BULK_REJECT',
      allIds,
      count: selectedDocNos.length
    });
  };

  // Execute Action from Modal (Approve / Reject)
  const handleExecuteModalAction = async () => {
    if (!actionModal) return;

    const { type, docNo, allIds } = actionModal;
    setProcessingId(docNo || 'BULK_ACTION');

    try {
      const userLabel = currentUser?.displayName || currentUser?.email || 'PIC Gudang Logistik';
      const nowStr = new Date().toISOString();

      if (type === 'BULK_APPROVE') {
        const docNosToApprove = new Set<string>();
        if (docNo) docNosToApprove.add(docNo);
        selectedDocNos.forEach(d => docNosToApprove.add(d));

        // 1. Update Supabase
        if (allIds.length > 0) {
          for (const reqId of allIds) {
            const matchingReq = requests.find(r => r.id === reqId);
            try {
              await updateRequestDoOpenStatus(reqId, 'APPROVED', userLabel, matchingReq?.documentNo || docNo);
            } catch (err) {
              console.warn(`Failed to approve doc ${reqId} in Supabase:`, err);
            }
          }
        }
        for (const dNo of docNosToApprove) {
          try {
            await updateRequestDoOpenStatus(dNo, 'APPROVED', userLabel, dNo);
          } catch (err) {}
        }

        // 2. Non-blocking Firestore update
        if (!isFirestoreQuotaExceeded && allIds.length > 0) {
          for (const reqId of allIds) {
            try {
              await Promise.race([
                setDoc(doc(db, COLLECTIONS.REQUEST_DO_OPEN, reqId), {
                  status: 'APPROVED',
                  approvedBy: userLabel,
                  approvedAt: nowStr
                }, { merge: true }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 1200))
              ]);
            } catch (err) {
              console.warn(`Firestore setDoc notice:`, err);
            }
          }
        }

        if (onRequestStatusChange) {
          onRequestStatusChange([...allIds, ...Array.from(docNosToApprove)], 'APPROVED', userLabel);
        }
        setSelectedDocNos([]);
      } else if (type === 'BULK_REJECT' || type === 'SINGLE_REJECT') {
        const finalReason = rejectReason.trim() || 'Ditolak oleh PIC Gudang';
        const docNosToReject = new Set<string>();
        if (docNo) docNosToReject.add(docNo);
        if (type === 'BULK_REJECT') selectedDocNos.forEach(d => docNosToReject.add(d));

        // 1. Update Supabase
        if (allIds.length > 0) {
          for (const reqId of allIds) {
            const matchingReq = requests.find(r => r.id === reqId);
            try {
              await updateRequestDoOpenStatus(reqId, 'REJECTED', `${userLabel}: ${finalReason}`, matchingReq?.documentNo || docNo);
            } catch (err) {
              console.warn(`Failed to reject doc ${reqId} in Supabase:`, err);
            }
          }
        }
        for (const dNo of docNosToReject) {
          try {
            await updateRequestDoOpenStatus(dNo, 'REJECTED', `${userLabel}: ${finalReason}`, dNo);
          } catch (err) {}
        }

        // 2. Non-blocking Firestore update
        if (!isFirestoreQuotaExceeded && allIds.length > 0) {
          for (const reqId of allIds) {
            try {
              await Promise.race([
                setDoc(doc(db, COLLECTIONS.REQUEST_DO_OPEN, reqId), {
                  status: 'REJECTED',
                  approvedBy: userLabel,
                  approvedAt: nowStr,
                  rejectionReason: finalReason
                }, { merge: true }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 1200))
              ]);
            } catch (err) {
              console.warn(`Firestore setDoc notice:`, err);
            }
          }
        }

        if (onRequestStatusChange) {
          onRequestStatusChange([...allIds, ...Array.from(docNosToReject)], 'REJECTED', userLabel, finalReason);
        }
        if (type === 'BULK_REJECT') {
          setSelectedDocNos([]);
        }
      }
    } catch (err: any) {
      console.error(err);
      alert(`Gagal memproses aksi: ${err.message || 'Error'}`);
    } finally {
      setActionModal(null);
      setProcessingId(null);
    }
  };

  // Export Excel
  const handleExport = () => {
    const exportData = filteredRequests.map(r => ({
      'Tanggal Request': r.postingDate,
      'No DO': r.documentNo,
      'Area RM OPR': r.entryName,
      'Area SPV OPR': r.remark,
      'To': r.toLocation,
      'Requested By': r.requestedBy,
      'Requested At': r.requestedAt,
      'Status Approval': r.status,
      'Approved / Rejected By': r.approvedBy || '-',
      'Approved / Rejected At': r.approvedAt || '-'
    }));
    exportToExcel(exportData, 'Request_DO_OPEN_Gudang', 'Request DO OPEN');
  };

  // Delete Selected
  const handleDeleteSelected = () => {
    if (!selectedDocNos.length) return;
    const idsToDelete = groupedRequests
      .filter(g => selectedDocNos.includes(g.documentNo))
      .flatMap(g => g.allIds);

    onRequestDeleteConfirm(
      'Hapus Request DO OPEN Terpilih',
      `Apakah Anda yakin ingin menghapus ${selectedDocNos.length} No DO (${idsToDelete.length} item line) tercentang?`,
      async () => {
        await bulkDeleteDocs(COLLECTIONS.REQUEST_DO_OPEN, idsToDelete);
        for (const id of idsToDelete) {
          const matching = requests.find(r => r.id === id);
          await deleteRequestDoOpen(id, matching?.documentNo).catch(e => console.warn(e));
        }
        if (onRequestDelete) {
          onRequestDelete(idsToDelete);
        }
        setSelectedDocNos([]);
      },
      false,
      selectedDocNos.length
    );
  };

  // Delete All
  const handleDeleteAll = () => {
    onRequestDeleteConfirm(
      'Hapus Seluruh Request DO OPEN',
      'Apakah Anda yakin ingin menghapus SELURUH data Request DO OPEN di database?',
      async () => {
        const allIds = requests.map(r => r.id!).filter(Boolean);
        await clearCollectionDocs(COLLECTIONS.REQUEST_DO_OPEN);
        for (const id of allIds) {
          await deleteRequestDoOpen(id).catch(e => console.warn(e));
        }
        if (onRequestDelete) {
          onRequestDelete(allIds);
        }
        setSelectedDocNos([]);
      },
      true,
      requests.length
    );
  };

  // Create New Request Manually
  const handleSaveRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!documentNo.trim() || !itemCode.trim() || !qty || Number(qty) <= 0) {
      setFormError('No DO (DocumentNo), Item Code, dan Qty (>0) wajib diisi.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      const newReqPayload: RequestDoRecord = {
        id: generateUUID(),
        doOpenId: '',
        postingDate,
        entryName: entryName.trim(),
        documentNo: documentNo.trim(),
        itemCode: itemCode.trim(),
        category: 'DO SUDAH DI LOGISTIK',
        remark: remark.trim(),
        qty: Number(qty),
        fromLocation: fromLocation.trim(),
        toLocation: toLocation.trim(),
        requestedBy: currentUser?.email || 'User Operational',
        requestedAt: new Date().toISOString(),
        requestKirimDate: postingDate,
        status: 'PENDING',
        keterangan: keterangan.trim()
      };

      if (!isFirestoreQuotaExceeded) {
        try {
          await addDoc(collection(db, COLLECTIONS.REQUEST_DO_OPEN), newReqPayload);
        } catch (err) {
          console.warn('Firestore addDoc error:', err);
        }
      }

      // WAJIB cek hasilnya — addRequestDoOpen balikin true/false (bukan
      // throw) kalau gagal, jadi kalau tidak dicek, request yang gagal
      // simpan tetap keliatan "berhasil" di layar padahal tidak pernah
      // masuk database.
      const savedOk = await addRequestDoOpen(newReqPayload);
      if (!savedOk) {
        throw new Error('Server menolak permintaan (sesi mungkin sudah kedaluwarsa, coba login ulang).');
      }

      if (onRequestCreate) {
        onRequestCreate([newReqPayload]);
      }

      setIsAddModalOpen(false);
      // Reset form
      setDocumentNo(`DO-2026-${Math.floor(100 + Math.random() * 900)}`);
      setKeterangan('');
    } catch (err: any) {
      console.error(err);
      setFormError(`Gagal menyimpan request: ${err.message || 'Error'}`);
    } finally {
      setSubmitting(false);
    }
  };

  const canDelete = currentUser?.role === 'Audit';

  return (
    <div className="space-y-6">
      
      {/* Header View */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded border border-slate-200 shadow-xs mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <Send className="w-4 h-4 text-indigo-600" />
              Menu Request DO OPEN & Approval PIC Gudang
            </h2>
            {pendingCount > 0 && (
              <span className="px-2 py-0.5 bg-amber-500 text-white text-[10px] font-bold rounded-full animate-pulse">
                {pendingCount} PERMINTAAN BARU
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
            Daftar pengajuan DO OPEN barang dari area Logistik yang memerlukan persetujuan PIC Gudang.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => {
              setDocumentNo(`DO-2026-${Math.floor(100 + Math.random() * 900)}`);
              setIsAddModalOpen(true);
            }}
            className="flex items-center gap-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded shadow-xs transition"
          >
            <Plus className="w-3.5 h-3.5" />
            Input Request DO
          </button>

          <button
            onClick={onOpenImport}
            className="flex items-center gap-1 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded shadow-xs transition"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Import Excel
          </button>

          <button
            onClick={handleExport}
            className="flex items-center gap-1 px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded transition border border-slate-300"
          >
            <Download className="w-3.5 h-3.5" />
            Export Excel
          </button>
        </div>
      </div>

      {/* New Request Alert Highlight for PIC Gudang */}
      {pendingCount > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-300 text-amber-900 rounded-lg text-xs font-semibold flex items-center justify-between shadow-xs mb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              Ada <strong>{pendingCount} Request DO OPEN baru</strong> yang menunggu konfirmasi/approval PIC Gudang. Silakan periksa daftar di bawah ini.
            </span>
          </div>
        </div>
      )}

      {/* Metric Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
        <div 
          onClick={() => setFilters(prev => ({ ...prev, category: 'PENDING' }))}
          className={`p-2.5 bg-white rounded border transition cursor-pointer shadow-xs ${
            filters.category === 'PENDING' ? 'border-amber-500 ring-1 ring-amber-500 bg-amber-50/20' : 'border-slate-200 hover:border-amber-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-amber-800 uppercase">Menunggu Approval (Pending)</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <span className="text-lg font-bold text-amber-700 font-mono block mt-1">
            {pendingCount} Request
          </span>
        </div>

        <div 
          onClick={() => setFilters(prev => ({ ...prev, category: 'APPROVED' }))}
          className={`p-2.5 bg-white rounded border transition cursor-pointer shadow-xs ${
            filters.category === 'APPROVED' ? 'border-emerald-500 ring-1 ring-emerald-500 bg-emerald-50/20' : 'border-slate-200 hover:border-emerald-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-emerald-800 uppercase">Disetujui (Approved)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <span className="text-lg font-bold text-emerald-700 font-mono block mt-1">
            {approvedCount} Request
          </span>
        </div>

        <div 
          onClick={() => setFilters(prev => ({ ...prev, category: 'REJECTED' }))}
          className={`p-2.5 bg-white rounded border transition cursor-pointer shadow-xs ${
            filters.category === 'REJECTED' ? 'border-rose-500 ring-1 ring-rose-500 bg-rose-50/20' : 'border-slate-200 hover:border-rose-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-rose-800 uppercase">Ditolak (Rejected)</span>
            <XCircle className="w-4 h-4 text-rose-600" />
          </div>
          <span className="text-lg font-bold text-rose-700 font-mono block mt-1">
            {rejectedCount} Request
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <FilterBar
        filters={filters}
        onFilterChange={setFilters}
        categories={['PENDING', 'APPROVED', 'REJECTED']}
        placeholder="Cari berdasarkan No DO, Item Code, Pengaju, Area RM, Area SPV..."
      />

      {/* Bulk Action Bar */}
      {selectedDocNos.length > 0 && (
        <div className="p-2.5 bg-indigo-50 border border-indigo-200 rounded flex flex-wrap items-center justify-between gap-2 mb-3 text-xs">
          <span className="font-semibold text-indigo-950 flex items-center gap-1.5">
            <CheckSquare className="w-4 h-4 text-indigo-600" />
            Terpilih <span className="font-bold text-indigo-700 font-mono text-sm">{selectedDocNos.length}</span> No DO dari tabel
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenBulkApprove}
              disabled={processingId !== null}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded shadow-2xs transition disabled:opacity-50 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              Approve Terpilih ({selectedDocNos.length})
            </button>
            <button
              onClick={handleOpenBulkReject}
              disabled={processingId !== null}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded shadow-2xs transition disabled:opacity-50 cursor-pointer"
            >
              <XCircle className="w-4 h-4" />
              Reject Terpilih ({selectedDocNos.length})
            </button>
            {canDelete && (
              <button
                onClick={handleDeleteSelected}
                disabled={processingId !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold rounded shadow-2xs transition disabled:opacity-50 cursor-pointer ml-2"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Hapus Terpilih
              </button>
            )}
          </div>
        </div>
      )}

      {/* Requests Table */}
      <div className="bg-white rounded border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between bg-slate-100/70">
          <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
            Daftar Request DO OPEN ({filteredRequests.length} No DO)
          </span>

          {canDelete && (
            <button
              onClick={handleDeleteAll}
              disabled={requests.length === 0}
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
                    {selectedDocNos.length === sortedRequests.length && sortedRequests.length > 0 ? (
                      <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
                    ) : (
                      <Square className="w-3.5 h-3.5" />
                    )}
                  </button>
                </th>
                <SortableHeader
                  label="Tanggal Request"
                  field="postingDate"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="No DO (DocumentNo)"
                  field="documentNo"
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
                  label="Area SPV OPR"
                  field="remark"
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
                <SortableHeader
                  label="Pengaju"
                  field="requestedBy"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Status Approval"
                  field="status"
                  align="center"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <th className="p-2 text-center">Aksi PIC Gudang</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {sortedRequests.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-6 text-center text-slate-400 text-xs">
                    Tidak ada data Request DO OPEN.
                  </td>
                </tr>
              ) : (
                paginatedRequests.map((r) => {
                  const isSelected = selectedDocNos.includes(r.documentNo);

                  let statusBadge = (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold bg-amber-50 text-amber-800 rounded border border-amber-200">
                      <Clock className="w-3 h-3 text-amber-600 animate-spin" />
                      PENDING
                    </span>
                  );

                  if (r.status === 'APPROVED') {
                    statusBadge = (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-800 rounded border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        APPROVED
                      </span>
                    );
                  } else if (r.status === 'REJECTED') {
                    statusBadge = (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold bg-rose-50 text-rose-800 rounded border border-rose-200" title={r.rejectionReason}>
                        <XCircle className="w-3 h-3 text-rose-600" />
                        REJECTED
                      </span>
                    );
                  }

                  return (
                    <tr 
                      key={r.documentNo} 
                      className={`hover:bg-slate-50 transition ${isSelected ? 'bg-indigo-50/30' : ''}`}
                    >
                      <td className="p-2 text-center">
                        <button 
                          onClick={() => handleToggleSelect(r.documentNo)}
                          className="text-slate-400 hover:text-indigo-600"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
                          ) : (
                            <Square className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </td>
                      <td className="p-2 font-mono text-slate-600">
                        {r.requestedAt ? new Date(r.requestedAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : r.postingDate}
                      </td>
                      <td className="p-2 font-mono font-bold text-indigo-900">{r.documentNo}</td>
                      <td className="p-2 text-slate-700">{r.entryName || '-'}</td>
                      <td className="p-2 text-slate-600">{r.remark || '-'}</td>
                      <td className="p-2 text-slate-600">{r.toLocation || '-'}</td>
                      <td className="p-2 text-slate-600 max-w-[160px] truncate" title={r.keterangan || '-'}>{r.keterangan || '-'}</td>
                      <td className="p-2 text-slate-600 font-mono text-[10px]">{r.requestedBy}</td>
                      <td className="p-2 text-center">{statusBadge}</td>
                      <td className="p-2 text-center">
                        {r.status === 'PENDING' ? (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => handleApprove(r.documentNo, r.allIds)}
                              disabled={processingId === r.documentNo}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] rounded transition shadow-2xs disabled:opacity-50"
                              title="Setujui Request DO ini"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleOpenSingleReject(r.documentNo, r.allIds)}
                              disabled={processingId === r.documentNo}
                              className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold text-[10px] rounded transition shadow-2xs disabled:opacity-50"
                              title="Tolak Request DO ini"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1.5">
                            <span className="text-[10px] text-slate-400 font-mono">
                              {r.approvedBy ? `By: ${r.approvedBy.split('@')[0]}` : 'Selesai'}
                            </span>
                            <button
                              onClick={() => handleRevert(r.documentNo, r.allIds)}
                              disabled={processingId === r.documentNo}
                              className="px-2 py-0.5 bg-slate-100 hover:bg-amber-100 text-slate-500 hover:text-amber-700 border border-slate-200 hover:border-amber-300 font-semibold text-[10px] rounded transition disabled:opacity-50"
                              title="Kembalikan ke PENDING (batalkan approve/reject sebelumnya)"
                            >
                              Revert
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {sortedRequests.length > 0 && totalPages > 1 && (
          <div className="flex items-center justify-between mt-3 px-1">
            <span className="text-[11px] text-slate-500 font-medium">
              Menampilkan {((safePage - 1) * PAGE_SIZE) + 1}–{Math.min(safePage * PAGE_SIZE, sortedRequests.length)} dari {sortedRequests.length.toLocaleString('id-ID', { maximumFractionDigits: 0 })} data
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ← Sebelumnya
              </button>
              <span className="text-[11px] font-mono font-semibold text-slate-600 px-2">{safePage} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Selanjutnya →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add Request Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 border border-slate-100 animate-in fade-in zoom-in duration-200">
            
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Send className="w-5 h-5 text-indigo-600" />
                Input Request DO OPEN Baru
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

            <form onSubmit={handleSaveRequest} className="mt-4 space-y-3 text-xs">
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tanggal Request *</label>
                  <input
                    type="date"
                    required
                    value={postingDate}
                    onChange={(e) => setPostingDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">ItemCode *</label>
                  <select
                    value={itemCode}
                    onChange={(e) => setItemCode(e.target.value)}
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
                  <label className="block font-semibold text-slate-700 mb-1">Qty *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={qty}
                    onChange={(e) => setQty(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Area RM OPR</label>
                  <input
                    type="text"
                    value={entryName}
                    onChange={(e) => setEntryName(e.target.value)}
                    placeholder="Sales Admin RM"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Area SPV OPR</label>
                  <input
                    type="text"
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                    placeholder="SPV Logistik Main Area"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">From</label>
                  <input
                    type="text"
                    value={fromLocation}
                    onChange={(e) => setFromLocation(e.target.value)}
                    placeholder="Gudang Utama A"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">To</label>
                  <input
                    type="text"
                    value={toLocation}
                    onChange={(e) => setToLocation(e.target.value)}
                    placeholder="Customer PT Jaya"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Keterangan / Komentar (opsional)</label>
                <textarea
                  value={keterangan}
                  onChange={(e) => setKeterangan(e.target.value)}
                  placeholder="Catatan tambahan buat PIC Gudang, mis. alasan/urgensi request..."
                  rows={2}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
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
                  className="px-5 py-2 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-sm flex items-center gap-1.5"
                >
                  <Send className="w-4 h-4" />
                  {submitting ? 'Menyimpan...' : 'Kirim Request'}
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

      {/* Action Confirmation & Reject Reason Modal */}
      {actionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-slate-100 animate-in fade-in zoom-in duration-200">
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                {actionModal.type === 'BULK_APPROVE' && (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    Konfirmasi Persetujuan (Approve)
                  </>
                )}
                {actionModal.type === 'BULK_REJECT' && (
                  <>
                    <XCircle className="w-5 h-5 text-rose-600" />
                    Konfirmasi Penolakan (Reject Terpilih)
                  </>
                )}
                {actionModal.type === 'SINGLE_REJECT' && (
                  <>
                    <XCircle className="w-5 h-5 text-rose-600" />
                    Konfirmasi Penolakan Request DO
                  </>
                )}
              </h3>
              <button onClick={() => setActionModal(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 text-xs text-slate-700 space-y-3">
              {actionModal.type === 'BULK_APPROVE' && (
                <p className="leading-relaxed">
                  Apakah Anda yakin ingin <strong className="text-emerald-700">MENSETUJUI (Approve)</strong> <span className="font-bold font-mono text-indigo-700">{actionModal.count} No DO</span> terpilih?
                </p>
              )}

              {actionModal.type === 'BULK_REJECT' && (
                <div>
                  <p className="mb-2 leading-relaxed">
                    Masukkan alasan penolakan untuk <span className="font-bold font-mono text-rose-700">{actionModal.count} No DO</span> terpilih:
                  </p>
                  <textarea
                    rows={3}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Masukkan alasan penolakan..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500 font-sans"
                  />
                </div>
              )}

              {actionModal.type === 'SINGLE_REJECT' && (
                <div>
                  <p className="mb-2 leading-relaxed">
                    Masukkan alasan penolakan untuk Request DO <strong className="font-mono text-rose-700">{actionModal.docNo}</strong>:
                  </p>
                  <textarea
                    rows={3}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Masukkan alasan penolakan..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500 font-sans"
                  />
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="px-4 py-2 font-medium text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition text-xs"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleExecuteModalAction}
                disabled={processingId !== null}
                className={`px-5 py-2 font-bold text-white rounded-xl transition shadow-xs text-xs flex items-center gap-1.5 ${
                  actionModal.type === 'BULK_APPROVE'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {processingId !== null ? 'Memproses...' : actionModal.type === 'BULK_APPROVE' ? 'Ya, Approve Sekarang' : 'Ya, Reject Sekarang'}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
