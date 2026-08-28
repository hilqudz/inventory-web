import React, { useState, useMemo, useEffect } from 'react';
import {
  GitCompare,
  FileSpreadsheet,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Info,
  Loader2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { MasterItem, TransactionRecord, DoOpenRecord, RekonsiliasiSummary, DateCategoryFilter } from '../types';
import { FilterBar } from '../components/FilterBar';
import { SortableHeader } from '../components/SortableHeader';
import { sortData, SortConfig } from '../utils/sorting';
import { exportToExcel } from '../utils/excel';
import { autoReconcileDoOpen, fetchRekonsiliasiStockView } from '../api';

interface RekonsiliasiStockViewProps {
  masterItems: MasterItem[];
  transaksiMasuk: TransactionRecord[];
  transaksiKeluar: TransactionRecord[];
  doOpen: DoOpenRecord[];
  onOpenImport: () => void;
  onAutoReconciledNotice?: (deletedCount: number, deletedDocs: string[]) => void;
  onRunAutoReconcile?: () => Promise<any>;
}

export const RekonsiliasiStockView: React.FC<RekonsiliasiStockViewProps> = ({
  masterItems,
  transaksiMasuk,
  transaksiKeluar,
  doOpen,
  onOpenImport,
  onAutoReconciledNotice,
  onRunAutoReconcile
}) => {
  const [filters, setFilters] = useState<DateCategoryFilter>({
    searchQuery: '',
    startDate: '',
    endDate: '',
    category: ''
  });

  const [isReconciling, setIsReconciling] = useState(false);
  const [reconcileResultText, setReconcileResultText] = useState<string | null>(null);

  // Extract Categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    masterItems.forEach(i => { if (i.groupName) set.add(i.groupName); });
    transaksiMasuk.forEach(t => { if (t.category) set.add(t.category); });
    doOpen.forEach(d => { if (d.category) set.add(d.category); });
    return Array.from(set);
  }, [masterItems, transaksiMasuk, doOpen]);

  // Rekonsiliasi = Sisa Stock - Qty DO OPEN — dihitung SERVER-SIDE, bukan loop
  // di browser atas 13rb+ item x 3 sumber data. Lihat src/reportRoutes.ts
  // GET /api/reports/rekonsiliasi (qtyLepasan TIDAK di-clamp, boleh negatif —
  // dipakai status "Over Committed" di bawah).
  const [summaries, setSummaries] = useState<RekonsiliasiSummary[]>([]);
  const [loadingSummaries, setLoadingSummaries] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingSummaries(true);
    const timer = setTimeout(async () => {
      const rows: any[] = await fetchRekonsiliasiStockView(filters.startDate || undefined, filters.endDate || undefined);
      if (cancelled) return;
      setSummaries(
        rows.map((r) => ({
          itemCode: r.item_code,
          itemName: r.item_name,
          groupName: r.group_name || 'Umum',
          sisaStock: Number(r.sisa_stock_a || 0),
          qtyDoOpen: Number(r.qty_do_open_b || 0),
          qtyLepasan: Number(r.qty_lepasan || 0),
        }))
      );
      setLoadingSummaries(false);
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [filters.startDate, filters.endDate]);

  // Filtered
  const filteredSummaries = useMemo(() => {
    return summaries.filter(s => {
      const query = filters.searchQuery.toLowerCase();
      const matchSearch = !query || 
        s.itemCode.toLowerCase().includes(query) ||
        s.itemName.toLowerCase().includes(query) ||
        s.groupName.toLowerCase().includes(query);

      const matchCategory = !filters.category || s.groupName === filters.category;
      return matchSearch && matchCategory;
    });
  }, [summaries, filters]);

  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'qtyLepasan', direction: 'asc' });

  const handleSort = (field: string) => {
    setSortConfig(prev => {
      if (prev.key === field) {
        if (prev.direction === 'asc') return { key: field, direction: 'desc' };
        if (prev.direction === 'desc') return { key: null, direction: null };
      }
      return { key: field, direction: 'asc' };
    });
  };

  // Sorted Summaries
  const sortedSummaries = useMemo(() => {
    return sortData(filteredSummaries, sortConfig);
  }, [filteredSummaries, sortConfig]);

  // Pagination — cegah render ribuan baris DOM sekaligus (lihat MasterItemView).
  // Data sudah agregat server-side (ringan di-fetch), tapi render DOM tetap
  // perlu dipotong per halaman supaya tidak blocking main thread.
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(sortedSummaries.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedSummaries = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return sortedSummaries.slice(start, start + PAGE_SIZE);
  }, [sortedSummaries, safePage]);
  useEffect(() => {
    setPage(1);
  }, [filters.searchQuery, filters.startDate, filters.endDate, filters.category, sortConfig]);

  // Totals
  const grandSisaStock = filteredSummaries.reduce((sum, s) => sum + s.sisaStock, 0);
  const grandDoOpen = filteredSummaries.reduce((sum, s) => sum + s.qtyDoOpen, 0);
  const grandQtyLepasan = filteredSummaries.reduce((sum, s) => sum + s.qtyLepasan, 0);

  // Trigger Auto-Reconcile
  const handleRunReconciliation = async () => {
    setIsReconciling(true);
    setReconcileResultText(null);
    try {
      let res;
      if (onRunAutoReconcile) {
        res = await onRunAutoReconcile();
      } else {
        res = await autoReconcileDoOpen(doOpen, transaksiKeluar);
      }

      if (res && res.deletedCount > 0) {
        const text = `Rekonsiliasi Selesai! ${res.deletedCount} DO OPEN (Nomor: ${res.deletedDocs.join(', ')}) yang telah direalisasikan di Transaksi Keluar otomatis terhapus dari database.`;
        setReconcileResultText(text);
        if (onAutoReconciledNotice) {
          onAutoReconciledNotice(res.deletedCount, res.deletedDocs);
        }
      } else {
        setReconcileResultText('Semua data DO OPEN dan Transaksi Keluar sudah sesuai (terekonsiliasi sempurna).');
      }
    } catch (err: any) {
      console.error(err);
      setReconcileResultText(`Gagal rekonsiliasi: ${err.message || 'Error'}`);
    } finally {
      setIsReconciling(false);
    }
  };

  // Export Excel
  const handleExport = () => {
    const exportData = filteredSummaries.map(s => ({
      'Item Code': s.itemCode,
      'Item Name': s.itemName,
      'Group Name': s.groupName,
      'Sisa Stock (Fisik)': s.sisaStock,
      'Qty DO OPEN (Alokasi DO)': s.qtyDoOpen,
      'Qty Lepasan (Bebas Alokasi)': s.qtyLepasan,
      'Status Stock': s.qtyLepasan < 0 ? 'Over Committed (Kekurangan Stok)' : s.qtyLepasan === 0 ? 'Alokasi Penuh' : 'Stok Bebas Tersedia'
    }));
    exportToExcel(exportData, 'Laporan_Rekonsiliasi_Stock_Gudang', 'Rekonsiliasi Stock');
  };

  return (
    <div className="space-y-6">
      
      {/* Header View */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded border border-slate-200 shadow-xs mb-3">
        <div>
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-purple-600" />
            Rekonsiliasi Stock & Qty Lepasan
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
            Rumus: Qty Lepasan = Sisa Stock - Qty DO OPEN
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={handleRunReconciliation}
            disabled={isReconciling}
            className="flex items-center gap-1 px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded shadow-xs transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isReconciling ? 'animate-spin' : ''}`} />
            Jalankan Rekonsiliasi Otomatis
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

      {/* Reconcile Status Notice */}
      {reconcileResultText && (
        <div className="p-2 bg-purple-50 border border-purple-200 text-purple-900 rounded text-[11px] flex items-center gap-2 mb-3">
          <Sparkles className="w-3.5 h-3.5 text-purple-600 shrink-0" />
          <span className="font-medium">{reconcileResultText}</span>
        </div>
      )}

      {/* Summary Formula Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
        
        <div className="bg-white p-2.5 rounded border border-slate-200 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500">1. Sisa Stock (Fisik)</span>
          <span className="text-base font-bold text-cyan-700 font-mono block mt-0.5">
            {grandSisaStock.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
          </span>
          <span className="text-[10px] text-slate-400 mt-0.5 block">Total Masuk - Total Keluar</span>
        </div>

        <div className="bg-white p-2.5 rounded border border-slate-200 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500">2. Qty DO OPEN (Order Pending)</span>
          <span className="text-base font-bold text-amber-600 font-mono block mt-0.5">
            {grandDoOpen.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
          </span>
          <span className="text-[10px] text-slate-400 mt-0.5 block font-mono">Total alokasi pesanan DO</span>
        </div>

        <div className="bg-white p-2.5 rounded border border-purple-200 bg-purple-50/20 shadow-xs">
          <span className="text-[11px] font-semibold text-purple-700">3. Qty Lepasan (Bebas)</span>
          <span className="text-base font-bold text-purple-700 font-mono block mt-0.5">
            {grandQtyLepasan.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
          </span>
          <span className="text-[10px] text-purple-600/80 mt-0.5 block">Sisa Stock - Qty DO OPEN</span>
        </div>

      </div>

      {/* Filter Bar */}
      <FilterBar
        filters={filters}
        onFilterChange={setFilters}
        categories={categories}
        placeholder="Cari berdasarkan Item Code, Item Name, Group..."
      />

      {/* Rekonsiliasi Table */}
      <div className="bg-white rounded border border-slate-200 shadow-xs overflow-hidden mt-3">
        <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between bg-slate-100/70">
          <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
            Laporan Rekonsiliasi Stock & Qty Lepasan ({filteredSummaries.length} Item)
            {loadingSummaries && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
          </span>

          <span className="text-[10px] text-slate-500 flex items-center gap-1 font-mono">
            <Info className="w-3 h-3 text-blue-500" />
            Autoclean: Transaksi Keluar matching DO OPEN auto-deleted
          </span>
        </div>

        <div className="overflow-x-auto max-h-[calc(100vh-280px)]">
          <table className="w-full text-left data-grid text-[11px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <SortableHeader
                  label="Item Code"
                  field="itemCode"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
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
                  label="Sisa Stock (A)"
                  field="sisaStock"
                  align="right"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Qty DO OPEN (B)"
                  field="qtyDoOpen"
                  align="right"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Qty Lepasan (A - B)"
                  field="qtyLepasan"
                  align="right"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <th className="p-2 text-center">Status Rekonsiliasi</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {paginatedSummaries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400 text-xs">
                    Tidak ada data Rekonsiliasi yang ditemukan.
                  </td>
                </tr>
              ) : (
                paginatedSummaries.map((s) => {
                  let statusBadge = (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 text-[10px] font-semibold bg-emerald-50 text-emerald-700 rounded border border-emerald-200">
                      <CheckCircle2 className="w-3 h-3" />
                      Siap Alokasi
                    </span>
                  );

                  if (s.qtyLepasan < 0) {
                    statusBadge = (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.2 text-[10px] font-semibold bg-rose-50 text-rose-700 rounded border border-rose-200">
                        <AlertTriangle className="w-3 h-3" />
                        DO Over Committed
                      </span>
                    );
                  } else if (s.qtyLepasan === 0 && s.qtyDoOpen > 0) {
                    statusBadge = (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.2 text-[10px] font-semibold bg-amber-50 text-amber-800 rounded border border-amber-200">
                        <Info className="w-3 h-3" />
                        Reserved Penuh
                      </span>
                    );
                  }

                  return (
                    <tr key={s.itemCode} className="hover:bg-slate-50 transition">
                      <td className="p-2 font-mono font-bold text-purple-700">{s.itemCode}</td>
                      <td className="p-2 font-medium text-slate-800">{s.itemName}</td>
                      <td className="p-2">
                        <span className="px-1.5 py-0.2 text-[10px] font-medium bg-slate-100 text-slate-700 rounded border border-slate-200">
                          {s.groupName}
                        </span>
                      </td>
                      <td className="p-2 text-right font-mono font-semibold text-cyan-700">
                        {s.sisaStock}
                      </td>
                      <td className="p-2 text-right font-mono font-semibold text-amber-600">
                        {s.qtyDoOpen}
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-purple-700 text-xs">
                        {s.qtyLepasan}
                      </td>
                      <td className="p-2 text-center">{statusBadge}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 p-2 pt-3 text-xs text-slate-600 font-mono border-t border-slate-100 mt-1">
          <div>
            Menampilkan {sortedSummaries.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1} - {Math.min(safePage * PAGE_SIZE, sortedSummaries.length)} dari {sortedSummaries.length.toLocaleString('id-ID', { maximumFractionDigits: 0 })} item
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

    </div>
  );
};
