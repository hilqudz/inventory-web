import React, { useState, useMemo } from 'react';
import { 
  X, 
  Download, 
  Search, 
  Calendar, 
  MapPin, 
  Building2, 
  Package, 
  DollarSign, 
  FileText, 
  Truck, 
  Filter,
  CheckCircle2,
  TrendingUp,
  Layers,
  BarChart3,
  Mail
} from 'lucide-react';
import { DoOpenRecord, MasterItem, getDoOpenLogistikGroup } from '../types';
import { exportToExcel } from '../utils/excel';
import { EmailDoOpenReportModal } from './EmailDoOpenReportModal';

interface ReportDoOpenModalProps {
  isOpen: boolean;
  onClose: () => void;
  records: DoOpenRecord[];
  masterItems: MasterItem[];
}

export const ReportDoOpenModal: React.FC<ReportDoOpenModalProps> = ({
  isOpen,
  onClose,
  records,
  masterItems
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'spv' | 'location'>('all');
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);

  // Master items fast lookup map
  const masterMap = useMemo(() => {
    const map = new Map<string, MasterItem>();
    masterItems.forEach(m => map.set(m.itemCode, m));
    return map;
  }, [masterItems]);

  // Filter records to ONLY DO OPEN that are in Logistik (BARANG SUDAH DI LOGISTIK / SIAP KIRIM)
  const logistikRecords = useMemo(() => {
    return records.filter(r => {
      const isLogistik = getDoOpenLogistikGroup(r.category) === 'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)';
      if (!isLogistik) return false;

      // Date filter
      let matchDate = true;
      if (startDate && r.postingDate < startDate) matchDate = false;
      if (endDate && r.postingDate > endDate) matchDate = false;

      // Search query
      const query = searchQuery.toLowerCase().trim();
      const m = masterMap.get(r.itemCode);
      const matchSearch = !query ||
        (r.documentNo && r.documentNo.toLowerCase().includes(query)) ||
        (r.itemCode && r.itemCode.toLowerCase().includes(query)) ||
        (m?.itemName && m.itemName.toLowerCase().includes(query)) ||
        (r.remark && r.remark.toLowerCase().includes(query)) ||
        (r.entryName && r.entryName.toLowerCase().includes(query)) ||
        (r.toLocation && r.toLocation.toLowerCase().includes(query));

      return matchDate && matchSearch;
    });
  }, [records, startDate, endDate, searchQuery, masterMap]);

  // 1. Group by Area SPV
  const spvBreakdown = useMemo(() => {
    const map = new Map<string, {
      areaSpv: string;
      docSet: Set<string>;
      recordCount: number;
      totalQty: number;
      totalNilaiJual: number;
      totalNilaiBeli: number;
    }>();

    logistikRecords.forEach(r => {
      const spv = (r.remark || 'Tanpa Area SPV').trim() || 'Tanpa Area SPV';
      const docNo = (r.documentNo || '').trim().toUpperCase();
      const qty = Number(r.qty) || 0;
      const m = masterMap.get(r.itemCode);
      const nilaiJual = qty * (m?.hargaJual || 0);
      const nilaiBeli = qty * (m?.hargaBeli || 0);

      if (!map.has(spv)) {
        map.set(spv, {
          areaSpv: spv,
          docSet: new Set<string>(),
          recordCount: 0,
          totalQty: 0,
          totalNilaiJual: 0,
          totalNilaiBeli: 0
        });
      }

      const existing = map.get(spv)!;
      if (docNo) existing.docSet.add(docNo);
      existing.recordCount += 1;
      existing.totalQty += qty;
      existing.totalNilaiJual += nilaiJual;
      existing.totalNilaiBeli += nilaiBeli;
    });

    return Array.from(map.values()).map(item => ({
      ...item,
      docCount: item.docSet.size
    })).sort((a, b) => b.totalQty - a.totalQty);
  }, [logistikRecords, masterMap]);

  // 2. Group by Location (Tujuan / Location)
  const locationBreakdown = useMemo(() => {
    const map = new Map<string, {
      locationName: string;
      docSet: Set<string>;
      recordCount: number;
      totalQty: number;
      totalNilaiJual: number;
      totalNilaiBeli: number;
    }>();

    logistikRecords.forEach(r => {
      const loc = (r.toLocation || 'Tanpa Lokasi').trim() || 'Tanpa Lokasi';
      const docNo = (r.documentNo || '').trim().toUpperCase();
      const qty = Number(r.qty) || 0;
      const m = masterMap.get(r.itemCode);
      const nilaiJual = qty * (m?.hargaJual || 0);
      const nilaiBeli = qty * (m?.hargaBeli || 0);

      if (!map.has(loc)) {
        map.set(loc, {
          locationName: loc,
          docSet: new Set<string>(),
          recordCount: 0,
          totalQty: 0,
          totalNilaiJual: 0,
          totalNilaiBeli: 0
        });
      }

      const existing = map.get(loc)!;
      if (docNo) existing.docSet.add(docNo);
      existing.recordCount += 1;
      existing.totalQty += qty;
      existing.totalNilaiJual += nilaiJual;
      existing.totalNilaiBeli += nilaiBeli;
    });

    return Array.from(map.values()).map(item => ({
      ...item,
      docCount: item.docSet.size
    })).sort((a, b) => b.totalQty - a.totalQty);
  }, [logistikRecords, masterMap]);

  // Grand Totals
  const grandTotals = useMemo(() => {
    const globalDocSet = new Set<string>();
    let totalQty = 0;
    let totalNilaiJual = 0;
    let totalNilaiBeli = 0;

    logistikRecords.forEach(r => {
      const docNo = (r.documentNo || '').trim().toUpperCase();
      if (docNo) globalDocSet.add(docNo);
      const q = Number(r.qty) || 0;
      totalQty += q;
      const m = masterMap.get(r.itemCode);
      totalNilaiJual += q * (m?.hargaJual || 0);
      totalNilaiBeli += q * (m?.hargaBeli || 0);
    });

    return {
      totalDoc: globalDocSet.size,
      totalRecords: logistikRecords.length,
      totalQty,
      totalNilaiJual,
      totalNilaiBeli
    };
  }, [logistikRecords, masterMap]);

  // Handle Export
  const handleExport = () => {
    if (logistikRecords.length === 0) {
      alert('Tidak ada data DO OPEN Logistik untuk diexport.');
      return;
    }

    const exportData = logistikRecords.map((r, idx) => {
      const m = masterMap.get(r.itemCode);
      const q = Number(r.qty) || 0;
      const hj = m?.hargaJual || 0;
      const hb = m?.hargaBeli || 0;

      return {
        'No': idx + 1,
        'Tanggal Posting': r.postingDate,
        'No DO': r.documentNo,
        'Kode Barang': r.itemCode,
        'Nama Barang': m?.itemName || '-',
        'Group Name': m?.groupName || 'Tanpa Group',
        'Area SPV (Remark)': r.remark || '-',
        'Area RM (Entry)': r.entryName || '-',
        'Status DO': r.category,
        'Tujuan (Location)': r.toLocation || '-',
        'Qty (Pcs)': q,
        'Harga Beli Satuan': hb,
        'Total Nilai Beli': q * hb
      };
    });

    exportToExcel(exportData, 'Report_DO_OPEN_Logistik', 'DO OPEN Logistik');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-950/85 backdrop-blur-xs p-1.5 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-amber-500/30 w-full max-w-6xl rounded-xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[96dvh] sm:h-auto sm:max-h-[92vh] my-auto">
        
        {/* Header */}
        <div className="p-3 sm:p-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0 sticky top-0 z-20">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 sm:p-2.5 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20 shrink-0">
              <BarChart3 className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs sm:text-base font-bold text-white flex items-center gap-1.5 flex-wrap">
                <span className="truncate">REPORT DO OPEN (LOGISTIK)</span>
                <span className="text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                  {grandTotals.totalDoc} DO OPEN
                </span>
              </h2>
              <p className="text-[10px] sm:text-xs text-slate-400 hidden sm:block">
                Laporan & Dashboard DO OPEN yang sudah berada di Logistik per Area SPV dan Lokasi
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setIsEmailModalOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-[11px] sm:text-xs font-semibold rounded-lg transition shadow-xs cursor-pointer"
              title="Report Email DO OPEN"
            >
              <Mail className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden md:inline">Report Email DO OPEN</span>
              <span className="md:hidden">Email</span>
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] sm:text-xs font-semibold rounded-lg transition shadow-xs cursor-pointer"
              title="Export Excel"
            >
              <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden md:inline">Export Excel</span>
              <span className="md:hidden">Excel</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-3 sm:p-4 overflow-y-auto flex-1 space-y-4 bg-slate-950 overscroll-contain touch-pan-y">

          {/* Filter Bar */}
          <div className="p-2.5 sm:p-3 bg-slate-900/90 rounded-xl border border-slate-800/80 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Cari No DO, Item, Area SPV, Lokasi..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs w-full sm:w-auto justify-between sm:justify-start">
              <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-lg border border-slate-700 text-slate-300 text-[11px] sm:text-xs">
                <Calendar className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-transparent text-slate-200 focus:outline-none w-24 sm:w-auto"
                />
                <span className="text-slate-500">-</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-transparent text-slate-200 focus:outline-none w-24 sm:w-auto"
                />
              </div>

              {(startDate || endDate || searchQuery) && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setStartDate('');
                    setEndDate('');
                  }}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-amber-400 text-xs rounded border border-slate-700 shrink-0"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* Global Metric Cards Header */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
            <div className="bg-slate-900 p-2.5 sm:p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">Total DO OPEN</span>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-lg sm:text-xl font-bold font-mono text-white">{grandTotals.totalDoc.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                <span className="text-[10px] sm:text-xs text-slate-400">DO</span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">{grandTotals.totalRecords.toLocaleString('id-ID', { maximumFractionDigits: 0 })} baris item</span>
            </div>

            <div className="bg-slate-900 p-2.5 sm:p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">Total Qty (Pcs)</span>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-lg sm:text-xl font-bold font-mono text-amber-300">{grandTotals.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                <span className="text-[10px] sm:text-xs text-amber-400/80">Pcs</span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">Sudah siap dikirim</span>
            </div>

            <div className="bg-slate-900 p-2.5 sm:p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider block">Total Nilai Beli</span>
              <div className="mt-1">
                <span className="text-sm sm:text-lg font-bold font-mono text-cyan-400">
                  Rp {grandTotals.totalNilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                </span>
              </div>
              <span className="text-[10px] text-cyan-500/80 block mt-0.5">Nilai Modal Barang</span>
            </div>
          </div>

          {/* Tab Selection */}
          <div className="pt-2 border-b border-slate-800 flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-thin">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 text-xs font-bold rounded-t-lg transition flex items-center gap-1.5 border-t border-x whitespace-nowrap ${
                activeTab === 'all'
                  ? 'bg-slate-950 text-amber-400 border-amber-500/40 border-b-transparent'
                  : 'bg-slate-900/50 text-slate-400 hover:text-slate-200 border-transparent'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Semua Laporan</span>
            </button>
            <button
              onClick={() => setActiveTab('spv')}
              className={`px-3 py-1.5 text-xs font-bold rounded-t-lg transition flex items-center gap-1.5 border-t border-x whitespace-nowrap ${
                activeTab === 'spv'
                  ? 'bg-slate-950 text-amber-400 border-amber-500/40 border-b-transparent'
                  : 'bg-slate-900/50 text-slate-400 hover:text-slate-200 border-transparent'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Report Per Area SPV ({spvBreakdown.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('location')}
              className={`px-3 py-1.5 text-xs font-bold rounded-t-lg transition flex items-center gap-1.5 border-t border-x whitespace-nowrap ${
                activeTab === 'location'
                  ? 'bg-slate-950 text-amber-400 border-amber-500/40 border-b-transparent'
                  : 'bg-slate-900/50 text-slate-400 hover:text-slate-200 border-transparent'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" />
              <span>Kartu Dashboard Per Lokasi ({locationBreakdown.length})</span>
            </button>
          </div>
          
          {/* SECTION 1: REPORT PER AREA SPV */}
          {(activeTab === 'all' || activeTab === 'spv') && (
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    1. Total DO OPEN Logistik Per Area SPV
                  </h3>
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  {spvBreakdown.length} Area SPV
                </span>
              </div>

              {spvBreakdown.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-xs">
                  Tidak ada data DO OPEN di Logistik untuk ditampilkan.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-800">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-950/80 text-amber-400 font-bold border-b border-slate-800 uppercase tracking-wider text-[11px]">
                      <tr>
                        <th className="p-2.5 text-center w-12">No</th>
                        <th className="p-2.5">Area SPV (Remark)</th>
                        <th className="p-2.5 text-right">Total No DO</th>
                        <th className="p-2.5 text-right">Total Item</th>
                        <th className="p-2.5 text-right">Total Qty (Pcs)</th>
                        <th className="p-2.5 text-right">Total Nilai Beli</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {spvBreakdown.map((row, idx) => (
                        <tr key={row.areaSpv} className="hover:bg-slate-800/50 transition">
                          <td className="p-2.5 text-center text-slate-500 font-sans">{idx + 1}</td>
                          <td className="p-2.5 font-sans font-bold text-slate-100">{row.areaSpv}</td>
                          <td className="p-2.5 text-right text-amber-300 font-bold">{row.docCount.toLocaleString('id-ID', { maximumFractionDigits: 0 })} DO</td>
                          <td className="p-2.5 text-right text-slate-400">{row.recordCount.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
                          <td className="p-2.5 text-right text-amber-400 font-bold">{row.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
                          <td className="p-2.5 text-right text-cyan-400 font-bold">
                            Rp {row.totalNilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-950 font-bold text-xs text-white border-t border-slate-700">
                      <tr>
                        <td colSpan={2} className="p-2.5 text-amber-400 uppercase tracking-wider text-right">
                          Grand Total
                        </td>
                        <td className="p-2.5 text-right font-mono text-amber-300">{grandTotals.totalDoc.toLocaleString('id-ID', { maximumFractionDigits: 0 })} DO</td>
                        <td className="p-2.5 text-right font-mono text-slate-400">{grandTotals.totalRecords.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
                        <td className="p-2.5 text-right font-mono text-amber-400">{grandTotals.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
                        <td className="p-2.5 text-right font-mono text-cyan-400">
                          Rp {grandTotals.totalNilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* SECTION 2: KARTU DASHBOARD DO OPEN PER LOKASI */}
          {(activeTab === 'all' || activeTab === 'location') && (
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    2. Kartu Dashboard DO OPEN Sesuai Lokasi / Tujuan
                  </h3>
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  {locationBreakdown.length} Lokasi
                </span>
              </div>

              {locationBreakdown.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-xs">
                  Tidak ada data lokasi DO OPEN untuk ditampilkan.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
                  {locationBreakdown.map((loc) => (
                    <div
                      key={loc.locationName}
                      className="bg-slate-950 p-4 rounded-xl border border-slate-800 hover:border-amber-500/40 transition shadow-sm space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
                          <h4 className="text-xs font-bold text-white truncate max-w-[180px]" title={loc.locationName}>
                            {loc.locationName}
                          </h4>
                        </div>
                        <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 text-[10px] font-bold font-mono rounded-full border border-amber-500/30 shrink-0">
                          {loc.docCount} DO
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                        <div className="bg-slate-900 p-2 rounded-lg border border-slate-800/80">
                          <span className="text-[10px] font-sans text-slate-400 block">Total Qty</span>
                          <span className="font-bold text-amber-300 text-sm">
                            {loc.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} <span className="text-[10px] font-normal text-slate-400">pcs</span>
                          </span>
                        </div>
                        <div className="bg-slate-900 p-2 rounded-lg border border-slate-800/80">
                          <span className="text-[10px] font-sans text-slate-400 block">Total Line Item</span>
                          <span className="font-bold text-slate-300 text-sm">
                            {loc.recordCount.toLocaleString('id-ID', { maximumFractionDigits: 0 })} <span className="text-[10px] font-normal text-slate-400">baris</span>
                          </span>
                        </div>
                      </div>

                      <div className="space-y-1.5 pt-1 text-xs">
                        <div className="flex items-center justify-between p-2 bg-cyan-950/30 border border-cyan-900/40 rounded-lg">
                          <span className="text-slate-400 text-[11px]">Total Nilai Beli:</span>
                          <span className="font-bold font-mono text-cyan-400">
                            Rp {loc.totalNilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

      </div>

      {/* EMAIL REPORT SUB-MODAL */}
      <EmailDoOpenReportModal
        isOpen={isEmailModalOpen}
        onClose={() => setIsEmailModalOpen(false)}
        spvBreakdown={spvBreakdown}
        locationBreakdown={locationBreakdown}
        grandTotals={grandTotals}
      />
    </div>
  );
};
