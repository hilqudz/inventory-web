import React, { useState, useMemo, useEffect } from 'react';
import {
  Boxes,
  FileSpreadsheet,
  Download,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  TrendingDown,
  RefreshCw,
  Mail,
  Loader2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { MasterItem, TransactionRecord, SisaStockSummary, DateCategoryFilter } from '../types';
import { FilterBar } from '../components/FilterBar';
import { SortableHeader } from '../components/SortableHeader';
import { sortData, SortConfig } from '../utils/sorting';
import { exportToExcel } from '../utils/excel';
import { EmailRekapTahunReportModal } from '../components/EmailRekapTahunReportModal';
import { fetchSisaStockView } from '../api';

interface SisaStockViewProps {
  masterItems: MasterItem[];
  transaksiMasuk: TransactionRecord[];
  transaksiKeluar: TransactionRecord[];
  onOpenImport: () => void;
  onRestoreStockData?: () => void;
  isSyncing?: boolean;
}

export const SisaStockView: React.FC<SisaStockViewProps> = ({
  masterItems,
  transaksiMasuk,
  transaksiKeluar,
  onOpenImport,
  onRestoreStockData,
  isSyncing = false
}) => {
  const [showEmailRekapModal, setShowEmailRekapModal] = useState(false);
  const [filters, setFilters] = useState<DateCategoryFilter>({
    searchQuery: '',
    startDate: '',
    endDate: '',
    category: ''
  });

  // Extract Categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    masterItems.forEach(i => { if (i.groupName) set.add(i.groupName); });
    transaksiMasuk.forEach(t => { if (t.category) set.add(t.category); });
    return Array.from(set);
  }, [masterItems, transaksiMasuk]);

  // Sisa Stock = Total Masuk - Total Keluar — dihitung SERVER-SIDE (VIEW SisaStock
  // atau query parameterized kalau ada filter tanggal), bukan loop di browser atas
  // 13rb+ item. Lihat src/reportRoutes.ts GET /api/reports/sisa-stock.
  const [stockSummaries, setStockSummaries] = useState<SisaStockSummary[]>([]);
  const [loadingStock, setLoadingStock] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingStock(true);
    // Debounce supaya tidak fetch tiap keystroke saat user ganti tanggal
    const timer = setTimeout(async () => {
      const rows: any[] = await fetchSisaStockView(filters.startDate || undefined, filters.endDate || undefined);
      if (cancelled) return;
      setStockSummaries(
        rows.map((r) => ({
          itemCode: r.item_code,
          itemName: r.item_name,
          groupName: r.group_name || 'Umum',
          hargaJual: Number(r.harga_jual || 0),
          hargaBeli: Number(r.harga_beli || 0), // OPR: field ini tidak dikirim server, default 0
          totalMasuk: Number(r.total_masuk || 0),
          totalKeluar: Number(r.total_keluar || 0),
          sisaStock: Number(r.sisa_stock || 0),
          nilaiHargaJualSisaStock: Number(r.nilai_stock_jual || 0),
          nilaiHargaBeliSisaStock: Number(r.nilai_stock_beli || 0),
        }))
      );
      setLoadingStock(false);
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [filters.startDate, filters.endDate]);

  // Filtered Summaries
  const filteredSummaries = useMemo(() => {
    return stockSummaries.filter(item => {
      // Search
      const query = filters.searchQuery.toLowerCase();
      const matchSearch = !query || 
        item.itemCode.toLowerCase().includes(query) ||
        item.itemName.toLowerCase().includes(query) ||
        item.groupName.toLowerCase().includes(query);

      // Category
      const matchCategory = !filters.category || item.groupName === filters.category;

      return matchSearch && matchCategory;
    });
  }, [stockSummaries, filters]);

  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'sisaStock', direction: 'desc' });

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

  // Pagination — cegah render ribuan baris DOM sekaligus (lihat MasterItemView)
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
  const grandTotalMasuk = filteredSummaries.reduce((sum, s) => sum + s.totalMasuk, 0);
  const grandTotalKeluar = filteredSummaries.reduce((sum, s) => sum + s.totalKeluar, 0);
  const grandSisaStock = filteredSummaries.reduce((sum, s) => sum + s.sisaStock, 0);
  const grandNilaiHargaJual = filteredSummaries.reduce((sum, s) => sum + s.nilaiHargaJualSisaStock, 0);
  const grandNilaiHargaBeli = filteredSummaries.reduce((sum, s) => sum + s.nilaiHargaBeliSisaStock, 0);

  // Helper currency formatter
  const formatCurrency = (val: number) => {
    return 'Rp ' + val.toLocaleString('id-ID', { maximumFractionDigits: 0 });
  };

  // Export Excel
  const handleExport = () => {
    const exportData = filteredSummaries.map(s => ({
      'Item Code': s.itemCode,
      'Item Name': s.itemName,
      'Group Name': s.groupName,
      'Harga Beli (Rp)': s.hargaBeli,
      'Harga Jual (Rp)': s.hargaJual,
      'Total Masuk': s.totalMasuk,
      'Total Keluar': s.totalKeluar,
      'Sisa Stock': s.sisaStock,
      'Total Nilai Harga Beli Sisa Stock (Rp)': s.nilaiHargaBeliSisaStock,
      'Total Nilai Harga Jual Sisa Stock (Rp)': s.nilaiHargaJualSisaStock,
      'Status Stock': s.sisaStock <= 0 ? 'Habis/Minus' : s.sisaStock <= 30 ? 'Perlu Restock' : 'Aman'
    }));
    exportToExcel(exportData, 'Laporan_Sisa_Stock_Gudang', 'Sisa Stock');
  };

  return (
    <div className="space-y-6">
      
      {/* Header View */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded border border-slate-200 shadow-xs mb-3">
        <div>
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Boxes className="w-4 h-4 text-cyan-600" />
            Laporan Sisa Stock & Nilai Invetaris
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
            Rumus: Sisa Stock = Total Transaksi Masuk - Total Transaksi Keluar | Nilai Stock = Sisa Stock &times; Harga
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {onRestoreStockData && (
            <button
              onClick={onRestoreStockData}
              disabled={isSyncing}
              className="flex items-center gap-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded shadow-xs transition disabled:opacity-50"
              title="Pulihkan & kembalikan seluruh data transaksi stock (Masuk & Keluar) dari Local Cache ke Database SQL Server"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              Pulihkan Stock Qty
            </button>
          )}

          <button
            onClick={() => setShowEmailRekapModal(true)}
            className="flex items-center gap-1.5 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded shadow-xs transition cursor-pointer"
            title="Kirim Laporan Email Rekapitulasi Stock & Nilai Beli Per Tahun (Created Date)"
          >
            <Mail className="w-3.5 h-3.5" />
            Report Email Rekap Per Tahun
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

      {/* Metric Highlights */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
        <div className="bg-white p-2.5 rounded border border-slate-200 shadow-xs">
          <span className="text-[10px] font-semibold text-slate-500 block">Total Masuk</span>
          <span className="text-sm font-bold text-emerald-600 font-mono block mt-0.5">
            +{grandTotalMasuk.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
          </span>
        </div>

        <div className="bg-white p-2.5 rounded border border-slate-200 shadow-xs">
          <span className="text-[10px] font-semibold text-slate-500 block">Total Keluar</span>
          <span className="text-sm font-bold text-rose-600 font-mono block mt-0.5">
            -{grandTotalKeluar.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
          </span>
        </div>

        <div className="bg-white p-2.5 rounded border border-slate-200 shadow-xs">
          <span className="text-[10px] font-semibold text-slate-500 block">Total Sisa Stock</span>
          <span className="text-sm font-bold text-cyan-700 font-mono block mt-0.5">
            {grandSisaStock.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit
          </span>
        </div>

        <div className="bg-white p-2.5 rounded border border-blue-200 bg-blue-50/20 shadow-xs">
          <span className="text-[10px] font-semibold text-blue-800 block">Nilai Sisa Stock (Harga Beli)</span>
          <span className="text-sm font-bold text-blue-700 font-mono block mt-0.5">
            {formatCurrency(grandNilaiHargaBeli)}
          </span>
        </div>

        <div className="bg-white p-2.5 rounded border border-emerald-200 bg-emerald-50/20 shadow-xs">
          <span className="text-[10px] font-semibold text-emerald-800 block">Nilai Sisa Stock (Harga Jual)</span>
          <span className="text-sm font-bold text-emerald-700 font-mono block mt-0.5">
            {formatCurrency(grandNilaiHargaJual)}
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <FilterBar
        filters={filters}
        onFilterChange={setFilters}
        categories={categories}
        placeholder="Cari berdasarkan Item Code, Item Name, Group..."
      />

      {/* Stock Table */}
      <div className="bg-white rounded border border-slate-200 shadow-xs overflow-hidden mt-3">
        <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between bg-slate-100/70">
          <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
            Laporan Perhitungan Sisa Stock & Nilai Inventaris ({filteredSummaries.length} Item)
          </span>
          {loadingStock && (
            <span className="flex items-center gap-1 text-[10px] text-slate-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              Menghitung...
            </span>
          )}
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
                  label="Harga Beli"
                  field="hargaBeli"
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
                  label="Total Masuk"
                  field="totalMasuk"
                  align="right"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Total Keluar"
                  field="totalKeluar"
                  align="right"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Sisa Stock"
                  field="sisaStock"
                  align="right"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Nilai Stock (Beli)"
                  field="nilaiHargaBeliSisaStock"
                  align="right"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Nilai Stock (Jual)"
                  field="nilaiHargaJualSisaStock"
                  align="right"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <th className="p-2 text-center">Status Stok</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {paginatedSummaries.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-6 text-center text-slate-400 text-xs">
                    Tidak ada data Sisa Stock yang ditemukan.
                  </td>
                </tr>
              ) : (
                paginatedSummaries.map((s) => {
                  let statusBadge = (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 text-[10px] font-semibold bg-emerald-50 text-emerald-700 rounded border border-emerald-200">
                      <CheckCircle2 className="w-3 h-3" />
                      Aman
                    </span>
                  );

                  if (s.sisaStock <= 0) {
                    statusBadge = (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.2 text-[10px] font-semibold bg-rose-50 text-rose-700 rounded border border-rose-200">
                        <AlertCircle className="w-3 h-3" />
                        Habis / Minus
                      </span>
                    );
                  } else if (s.sisaStock <= 30) {
                    statusBadge = (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.2 text-[10px] font-semibold bg-amber-50 text-amber-700 rounded border border-amber-200">
                        <AlertTriangle className="w-3 h-3" />
                        Restock (&le;30)
                      </span>
                    );
                  }

                  return (
                    <tr key={s.itemCode} className="hover:bg-slate-50 transition">
                      <td className="p-2 font-mono font-bold text-cyan-700">{s.itemCode}</td>
                      <td className="p-2 font-medium text-slate-800">{s.itemName}</td>
                      <td className="p-2">
                        <span className="px-1.5 py-0.2 text-[10px] font-medium bg-slate-100 text-slate-700 rounded border border-slate-200">
                          {s.groupName}
                        </span>
                      </td>
                      <td className="p-2 text-right font-mono text-slate-700">
                        {formatCurrency(s.hargaBeli)}
                      </td>
                      <td className="p-2 text-right font-mono text-emerald-700">
                        {formatCurrency(s.hargaJual)}
                      </td>
                      <td className="p-2 text-right font-mono font-semibold text-emerald-600">
                        +{s.totalMasuk}
                      </td>
                      <td className="p-2 text-right font-mono font-semibold text-rose-600">
                        -{s.totalKeluar}
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-slate-900 text-xs">
                        {s.sisaStock}
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-blue-700">
                        {formatCurrency(s.nilaiHargaBeliSisaStock)}
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-emerald-700">
                        {formatCurrency(s.nilaiHargaJualSisaStock)}
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

      {/* Email Rekap Per Tahun Report Modal */}
      <EmailRekapTahunReportModal
        isOpen={showEmailRekapModal}
        onClose={() => setShowEmailRekapModal(false)}
        masterItems={masterItems}
        transaksiMasuk={transaksiMasuk}
        transaksiKeluar={transaksiKeluar}
      />

    </div>
  );
};
