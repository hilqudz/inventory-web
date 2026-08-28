import React, { useState, useMemo } from 'react';
import {
  ArrowUpRight,
  Plus,
  FileSpreadsheet,
  Download,
  Trash2,
  X,
  CheckSquare,
  Square,
  AlertCircle,
  Sparkles,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { TransactionRecord, DateCategoryFilter, MasterItem, UserProfile } from '../types';
import { FilterBar } from '../components/FilterBar';
import { SortableHeader } from '../components/SortableHeader';
import { sortData, SortConfig } from '../utils/sorting';
import { exportToExcel } from '../utils/excel';
import { bulkDeleteDocs, clearCollectionDocs, COLLECTIONS, db, autoReconcileDoOpen, isFirestoreQuotaExceeded } from '../api';
import { addDoc, collection, doc, deleteDoc } from 'firebase/firestore';
import { addTransaksiKeluar, deleteSupabaseRows, clearSupabaseTable } from '../api';

interface TransaksiKeluarViewProps {
  records: TransactionRecord[];
  masterItems: MasterItem[];
  currentUser?: UserProfile | null;
  onOpenImport: () => void;
  onRequestDeleteConfirm: (title: string, message: string, onConfirm: () => Promise<void>, isAll?: boolean, count?: number) => void;
  onAutoReconciledNotice?: (deletedCount: number, deletedDocs: string[]) => void;
}

export const TransaksiKeluarView: React.FC<TransaksiKeluarViewProps> = ({
  records,
  masterItems,
  currentUser,
  onOpenImport,
  onRequestDeleteConfirm,
  onAutoReconciledNotice
}) => {
  const canDelete = currentUser?.role === 'Audit';
  const [filters, setFilters] = useState<DateCategoryFilter>({
    searchQuery: '',
    startDate: '',
    endDate: '',
    category: ''
  });

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'postingDate', direction: 'desc' });
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const handleSort = (field: string) => {
    setSortConfig(prev => {
      if (prev.key === field) {
        if (prev.direction === 'asc') return { key: field, direction: 'desc' };
        if (prev.direction === 'desc') return { key: null, direction: null };
      }
      return { key: field, direction: 'asc' };
    });
  };

  // Form State
  const [postingDate, setPostingDate] = useState(new Date().toISOString().slice(0, 10));
  const [entryName, setEntryName] = useState('Admin Gudang');
  const [documentNo, setDocumentNo] = useState(`OUT-2026-${Math.floor(100 + Math.random() * 900)}`);
  const [itemCode, setItemCode] = useState(masterItems[0]?.itemCode || 'ITM-101');
  const [category, setCategory] = useState(masterItems[0]?.groupName || 'Bahan Bangunan');
  const [remark, setRemark] = useState('Pengiriman Proyek / Realisasi DO');
  const [qty, setQty] = useState<number | ''>(50);
  const [fromLocation, setFromLocation] = useState('Gudang Utama A');
  const [toLocation, setToLocation] = useState('Customer PT Pelanggan');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Categories list
  const categories = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => { if (r.category) set.add(r.category); });
    masterItems.forEach(m => { if (m.groupName) set.add(m.groupName); });
    return Array.from(set);
  }, [records, masterItems]);

  // Filtered Records
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      // Search
      const query = filters.searchQuery.toLowerCase();
      const matchSearch = !query || 
        (r.documentNo && r.documentNo.toLowerCase().includes(query)) ||
        (r.itemCode && r.itemCode.toLowerCase().includes(query)) ||
        (r.remark && r.remark.toLowerCase().includes(query)) ||
        (r.entryName && r.entryName.toLowerCase().includes(query)) ||
        (r.fromLocation && r.fromLocation.toLowerCase().includes(query)) ||
        (r.toLocation && r.toLocation.toLowerCase().includes(query));

      // Date Range Filter
      let matchDate = true;
      if (filters.startDate) {
        matchDate = matchDate && r.postingDate >= filters.startDate;
      }
      if (filters.endDate) {
        matchDate = matchDate && r.postingDate <= filters.endDate;
      }

      // Category
      const matchCategory = !filters.category || r.category === filters.category;

      return matchSearch && matchDate && matchCategory;
    });
  }, [records, filters]);

  // Sorted Records
  const sortedRecords = useMemo(() => {
    return sortData(filteredRecords, sortConfig);
  }, [filteredRecords, sortConfig]);

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
  }, [filters.searchQuery, filters.startDate, filters.endDate, filters.category, sortConfig]);

  // Select All
  const handleSelectAll = () => {
    if (selectedIds.length === filteredRecords.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredRecords.map(i => i.id!).filter(Boolean));
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  // Select Item Code changes Category automatically
  const handleItemCodeChange = (code: string) => {
    setItemCode(code);
    const found = masterItems.find(m => m.itemCode === code);
    if (found && found.groupName) {
      setCategory(found.groupName);
    }
  };

  // Add Record + Trigger Auto DO OPEN Reconciliation
  const handleSaveRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!documentNo.trim() || !itemCode.trim() || !qty || Number(qty) <= 0) {
      setFormError('Nomor Dokumen, Item Code, dan Qty (>0) wajib diisi.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      if (!isFirestoreQuotaExceeded) {
        try {
          await addDoc(collection(db, COLLECTIONS.TRANSAKSI_KELUAR), {
            postingDate,
            entryName: entryName.trim(),
            documentNo: documentNo.trim(),
            itemCode: itemCode.trim(),
            category: category.trim(),
            remark: remark.trim(),
            qty: Number(qty),
            fromLocation: fromLocation.trim(),
            toLocation: toLocation.trim(),
            createdAt: new Date().toISOString()
          });
        } catch (e) {
          console.warn("Firestore addDoc error:", e);
        }
      }

      await addTransaksiKeluar({
        postingDate,
        entryName: entryName.trim(),
        documentNo: documentNo.trim(),
        itemCode: itemCode.trim(),
        category: category.trim(),
        remark: remark.trim(),
        qty: Number(qty),
        fromLocation: fromLocation.trim(),
        toLocation: toLocation.trim()
      });

      // Automatic DO OPEN cleanup logic
      const reconcileResult = await autoReconcileDoOpen();
      if (reconcileResult.deletedCount > 0 && onAutoReconciledNotice) {
        onAutoReconciledNotice(reconcileResult.deletedCount, reconcileResult.deletedDocs);
      }

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
    const exportData = filteredRecords.map(r => ({
      PostingDate: r.postingDate,
      EntryName: r.entryName,
      DocumentNo: r.documentNo,
      ItemCode: r.itemCode,
      Category: r.category,
      Remark: r.remark,
      Qty: r.qty,
      From: r.fromLocation,
      To: r.toLocation
    }));
    exportToExcel(exportData, 'Transaksi_Keluar_Gudang', 'Transaksi Keluar');
  };

  // Delete Selected
  const handleDeleteSelected = () => {
    if (!selectedIds.length) return;
    onRequestDeleteConfirm(
      'Hapus Transaksi Keluar Terpilih',
      `Apakah Anda yakin ingin menghapus ${selectedIds.length} transaksi keluar tercentang?`,
      async () => {
        await deleteSupabaseRows('transaksi_keluar', selectedIds);
        try { await bulkDeleteDocs(COLLECTIONS.TRANSAKSI_KELUAR, selectedIds); } catch {}
        setSelectedIds([]);
      },
      false,
      selectedIds.length
    );
  };

  // Delete All
  const handleDeleteAll = () => {
    onRequestDeleteConfirm(
      'Hapus Seluruh Transaksi Keluar',
      'Apakah Anda yakin ingin menghapus SELURUH data Transaksi Keluar?',
      async () => {
        await clearSupabaseTable('transaksi_keluar');
        try { await clearCollectionDocs(COLLECTIONS.TRANSAKSI_KELUAR); } catch {}
        setSelectedIds([]);
      },
      true,
      records.length
    );
  };

  // Delete Single
  const handleDeleteSingle = (id: string, docNo: string) => {
    onRequestDeleteConfirm(
      'Hapus Transaksi Keluar',
      `Hapus transaksi nomor dokumen ${docNo}?`,
      async () => {
        await deleteSupabaseRows('transaksi_keluar', [id]);
        if (!isFirestoreQuotaExceeded) {
          try { await deleteDoc(doc(db, COLLECTIONS.TRANSAKSI_KELUAR, id)); } catch {}
        }
      },
      false,
      1
    );
  };

  return (
    <div className="space-y-6">
      
      {/* Header View */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded border border-slate-200 shadow-xs mb-3">
        <div>
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4 text-rose-600" />
            Transaksi Keluar (Outbound)
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Pengeluaran stok barang dari gudang. Otomatis menghapus No DO yang sama di DO OPEN.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => {
              setDocumentNo(`OUT-2026-${Math.floor(100 + Math.random() * 900)}`);
              setIsAddModalOpen(true);
            }}
            className="flex items-center gap-1 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded shadow-xs transition"
          >
            <Plus className="w-3.5 h-3.5" />
            Input Transaksi Keluar
          </button>

          <button
            onClick={onOpenImport}
            className="flex items-center gap-1 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded shadow-xs transition"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-rose-400" />
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

      {/* Auto Reconciliation Banner info */}
      <div className="p-2 bg-blue-50 border border-blue-200 text-blue-900 rounded text-[11px] flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          <span>
            <strong>Sistem Rekonsiliasi Otomatis DO:</strong> Jika No. Dokumen / No. DO yang diinput/diimport di Transaksi Keluar ada di daftar DO OPEN, maka data DO OPEN tersebut akan <strong>otomatis terhapus</strong> dari database & web.
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <FilterBar
        filters={filters}
        onFilterChange={setFilters}
        categories={categories}
        placeholder="Cari berdasarkan Dokumen / No DO, Item Code, Remark, Pengirim, Penerima..."
      />

      {/* Bulk Action Controls */}
      {canDelete && selectedIds.length > 0 && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded flex items-center justify-between mb-3 text-xs">
          <span className="font-semibold text-amber-800">
            Terpilih {selectedIds.length} transaksi dari tabel
          </span>
          <button
            onClick={handleDeleteSelected}
            className="flex items-center gap-1 px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Hapus Data Terpilih
          </button>
        </div>
      )}

      {/* Table Card */}
      <div className="bg-white rounded border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between bg-slate-100/70">
          <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
            Daftar Transaksi Keluar ({filteredRecords.length})
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
                      <CheckSquare className="w-3.5 h-3.5 text-rose-600" />
                    ) : (
                      <Square className="w-3.5 h-3.5" />
                    )}
                  </button>
                </th>
                <SortableHeader
                  label="Posting Date"
                  field="postingDate"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Doc No (No DO)"
                  field="documentNo"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Item Code"
                  field="itemCode"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Category"
                  field="category"
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
                  label="Entry / Remark"
                  field="remark"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <th className="p-2 text-center w-12">Aksi</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {paginatedRecords.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-6 text-center text-slate-400 text-xs">
                    Tidak ada data Transaksi Keluar yang ditemukan.
                  </td>
                </tr>
              ) : (
                paginatedRecords.map((r) => {
                  const isSelected = selectedIds.includes(r.id!);
                  return (
                    <tr 
                      key={r.id} 
                      className={`hover:bg-slate-50 transition ${isSelected ? 'bg-rose-50/40' : ''}`}
                    >
                      <td className="p-2 text-center">
                        <button 
                          onClick={() => handleToggleSelect(r.id!)}
                          className="text-slate-400 hover:text-rose-600"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-3.5 h-3.5 text-rose-600" />
                          ) : (
                            <Square className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </td>
                      <td className="p-2 font-mono text-slate-600">{r.postingDate}</td>
                      <td className="p-2 font-mono font-bold text-slate-800">{r.documentNo}</td>
                      <td className="p-2 font-mono font-bold text-rose-600">{r.itemCode}</td>
                      <td className="p-2">
                        <span className="px-1.5 py-0.2 text-[10px] font-medium bg-rose-50 text-rose-700 rounded border border-rose-200">
                          {r.category || 'Umum'}
                        </span>
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-rose-700 text-xs">
                        -{r.qty}
                      </td>
                      <td className="p-2 text-slate-600">{r.fromLocation || '-'}</td>
                      <td className="p-2 text-slate-600">{r.toLocation || '-'}</td>
                      <td className="p-2 text-slate-500">
                        <span className="font-semibold text-slate-700">{r.entryName}</span>
                        {r.remark && <span className="block text-[10px] text-slate-400">{r.remark}</span>}
                      </td>
                      <td className="p-2 text-center">
                        {canDelete && (
                          <button
                            onClick={() => handleDeleteSingle(r.id!, r.documentNo)}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                            title="Hapus Transaksi"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
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
            Menampilkan {sortedRecords.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1} - {Math.min(safePage * PAGE_SIZE, sortedRecords.length)} dari {sortedRecords.length.toLocaleString('id-ID', { maximumFractionDigits: 0 })} transaksi
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

      {/* Add Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 border border-slate-100 animate-in fade-in zoom-in duration-200">
            
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800">
                Input Transaksi Keluar
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
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">DocumentNo / No DO *</label>
                  <input
                    type="text"
                    required
                    value={documentNo}
                    onChange={(e) => setDocumentNo(e.target.value)}
                    placeholder="OUT-2026-001 atau DO-2026-901"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Jika sama dengan No DO di DO OPEN, DO OPEN otomatis terhapus.</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">ItemCode *</label>
                  <select
                    value={itemCode}
                    onChange={(e) => handleItemCodeChange(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  >
                    {masterItems.map(m => (
                      <option key={m.itemCode} value={m.itemCode}>
                        {m.itemCode} - {m.itemName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Qty Keluar *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={qty}
                    onChange={(e) => setQty(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Category</label>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Bahan Bangunan"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">EntryName</label>
                  <input
                    type="text"
                    value={entryName}
                    onChange={(e) => setEntryName(e.target.value)}
                    placeholder="Admin Gudang"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">From (Pengirim)</label>
                  <input
                    type="text"
                    value={fromLocation}
                    onChange={(e) => setFromLocation(e.target.value)}
                    placeholder="Gudang Utama A"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">To (Tujuan)</label>
                  <input
                    type="text"
                    value={toLocation}
                    onChange={(e) => setToLocation(e.target.value)}
                    placeholder="Customer PT Jaya"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Remark (Keterangan)</label>
                <input
                  type="text"
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder="Keterangan pengeluaran barang"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500"
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
                  className="px-5 py-2 font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition shadow-sm"
                >
                  {submitting ? 'Menyimpan...' : 'Simpan Transaksi Keluar'}
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

    </div>
  );
};
