import React, { useState, useMemo } from 'react';
import { 
  FileCheck, 
  Download, 
  Search, 
  Calendar, 
  X, 
  CheckCircle2, 
  FileSpreadsheet, 
  Boxes, 
  Layers, 
  List, 
  Filter,
  Truck
} from 'lucide-react';
import { RequestDoRecord, DateCategoryFilter, MasterItem, DoOpenRecord, UserProfile } from '../types';
import { SortableHeader } from '../components/SortableHeader';
import { sortData, SortConfig } from '../utils/sorting';
import { exportToExcel } from '../utils/excel';
import { ReportDoOpenKirimModal } from '../components/ReportDoOpenKirimModal';
import { updateRequestDoOpenStatus } from '../api';

interface ReportRequestDoOpenViewProps {
  requests: RequestDoRecord[];
  doOpenRecords?: DoOpenRecord[];
  masterItems?: MasterItem[];
  currentUser?: UserProfile | null;
  onRequestStatusChange?: (allIds: string[], status: 'APPROVED' | 'REJECTED' | 'PENDING', approver: string, reason?: string) => void;
}

export const ReportRequestDoOpenView: React.FC<ReportRequestDoOpenViewProps> = ({
  requests,
  doOpenRecords = [],
  masterItems = [],
  currentUser,
  onRequestStatusChange
}) => {
  const [revertingId, setRevertingId] = useState<string | null>(null);

  // Revert request yang sudah APPROVED balik ke PENDING — buat testing atau
  // membatalkan aksi yang salah, langsung dari halaman Report (permintaan
  // Kiki 2026-08-19, sebelumnya Revert cuma ada di menu Request DO OPEN).
  // Satu No DO bisa punya beberapa baris item (di-approve bareng), jadi
  // revert-nya sekalian semua baris dengan DocumentNo yang sama.
  const handleRevert = async (r: RequestDoRecord) => {
    const siblings = requests.filter(x => (x.documentNo || '').trim().toUpperCase() === (r.documentNo || '').trim().toUpperCase());
    const ids = siblings.map(x => x.id || x.documentNo);
    if (!confirm(`Kembalikan request "${r.documentNo}" (${ids.length} baris item) ke status PENDING? Aksi approve sebelumnya akan dibatalkan.`)) return;
    setRevertingId(r.documentNo);
    try {
      const reverter = currentUser?.displayName || currentUser?.email || 'PIC Gudang';
      for (const id of ids) {
        try {
          await updateRequestDoOpenStatus(id, 'PENDING', '', r.documentNo);
        } catch (err) {
          console.warn(`Failed to revert ${id}:`, err);
        }
      }
      if (onRequestStatusChange) {
        onRequestStatusChange(ids, 'PENDING', reverter);
      }
    } catch (err: any) {
      console.error(err);
      alert(`Gagal revert request: ${err.message || 'Error'}`);
    } finally {
      setRevertingId(null);
    }
  };

  const masterMap = useMemo(() => {
    const map = new Map<string, MasterItem>();
    masterItems.forEach(m => map.set(m.itemCode, m));
    return map;
  }, [masterItems]);

  const doOpenMap = useMemo(() => {
    const map = new Map<string, string>();
    (doOpenRecords || []).forEach(d => {
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
  }, [doOpenRecords]);

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

  const [filters, setFilters] = useState<DateCategoryFilter>({
    searchQuery: '',
    startDate: '',
    endDate: '',
    category: ''
  });

  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'approvedAt', direction: 'desc' });
  const [viewMode, setViewMode] = useState<'detailed' | 'grouped'>('detailed');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  // 1. Filter ONLY APPROVED requests
  const approvedRequests = useMemo(() => {
    return requests.filter(r => (r.status || '').toUpperCase() === 'APPROVED');
  }, [requests]);

  // 2. Apply Search & Date Filters
  const filteredRequests = useMemo(() => {
    return approvedRequests.filter(r => {
      // Search Query
      const query = filters.searchQuery.toLowerCase().trim();
      const m = masterMap.get(r.itemCode);
      const ket = getKeterangan(r).toLowerCase();
      const matchSearch = !query || 
        (r.documentNo && r.documentNo.toLowerCase().includes(query)) ||
        (r.itemCode && r.itemCode.toLowerCase().includes(query)) ||
        (m?.itemName && m.itemName.toLowerCase().includes(query)) ||
        (m?.groupName && m.groupName.toLowerCase().includes(query)) ||
        (r.entryName && r.entryName.toLowerCase().includes(query)) ||
        (r.remark && r.remark.toLowerCase().includes(query)) ||
        (r.toLocation && r.toLocation.toLowerCase().includes(query)) ||
        (ket.includes(query)) ||
        (r.requestedBy && r.requestedBy.toLowerCase().includes(query)) ||
        (r.approvedBy && r.approvedBy.toLowerCase().includes(query));

      // Date Range (Check postingDate, requestedAt, or approvedAt)
      let matchDate = true;
      const reqDateStr = r.postingDate || (r.requestedAt ? r.requestedAt.slice(0, 10) : '');
      if (filters.startDate && reqDateStr < filters.startDate) matchDate = false;
      if (filters.endDate && reqDateStr > filters.endDate) matchDate = false;

      return matchSearch && matchDate;
    });
  }, [approvedRequests, filters, masterMap, doOpenMap]);

  // 3. Grouped View Data (1 Row per unique DocumentNo)
  const groupedData = useMemo(() => {
    const map = new Map<string, {
      documentNo: string;
      itemCount: number;
      totalQty: number;
      entryName: string;
      remark: string;
      toLocation: string;
      keteranganList: string[];
      requestedBy: string;
      requestedAt?: string;
      postingDate: string;
      approvedBy?: string;
      approvedAt?: string;
      itemCodesList: string[];
      itemNamesList: string[];
      groupNamesList: string[];
    }>();

    filteredRequests.forEach(r => {
      const docNoStr = (r.documentNo || '').trim();
      if (!docNoStr) return;
      const key = docNoStr.toUpperCase();

      const m = masterMap.get(r.itemCode);
      const itemName = m?.itemName || '-';
      const groupName = m?.groupName || 'Tanpa Group';
      const ket = getKeterangan(r);

      if (!map.has(key)) {
        map.set(key, {
          documentNo: docNoStr,
          itemCount: 1,
          totalQty: r.qty || 0,
          entryName: r.entryName || '-',
          remark: r.remark || '-',
          toLocation: r.toLocation || '-',
          keteranganList: ket !== '-' ? [ket] : [],
          requestedBy: r.requestedBy || '-',
          requestedAt: r.requestedAt,
          postingDate: r.postingDate,
          approvedBy: r.approvedBy || '-',
          approvedAt: r.approvedAt,
          itemCodesList: r.itemCode ? [r.itemCode] : [],
          itemNamesList: itemName !== '-' ? [itemName] : [],
          groupNamesList: [groupName]
        });
      } else {
        const existing = map.get(key)!;
        existing.itemCount += 1;
        existing.totalQty += (r.qty || 0);
        if (r.itemCode && !existing.itemCodesList.includes(r.itemCode)) {
          existing.itemCodesList.push(r.itemCode);
        }
        if (itemName !== '-' && !existing.itemNamesList.includes(itemName)) {
          existing.itemNamesList.push(itemName);
        }
        if (!existing.groupNamesList.includes(groupName)) {
          existing.groupNamesList.push(groupName);
        }
        if (ket !== '-' && !existing.keteranganList.includes(ket)) {
          existing.keteranganList.push(ket);
        }
        if (!existing.entryName || existing.entryName === '-') existing.entryName = r.entryName || '-';
        if (!existing.remark || existing.remark === '-') existing.remark = r.remark || '-';
        if (!existing.toLocation || existing.toLocation === '-') existing.toLocation = r.toLocation || '-';
        if (!existing.requestedBy || existing.requestedBy === '-') existing.requestedBy = r.requestedBy || '-';
      }
    });

    return Array.from(map.values());
  }, [filteredRequests, masterMap, doOpenMap]);

  // 4. Sorted Data
  const sortedDetailedRequests = useMemo(() => {
    return sortData(filteredRequests, sortConfig.key, sortConfig.direction);
  }, [filteredRequests, sortConfig]);

  const sortedGroupedRequests = useMemo(() => {
    return sortData(groupedData, sortConfig.key, sortConfig.direction);
  }, [groupedData, sortConfig]);

  // Summary Metrics
  const totalApprovedDocCount = useMemo(() => {
    const uniqueDocs = new Set(filteredRequests.map(r => (r.documentNo || '').trim().toUpperCase()));
    return uniqueDocs.size;
  }, [filteredRequests]);

  const totalApprovedQty = useMemo(() => {
    return filteredRequests.reduce((sum, r) => sum + (r.qty || 0), 0);
  }, [filteredRequests]);

  // Handle Sort
  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  // Export to Excel
  const handleExportExcel = () => {
    if (viewMode === 'detailed') {
      const exportData = sortedDetailedRequests.map(r => {
        const m = masterMap.get(r.itemCode);
        return {
          'Tanggal Request': r.requestedAt ? new Date(r.requestedAt).toLocaleString('id-ID') : r.postingDate,
          'No DO (DocumentNo)': r.documentNo,
          'Item Code': r.itemCode,
          'Item Name': m?.itemName || '-',
          'Group Name': m?.groupName || 'Tanpa Group',
          'Qty': r.qty,
          'Area RM OPR': r.entryName,
          'Area SPV OPR': r.remark,
          'Tujuan (To)': r.toLocation,
          'Keterangan': getKeterangan(r),
          'Pengaju': r.requestedBy,
          'Status Approval': 'APPROVED',
          'Disetujui Oleh': r.approvedBy || '-',
          'Waktu Disetujui': r.approvedAt ? new Date(r.approvedAt).toLocaleString('id-ID') : '-'
        };
      });
      exportToExcel(exportData, `Report_Request_DO_Approved_Detail`, 'Approved Detail');
    } else {
      const exportData = sortedGroupedRequests.map(g => ({
        'No DO (DocumentNo)': g.documentNo,
        'Group Name': g.groupNamesList.join(', ') || 'Tanpa Group',
        'Jumlah Line Item': g.itemCount,
        'Total Qty': g.totalQty,
        'Daftar Item Code': g.itemCodesList.join(', '),
        'Daftar Item Name': g.itemNamesList.join(', '),
        'Area RM OPR': g.entryName,
        'Area SPV OPR': g.remark,
        'Tujuan (To)': g.toLocation,
        'Keterangan': g.keteranganList.join(', ') || '-',
        'Pengaju': g.requestedBy,
        'Tanggal Request': g.requestedAt ? new Date(g.requestedAt).toLocaleString('id-ID') : g.postingDate,
        'Status Approval': 'APPROVED',
        'Disetujui Oleh': g.approvedBy || '-',
        'Waktu Disetujui': g.approvedAt ? new Date(g.approvedAt).toLocaleString('id-ID') : '-'
      }));
      exportToExcel(exportData, `Report_Request_DO_Approved_Ringkasan_NoDO`, 'Ringkasan No DO');
    }
  };

  return (
    <div className="space-y-4 font-sans text-slate-800">
      
      {/* Page Title & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
        <div>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <FileCheck className="w-5 h-5 text-emerald-600" />
            Report DO OPEN Request Kirim
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Daftar seluruh Request DO OPEN yang telah disetujui (Approved) oleh PIC Gudang Logistik.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* View Mode Toggle */}
          <div className="bg-slate-100 p-1 rounded-lg border border-slate-200 flex items-center gap-1 text-xs">
            <button
              onClick={() => setViewMode('detailed')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition ${
                viewMode === 'detailed' 
                  ? 'bg-white text-indigo-700 font-bold shadow-2xs' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              Detail Per Item
            </button>
            <button
              onClick={() => setViewMode('grouped')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition ${
                viewMode === 'grouped' 
                  ? 'bg-white text-indigo-700 font-bold shadow-2xs' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Ringkasan No DO
            </button>
          </div>

          {/* Report DO OPEN Kirim Modal Button */}
          <button
            onClick={() => setIsReportModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-2xs transition cursor-pointer"
          >
            <Truck className="w-4 h-4" />
            Report DO OPEN Kirim
          </button>

          {/* Export Excel Button */}
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-lg shadow-2xs transition cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-amber-400" />
            Export Excel
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total No DO Approved</p>
            <p className="text-lg font-bold text-slate-900 font-mono mt-0.5">{totalApprovedDocCount} <span className="text-xs font-sans text-slate-500 font-normal">No DO</span></p>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center shrink-0">
            <List className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Line Item Approved</p>
            <p className="text-lg font-bold text-slate-900 font-mono mt-0.5">{filteredRequests.length} <span className="text-xs font-sans text-slate-500 font-normal">Line</span></p>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center shrink-0">
            <Boxes className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Qty Item Approved</p>
            <p className="text-lg font-bold text-amber-700 font-mono mt-0.5">{totalApprovedQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} <span className="text-xs font-sans text-slate-500 font-normal">Unit</span></p>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center gap-3 text-xs">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={filters.searchQuery}
            onChange={(e) => setFilters(prev => ({ ...prev, searchQuery: e.target.value }))}
            placeholder="Cari No DO, Item Code, Area RM, Area SPV, Outlet, Pengaju..."
            className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
          />
          {filters.searchQuery && (
            <button
              onClick={() => setFilters(prev => ({ ...prev, searchQuery: '' }))}
              className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Date Filters */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
              className="bg-transparent text-xs text-slate-700 focus:outline-none"
            />
            <span className="text-slate-400">-</span>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
              className="bg-transparent text-xs text-slate-700 focus:outline-none"
            />
          </div>

          {(filters.startDate || filters.endDate || filters.searchQuery) && (
            <button
              onClick={() => setFilters({ searchQuery: '', startDate: '', endDate: '', category: '' })}
              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs rounded-lg font-medium transition"
            >
              Reset Filter
            </button>
          )}
        </div>
      </div>

      {/* Main Table Container */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
          <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
            <FileCheck className="w-4 h-4 text-emerald-600" />
            {viewMode === 'detailed' 
              ? `Report Detail Request DO OPEN Approved (${sortedDetailedRequests.length} Item Line)` 
              : `Report Ringkasan Request DO OPEN Approved (${sortedGroupedRequests.length} No DO)`}
          </span>
        </div>

        <div className="overflow-x-auto">
          {viewMode === 'detailed' ? (
            /* DETAILED VIEW TABLE */
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/90 text-slate-700 border-b border-slate-200 font-semibold text-[11px]">
                  <th className="p-2.5 w-10 text-center">No</th>
                  <SortableHeader
                    label="Waktu Request"
                    field="requestedAt"
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
                    label="Qty"
                    field="qty"
                    align="right"
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
                    label="Tujuan (To)"
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
                  <th className="p-2.5">Status</th>
                  <SortableHeader
                    label="Approved By"
                    field="approvedBy"
                    currentSortKey={sortConfig.key}
                    currentDirection={sortConfig.direction}
                    onSort={handleSort}
                  />
                  <th className="p-2.5 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedDetailedRequests.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="p-8 text-center text-slate-400 text-xs">
                      Tidak ada data Report Request DO OPEN Approved.
                    </td>
                  </tr>
                ) : (
                  sortedDetailedRequests.map((r, idx) => {
                    const m = masterMap.get(r.itemCode);
                    const ket = getKeterangan(r);
                    return (
                      <tr key={r.id || idx} className="hover:bg-slate-50/80 transition">
                        <td className="p-2.5 text-center text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                        <td className="p-2.5 text-slate-600 whitespace-nowrap text-[11px]">
                          {r.requestedAt ? new Date(r.requestedAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : r.postingDate}
                        </td>
                        <td className="p-2.5 font-mono font-bold text-indigo-900 whitespace-nowrap">{r.documentNo}</td>
                        <td className="p-2.5 font-mono font-bold text-slate-800 whitespace-nowrap">{r.itemCode}</td>
                        <td className="p-2.5 text-slate-800 font-medium whitespace-nowrap">{m?.itemName || '-'}</td>
                        <td className="p-2.5 whitespace-nowrap">
                          <span className="inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-700 rounded border border-slate-200">
                            {m?.groupName || 'Tanpa Group'}
                          </span>
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold text-indigo-700 text-xs">{r.qty}</td>
                        <td className="p-2.5 text-slate-700 whitespace-nowrap">{r.entryName || '-'}</td>
                        <td className="p-2.5 text-slate-600 whitespace-nowrap">{r.remark || '-'}</td>
                        <td className="p-2.5 text-slate-600 whitespace-nowrap">{r.toLocation || '-'}</td>
                        <td className="p-2.5 text-slate-600 whitespace-nowrap max-w-[200px] truncate" title={ket}>
                          <span className={ket !== '-' ? "font-semibold text-slate-800" : "text-slate-400"}>
                            {ket}
                          </span>
                        </td>
                        <td className="p-2.5 text-slate-600 whitespace-nowrap">{r.requestedBy || '-'}</td>
                        <td className="p-2.5 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-700 rounded border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> APPROVED
                          </span>
                        </td>
                        <td className="p-2.5 text-slate-600 whitespace-nowrap">
                          <span className="font-semibold text-slate-800">{r.approvedBy || 'PIC Gudang'}</span>
                          {r.approvedAt && (
                            <div className="text-[10px] text-slate-400">
                              {new Date(r.approvedAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                            </div>
                          )}
                        </td>
                        <td className="p-2.5 text-center whitespace-nowrap">
                          <button
                            onClick={() => handleRevert(r)}
                            disabled={revertingId === r.documentNo}
                            className="px-2 py-1 bg-slate-100 hover:bg-amber-100 text-slate-500 hover:text-amber-700 border border-slate-200 hover:border-amber-300 font-semibold text-[10px] rounded transition disabled:opacity-50"
                            title="Kembalikan ke PENDING (batalkan approve)"
                          >
                            {revertingId === r.documentNo ? 'Memproses...' : 'Revert'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : (
            /* GROUPED VIEW TABLE */
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/90 text-slate-700 border-b border-slate-200 font-semibold text-[11px]">
                  <th className="p-2.5 w-10 text-center">No</th>
                  <SortableHeader
                    label="No DO (DocumentNo)"
                    field="documentNo"
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
                    label="Jumlah Item"
                    field="itemCount"
                    align="right"
                    currentSortKey={sortConfig.key}
                    currentDirection={sortConfig.direction}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Total Qty"
                    field="totalQty"
                    align="right"
                    currentSortKey={sortConfig.key}
                    currentDirection={sortConfig.direction}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Daftar Item Name"
                    field="itemNames"
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
                    label="Tujuan (To)"
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
                  <th className="p-2.5">Status</th>
                  <SortableHeader
                    label="Approved By"
                    field="approvedBy"
                    currentSortKey={sortConfig.key}
                    currentDirection={sortConfig.direction}
                    onSort={handleSort}
                  />
                  <th className="p-2.5 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedGroupedRequests.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="p-8 text-center text-slate-400 text-xs">
                      Tidak ada data Report Request DO OPEN Approved.
                    </td>
                  </tr>
                ) : (
                  sortedGroupedRequests.map((g, idx) => {
                    const ketStr = g.keteranganList.join(', ') || '-';
                    return (
                      <tr key={g.documentNo || idx} className="hover:bg-slate-50/80 transition">
                        <td className="p-2.5 text-center text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                        <td className="p-2.5 font-mono font-bold text-indigo-900 whitespace-nowrap">{g.documentNo}</td>
                        <td className="p-2.5 whitespace-nowrap">
                          <span className="inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-700 rounded border border-slate-200">
                            {g.groupNamesList.join(', ') || 'Tanpa Group'}
                          </span>
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold text-slate-700 text-xs">
                          {g.itemCount} <span className="text-[10px] text-slate-400 font-normal">item</span>
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold text-indigo-700 text-xs">
                          {g.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="p-2.5 text-slate-700 max-w-[200px] truncate font-medium text-[11px]" title={g.itemNamesList.join(', ')}>
                          {g.itemNamesList.join(', ') || '-'}
                        </td>
                        <td className="p-2.5 text-slate-700 whitespace-nowrap">{g.entryName}</td>
                        <td className="p-2.5 text-slate-600 whitespace-nowrap">{g.remark}</td>
                        <td className="p-2.5 text-slate-600 whitespace-nowrap">{g.toLocation}</td>
                        <td className="p-2.5 text-slate-600 whitespace-nowrap max-w-[200px] truncate" title={ketStr}>
                          <span className={ketStr !== '-' ? "font-semibold text-slate-800" : "text-slate-400"}>
                            {ketStr}
                          </span>
                        </td>
                        <td className="p-2.5 text-slate-600 whitespace-nowrap">{g.requestedBy}</td>
                        <td className="p-2.5 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-700 rounded border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> APPROVED
                          </span>
                        </td>
                        <td className="p-2.5 text-slate-600 whitespace-nowrap">
                          <span className="font-semibold text-slate-800">{g.approvedBy}</span>
                          {g.approvedAt && (
                            <div className="text-[10px] text-slate-400">
                              {new Date(g.approvedAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                            </div>
                          )}
                        </td>
                        <td className="p-2.5 text-center whitespace-nowrap">
                          <button
                            onClick={() => handleRevert({ documentNo: g.documentNo } as RequestDoRecord)}
                            disabled={revertingId === g.documentNo}
                            className="px-2 py-1 bg-slate-100 hover:bg-amber-100 text-slate-500 hover:text-amber-700 border border-slate-200 hover:border-amber-300 font-semibold text-[10px] rounded transition disabled:opacity-50"
                            title="Kembalikan ke PENDING (batalkan approve, semua item di No DO ini)"
                          >
                            {revertingId === g.documentNo ? 'Memproses...' : 'Revert'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* REPORT DO OPEN KIRIM MODAL */}
      <ReportDoOpenKirimModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        requestDoOpenRecords={requests}
        records={doOpenRecords}
        masterItems={masterItems}
      />

    </div>
  );
};
