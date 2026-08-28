import React, { useState, useMemo } from 'react';
import { 
  X, 
  Download, 
  Search, 
  Calendar, 
  MapPin, 
  Building2, 
  CheckCircle2, 
  Truck, 
  Send,
  Layers,
  FileCheck,
  Package,
  BarChart3,
  Mail
} from 'lucide-react';
import { RequestDoRecord, DoOpenRecord, TransactionRecord, MasterItem } from '../types';
import { exportToExcel } from '../utils/excel';
import { EmailDoOpenKirimReportModal } from './EmailDoOpenKirimReportModal';

interface ReportDoOpenKirimModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestDoOpenRecords: RequestDoRecord[];
  records?: DoOpenRecord[];
  transaksiKeluar?: TransactionRecord[];
  masterItems: MasterItem[];
}

export const ReportDoOpenKirimModal: React.FC<ReportDoOpenKirimModalProps> = ({
  isOpen,
  onClose,
  requestDoOpenRecords = [],
  records = [],
  transaksiKeluar = [],
  masterItems = []
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'spv' | 'location' | 'detail'>('all');
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);

  // Master items price lookup map
  const masterMap = useMemo(() => {
    const map = new Map<string, MasterItem>();
    masterItems.forEach(m => map.set(m.itemCode, m));
    return map;
  }, [masterItems]);

  const doOpenMap = useMemo(() => {
    const map = new Map<string, string>();
    (records || []).forEach(d => {
      const ket = (d.keterangan || '').trim();
      if (ket && ket !== '-') {
        if (d.id) map.set(d.id, ket);
        if (d.documentNo && d.itemCode) {
          map.set(`${d.documentNo.trim().toUpperCase()}_${d.itemCode.trim().toUpperCase()}`, ket);
        }
        if (d.documentNo && !map.has(d.documentNo.trim().toUpperCase())) {
          map.set(d.documentNo.trim().toUpperCase(), ket);
        }
      }
    });
    return map;
  }, [records]);

  const getKeterangan = (r: RequestDoRecord) => {
    if (r.keterangan && r.keterangan.trim() && r.keterangan.trim() !== '-') {
      return r.keterangan.trim();
    }
    const docNo = (r.documentNo || '').trim().toUpperCase();
    const itemCode = (r.itemCode || '').trim().toUpperCase();
    if (docNo && itemCode && doOpenMap.has(`${docNo}_${itemCode}`)) {
      return doOpenMap.get(`${docNo}_${itemCode}`)!;
    }
    if (r.doOpenId && doOpenMap.has(r.doOpenId)) {
      return doOpenMap.get(r.doOpenId)!;
    }
    if (docNo && doOpenMap.has(docNo)) {
      return doOpenMap.get(docNo)!;
    }
    return '-';
  };

  // Approved request DO OPEN items (Status === 'APPROVED')
  const approvedRequests = useMemo(() => {
    // 1. Get from requestDoOpenRecords where status === 'APPROVED'
    const approvedList = requestDoOpenRecords.filter(r => (r.status || '').toUpperCase() === 'APPROVED');

    // Filter by date and search query
    return approvedList.filter(r => {
      // Date filter
      const reqDateStr = r.postingDate || (r.approvedAt ? r.approvedAt.slice(0, 10) : (r.requestedAt ? r.requestedAt.slice(0, 10) : ''));
      let matchDate = true;
      if (startDate && reqDateStr < startDate) matchDate = false;
      if (endDate && reqDateStr > endDate) matchDate = false;

      // Search query filter
      const query = searchQuery.toLowerCase().trim();
      const m = masterMap.get(r.itemCode);
      const matchSearch = !query ||
        (r.documentNo && r.documentNo.toLowerCase().includes(query)) ||
        (r.itemCode && r.itemCode.toLowerCase().includes(query)) ||
        (m?.itemName && m.itemName.toLowerCase().includes(query)) ||
        (r.remark && r.remark.toLowerCase().includes(query)) ||
        (r.entryName && r.entryName.toLowerCase().includes(query)) ||
        (r.toLocation && r.toLocation.toLowerCase().includes(query)) ||
        (r.approvedBy && r.approvedBy.toLowerCase().includes(query)) ||
        (r.requestedBy && r.requestedBy.toLowerCase().includes(query));

      return matchDate && matchSearch;
    });
  }, [requestDoOpenRecords, startDate, endDate, searchQuery, masterMap]);

  // 1. Group by Area SPV (r.remark)
  const spvBreakdown = useMemo(() => {
    const map = new Map<string, {
      areaSpv: string;
      docSet: Set<string>;
      recordCount: number;
      totalQty: number;
      totalNilaiJual: number;
      totalNilaiBeli: number;
    }>();

    approvedRequests.forEach(r => {
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
  }, [approvedRequests, masterMap]);

  // 2. Group by Location (r.toLocation)
  const locationBreakdown = useMemo(() => {
    const map = new Map<string, {
      locationName: string;
      docSet: Set<string>;
      recordCount: number;
      totalQty: number;
      totalNilaiJual: number;
      totalNilaiBeli: number;
    }>();

    approvedRequests.forEach(r => {
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
  }, [approvedRequests, masterMap]);

  // Grand Totals for Approved / Shipped DO OPEN items
  const grandTotals = useMemo(() => {
    const globalDocSet = new Set<string>();
    let totalQty = 0;
    let totalNilaiJual = 0;
    let totalNilaiBeli = 0;

    approvedRequests.forEach(r => {
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
      totalRecords: approvedRequests.length,
      totalQty,
      totalNilaiJual,
      totalNilaiBeli
    };
  }, [approvedRequests, masterMap]);

  // Export to Excel
  const handleExport = () => {
    if (approvedRequests.length === 0) {
      alert('Tidak ada data DO OPEN Terkirim / Approve untuk diexport.');
      return;
    }

    const exportData = approvedRequests.map((r, idx) => {
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
        'Keterangan': getKeterangan(r),
        'Status Kirim': r.status,
        'Tujuan (Location)': r.toLocation || '-',
        'Requested By': r.requestedBy || '-',
        'Approved By': r.approvedBy || '-',
        'Tanggal Approved': r.approvedAt ? new Date(r.approvedAt).toLocaleDateString('id-ID') : '-',
        'Qty Approve (Pcs)': q,
        'Harga Beli Satuan': hb,
        'Total Nilai Beli': q * hb
      };
    });

    exportToExcel(exportData, 'Report_DO_OPEN_Terkirim_Approve', 'DO OPEN Terkirim');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-950/85 backdrop-blur-xs p-1.5 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-emerald-500/30 w-full max-w-6xl rounded-xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[96dvh] sm:h-auto sm:max-h-[92vh] my-auto">
        
        {/* Header */}
        <div className="p-3 sm:p-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0 sticky top-0 z-20">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 sm:p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20 shrink-0">
              <Truck className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs sm:text-base font-bold text-white flex items-center gap-1.5 flex-wrap">
                <span className="truncate">REPORT DO OPEN KIRIM (APPROVED)</span>
                <span className="text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
                  {grandTotals.totalDoc} DO Approved
                </span>
              </h2>
              <p className="text-[10px] sm:text-xs text-slate-400 hidden sm:block">
                Laporan & Dashboard DO OPEN yang sudah disetujui / terkirim per Area SPV dan Lokasi
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setIsEmailModalOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] sm:text-xs font-semibold rounded-lg transition shadow-xs cursor-pointer"
              title="Report Email DO OPEN Kirim"
            >
              <Mail className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden md:inline">Report Email DO OPEN Kirim</span>
              <span className="md:hidden">Email</span>
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-teal-600 hover:bg-teal-500 text-white text-[11px] sm:text-xs font-semibold rounded-lg transition shadow-xs cursor-pointer"
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
                  placeholder="Cari No DO, Item, Area SPV, Lokasi, Approved By..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
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
                <Calendar className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
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
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-400 text-xs rounded border border-slate-700 shrink-0"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* PROMINENT DASHBOARD CARDS FOR APPROVED DO OPEN ITEMS */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
            
            <div className="bg-slate-900 p-2.5 sm:p-3.5 rounded-xl border border-emerald-500/30 shadow-xs">
              <div className="flex items-center justify-between text-emerald-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">Total DO Approve</span>
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-lg sm:text-2xl font-bold font-mono text-white">{grandTotals.totalDoc.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                <span className="text-[10px] sm:text-xs text-emerald-400 font-semibold">DO</span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">{grandTotals.totalRecords.toLocaleString('id-ID', { maximumFractionDigits: 0 })} baris disetujui</span>
            </div>

            <div className="bg-slate-900 p-2.5 sm:p-3.5 rounded-xl border border-amber-500/30 shadow-xs">
              <div className="flex items-center justify-between text-amber-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">Total Qty Item</span>
                <Package className="w-4 h-4" />
              </div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-lg sm:text-2xl font-bold font-mono text-amber-300">{grandTotals.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
                <span className="text-[10px] sm:text-xs text-amber-400 font-semibold">Pcs</span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">Total Qty Terkirim</span>
            </div>

            <div className="bg-slate-900 p-2.5 sm:p-3.5 rounded-xl border border-cyan-500/30 shadow-xs">
              <div className="flex items-center justify-between text-cyan-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">Nilai Beli Item</span>
                <span className="text-[10px] font-bold font-mono px-1 py-0.2 bg-cyan-500/20 rounded">Rp</span>
              </div>
              <div className="mt-1">
                <span className="text-sm sm:text-lg font-bold font-mono text-cyan-400">
                  Rp {grandTotals.totalNilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                </span>
              </div>
              <span className="text-[10px] text-cyan-500/80 block mt-0.5">Total Nilai Modal</span>
            </div>

          </div>

          {/* Tab Selection */}
          <div className="pt-2 border-b border-slate-800 flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-thin">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 text-xs font-bold rounded-t-lg transition flex items-center gap-1.5 border-t border-x whitespace-nowrap ${
                activeTab === 'all'
                  ? 'bg-slate-950 text-emerald-400 border-emerald-500/40 border-b-transparent'
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
                  ? 'bg-slate-950 text-emerald-400 border-emerald-500/40 border-b-transparent'
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
                  ? 'bg-slate-950 text-emerald-400 border-emerald-500/40 border-b-transparent'
                  : 'bg-slate-900/50 text-slate-400 hover:text-slate-200 border-transparent'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" />
              <span>Kartu Dashboard Per Lokasi ({locationBreakdown.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('detail')}
              className={`px-3 py-1.5 text-xs font-bold rounded-t-lg transition flex items-center gap-1.5 border-t border-x whitespace-nowrap ${
                activeTab === 'detail'
                  ? 'bg-slate-950 text-emerald-400 border-emerald-500/40 border-b-transparent'
                  : 'bg-slate-900/50 text-slate-400 hover:text-slate-200 border-transparent'
              }`}
            >
              <FileCheck className="w-3.5 h-3.5" />
              <span>Rincian Item ({approvedRequests.length})</span>
            </button>
          </div>
          
          {/* SECTION 1: REPORT DO OPEN TERKIRIM PER AREA SPV */}
          {(activeTab === 'all' || activeTab === 'spv') && (
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    1. Total DO OPEN Terkirim / Approved Per Area SPV
                  </h3>
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  {spvBreakdown.length} Area SPV
                </span>
              </div>

              {spvBreakdown.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-xs">
                  Belum ada data DO OPEN terkirim / disetujui (Approved) untuk ditampilkan.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-800">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-950/80 text-emerald-400 font-bold border-b border-slate-800 uppercase tracking-wider text-[11px]">
                      <tr>
                        <th className="p-2.5 text-center w-12">No</th>
                        <th className="p-2.5">Area SPV (Remark)</th>
                        <th className="p-2.5 text-right">Total DO Terkirim</th>
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
                          <td className="p-2.5 text-right text-emerald-300 font-bold">{row.docCount.toLocaleString('id-ID', { maximumFractionDigits: 0 })} DO</td>
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
                        <td colSpan={2} className="p-2.5 text-emerald-400 uppercase tracking-wider text-right">
                          Grand Total
                        </td>
                        <td className="p-2.5 text-right font-mono text-emerald-300">{grandTotals.totalDoc.toLocaleString('id-ID', { maximumFractionDigits: 0 })} DO</td>
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

          {/* SECTION 2: KARTU DASHBOARD DO OPEN TERKIRIM PER LOKASI */}
          {(activeTab === 'all' || activeTab === 'location') && (
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    2. Kartu Dashboard DO OPEN Terkirim / Approved Sesuai Lokasi
                  </h3>
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  {locationBreakdown.length} Lokasi
                </span>
              </div>

              {locationBreakdown.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-xs">
                  Belum ada data lokasi DO OPEN terkirim untuk ditampilkan.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
                  {locationBreakdown.map((loc) => (
                    <div
                      key={loc.locationName}
                      className="bg-slate-950 p-4 rounded-xl border border-slate-800 hover:border-emerald-500/40 transition shadow-sm space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
                          <h4 className="text-xs font-bold text-white truncate max-w-[180px]" title={loc.locationName}>
                            {loc.locationName}
                          </h4>
                        </div>
                        <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 text-[10px] font-bold font-mono rounded-full border border-emerald-500/30 shrink-0">
                          {loc.docCount} DO
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                        <div className="bg-slate-900 p-2 rounded-lg border border-slate-800/80">
                          <span className="text-[10px] font-sans text-slate-400 block">Total Qty Approve</span>
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
                          <span className="text-slate-400 text-[11px]">Nilai Beli Approved:</span>
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

          {/* SECTION 3: RINCIAN DATA ITEM DO OPEN TERKIRIM (APPROVED) */}
          {(activeTab === 'all' || activeTab === 'detail') && (
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    3. Rincian Item DO OPEN Terkirim / Approved
                  </h3>
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  {approvedRequests.length} Baris Data
                </span>
              </div>

              {approvedRequests.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-xs">
                  Belum ada data rincian DO OPEN terkirim untuk ditampilkan.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-800 max-h-[450px] scrollbar-thin">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-950/90 text-emerald-400 font-bold border-b border-slate-800 uppercase tracking-wider text-[11px] sticky top-0 z-10 backdrop-blur-xs">
                      <tr>
                        <th className="p-2.5 text-center w-10">No</th>
                        <th className="p-2.5">Tanggal</th>
                        <th className="p-2.5">No DO</th>
                        <th className="p-2.5">Kode Item</th>
                        <th className="p-2.5">Nama Item</th>
                        <th className="p-2.5">Area SPV</th>
                        <th className="p-2.5">Tujuan</th>
                        <th className="p-2.5 text-right">Qty</th>
                        <th className="p-2.5 text-left min-w-[140px] text-amber-300">Keterangan</th>
                        <th className="p-2.5">Requested By</th>
                        <th className="p-2.5">Approved By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {approvedRequests.map((r, idx) => {
                        const m = masterMap.get(r.itemCode);
                        const ket = getKeterangan(r);
                        return (
                          <tr key={r.id || idx} className="hover:bg-slate-800/50 transition">
                            <td className="p-2.5 text-center text-slate-500 font-sans">{idx + 1}</td>
                            <td className="p-2.5 text-slate-400 whitespace-nowrap">{r.postingDate || '-'}</td>
                            <td className="p-2.5 font-bold text-emerald-400 whitespace-nowrap">{r.documentNo}</td>
                            <td className="p-2.5 text-slate-300 font-bold whitespace-nowrap">{r.itemCode}</td>
                            <td className="p-2.5 font-sans font-medium text-slate-100 max-w-[200px] truncate" title={m?.itemName || '-'}>
                              {m?.itemName || '-'}
                            </td>
                            <td className="p-2.5 font-sans text-slate-300 whitespace-nowrap">{r.remark || '-'}</td>
                            <td className="p-2.5 font-sans text-slate-300 whitespace-nowrap">{r.toLocation || '-'}</td>
                            <td className="p-2.5 text-right text-amber-400 font-bold">{Number(r.qty).toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
                            <td className="p-2.5 font-sans text-amber-200/90 text-[11px] max-w-[220px] whitespace-normal break-words">
                              {ket}
                            </td>
                            <td className="p-2.5 font-sans text-slate-400 text-[11px] whitespace-nowrap">{r.requestedBy || '-'}</td>
                            <td className="p-2.5 font-sans text-emerald-300/80 text-[11px] whitespace-nowrap">{r.approvedBy || '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

        </div>

      </div>

      {/* EMAIL REPORT SUB-MODAL */}
      <EmailDoOpenKirimReportModal
        isOpen={isEmailModalOpen}
        onClose={() => setIsEmailModalOpen(false)}
        spvBreakdown={spvBreakdown}
        locationBreakdown={locationBreakdown}
        grandTotals={grandTotals}
      />
    </div>
  );
};
