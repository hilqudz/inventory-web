import React, { useState, useMemo, useEffect } from 'react';
import { 
  ContainerRecord, 
  ContainerStatusType, 
  UserRole 
} from '../types';
import { 
  addContainerStatus, 
  updateContainerStatus, 
  deleteContainerStatus, 
  saveBatchContainerStatus,
  syncAllContainerStatusToSupabase
} from '../api';
import { 
  exportToExcel, 
  downloadExcelTemplate, 
  parseExcelFile, 
  normalizeExcelDate 
} from '../utils/excel';
import { SortableHeader } from '../components/SortableHeader';
import { EmailContainerReportModal } from '../components/EmailContainerReportModal';
import { 
  Plus, 
  FileSpreadsheet, 
  Mail, 
  Search, 
  Trash2, 
  Edit3, 
  RefreshCw, 
  Ship, 
  CheckCircle2, 
  Clock, 
  HelpCircle, 
  Copy, 
  Check, 
  X, 
  Upload, 
  Calendar, 
  Filter,
  Database,
  Boxes,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

const formatCurrency = (val: number) => 'Rp ' + (val || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });

interface ContainerStatusViewProps {
  containers: ContainerRecord[];
  userRole: UserRole;
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onRefreshData: () => void;
  onClearAllPermanent?: () => void;
}

export default function ContainerStatusView({
  containers,
  userRole,
  showToast,
  onRefreshData,
  onClearAllPermanent
}: ContainerStatusViewProps) {
  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');

  // Sort state
  const [sortField, setSortField] = useState<string>('tglTibaPriuk');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Pagination — pencegahan dini, data container masih sedikit sekarang tapi
  // berpotensi menumpuk seperti kasus Katalog Foto (lihat catatan di sesi terkait).
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);

  // Modal states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ContainerRecord | null>(null);

  const [formData, setFormData] = useState<Omit<ContainerRecord, 'id'>>({
    noContainer: '',
    category: 'IMPORT',
    tglTibaPriuk: new Date().toISOString().slice(0, 10),
    tglTibaBintara: '',
    itemCategoryBarang: '',
    statusContainer: 'Container Masih OTW',
    totalQty: 0,
    totalCost: 0,
    totalPrice: 0,
    remark: ''
  });

  const [submitting, setSubmitting] = useState(false);
  const [syncingSupabase, setSyncingSupabase] = useState(false);

  // Import modal state
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  // Email Draft Modal State
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [emailMonthFilter, setEmailMonthFilter] = useState<string>('ALL');
  const [copiedSubject, setCopiedSubject] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);

  // Delete modal state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Dashboard minimize state
  const [isDashboardMinimized, setIsDashboardMinimized] = useState(false);

  // Extract unique categories & months for dropdown filters
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    containers.forEach(c => {
      if (c.category) cats.add(c.category.trim().toUpperCase());
    });
    return Array.from(cats).sort();
  }, [containers]);

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    containers.forEach(c => {
      const dateStr = c.tglTibaBintara || c.tglTibaPriuk || c.createdAt;
      if (dateStr && dateStr.length >= 7) {
        months.add(dateStr.slice(0, 7)); // YYYY-MM
      }
    });
    return Array.from(months).sort().reverse();
  }, [containers]);

  // Base filtered containers (Filtered by Search, Category, and Month - before Status Filter)
  const baseFilteredContainers = useMemo(() => {
    return containers.filter(c => {
      // Search
      const query = searchQuery.trim().toLowerCase();
      const matchSearch = !query || 
        c.noContainer.toLowerCase().includes(query) ||
        c.category.toLowerCase().includes(query) ||
        c.itemCategoryBarang.toLowerCase().includes(query) ||
        (c.remark && c.remark.toLowerCase().includes(query));

      // Category Filter
      const matchCategory = categoryFilter === 'ALL' || c.category.toUpperCase() === categoryFilter;

      // Month Filter (Priuk or Bintara date)
      const dateStr = c.tglTibaBintara || c.tglTibaPriuk || c.createdAt || '';
      const matchMonth = selectedMonth === 'ALL' || dateStr.startsWith(selectedMonth);

      return matchSearch && matchCategory && matchMonth;
    });
  }, [containers, searchQuery, categoryFilter, selectedMonth]);

  // Summary Metrics calculated dynamically from baseFilteredContainers
  const summaryMetrics = useMemo(() => {
    let total = baseFilteredContainers.length;
    let tibaBintara = 0;
    let masihOTW = 0;
    let belumOTW = 0;

    let totalQty = 0;
    let totalCost = 0;
    let totalPrice = 0;

    let tibaBintaraQty = 0;
    let tibaBintaraCost = 0;
    let tibaBintaraPrice = 0;

    let masihOTWQty = 0;
    let masihOTWCost = 0;
    let masihOTWPrice = 0;

    let belumOTWQty = 0;
    let belumOTWCost = 0;
    let belumOTWPrice = 0;

    baseFilteredContainers.forEach(c => {
      const q = Number(c.totalQty) || 0;
      const cost = Number(c.totalCost) || 0;
      const price = Number(c.totalPrice) || 0;

      if (c.statusContainer === 'Barang Sudah Tiba di Bintara') {
        tibaBintara++;
        tibaBintaraQty += q;
        tibaBintaraCost += cost;
        tibaBintaraPrice += price;
      } else if (c.statusContainer === 'Container Masih OTW') {
        masihOTW++;
        masihOTWQty += q;
        masihOTWCost += cost;
        masihOTWPrice += price;
      } else {
        belumOTW++;
        belumOTWQty += q;
        belumOTWCost += cost;
        belumOTWPrice += price;
      }

      totalQty += q;
      totalCost += cost;
      totalPrice += price;
    });

    return { 
      total, 
      tibaBintara, 
      masihOTW, 
      belumOTW, 
      totalQty, 
      totalCost, 
      totalPrice,
      tibaBintaraQty,
      tibaBintaraCost,
      tibaBintaraPrice,
      masihOTWQty,
      masihOTWCost,
      masihOTWPrice,
      belumOTWQty,
      belumOTWCost,
      belumOTWPrice
    };
  }, [baseFilteredContainers]);

  // Filter & Sort Logic for Table Display (applies statusFilter to baseFilteredContainers)
  const filteredContainers = useMemo(() => {
    return baseFilteredContainers.filter(c => {
      // Status Filter
      return statusFilter === 'ALL' || c.statusContainer === statusFilter;
    }).sort((a, b) => {
      let aVal: any = (a as any)[sortField] || '';
      let bVal: any = (b as any)[sortField] || '';

      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [baseFilteredContainers, statusFilter, sortField, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(filteredContainers.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedContainers = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredContainers.slice(start, start + PAGE_SIZE);
  }, [filteredContainers, safePage]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, categoryFilter, selectedMonth, sortField, sortDirection]);

  // Handle Sort
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Open Form for Add / Edit
  const handleOpenForm = (record?: ContainerRecord) => {
    if (record) {
      setEditingRecord(record);
      setFormData({
        noContainer: record.noContainer,
        category: record.category,
        tglTibaPriuk: record.tglTibaPriuk,
        tglTibaBintara: record.tglTibaBintara,
        itemCategoryBarang: record.itemCategoryBarang,
        statusContainer: record.statusContainer,
        totalQty: record.totalQty || 0,
        totalCost: record.totalCost || 0,
        totalPrice: record.totalPrice || 0,
        remark: record.remark || ''
      });
    } else {
      setEditingRecord(null);
      setFormData({
        noContainer: '',
        category: 'IMPORT',
        tglTibaPriuk: new Date().toISOString().slice(0, 10),
        tglTibaBintara: '',
        itemCategoryBarang: '',
        statusContainer: 'Container Masih OTW',
        totalQty: 0,
        totalCost: 0,
        totalPrice: 0,
        remark: ''
      });
    }
    setIsFormOpen(true);
  };

  // Save Form
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.noContainer.trim()) {
      showToast('No Container wajib diisi!', 'error');
      return;
    }

    setSubmitting(true);
    try {
      if (editingRecord && editingRecord.id) {
        const ok = await updateContainerStatus(editingRecord.id, formData);
        if (ok) {
          showToast('Status Container berhasil diperbarui!', 'success');
          setIsFormOpen(false);
          onRefreshData();
        } else {
          showToast('Gagal memperbarui status container.', 'error');
        }
      } else {
        const ok = await addContainerStatus(formData);
        if (ok) {
          showToast('Container baru berhasil ditambahkan!', 'success');
          setIsFormOpen(false);
          onRefreshData();
        } else {
          showToast('Gagal menambahkan container.', 'error');
        }
      }
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete Container
  const handleDelete = async (id: string) => {
    if (!id) return;
    try {
      const ok = await deleteContainerStatus(id);
      if (ok) {
        showToast('Data container berhasil dihapus.', 'success');
        onRefreshData();
      } else {
        showToast('Gagal menghapus data container.', 'error');
      }
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  // Export to Excel
  const handleExport = () => {
    const exportData = filteredContainers.map(c => ({
      'No Container': c.noContainer,
      'Category': c.category,
      'Tgl Tiba Di Priuk': c.tglTibaPriuk || '-',
      'Tgl Tiba Di Bintara': c.tglTibaBintara || '-',
      'Item Category Barang': c.itemCategoryBarang || '-',
      'Status Container': c.statusContainer,
      'Total Qty': c.totalQty || 0,
      'Total Cost': c.totalCost || 0,
      'Total Price': c.totalPrice || 0,
      'Keterangan / Remark': c.remark || '-'
    }));
    exportToExcel(exportData, 'Rekapan_Status_Perjalanan_Container');
  };

  // Import Excel File
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    try {
      const rawRows = await parseExcelFile<any>(file);
      if (!rawRows || rawRows.length === 0) {
        showToast('File Excel kosong atau tidak terbaca.', 'error');
        setImportLoading(false);
        return;
      }

      const parsedRecords: Omit<ContainerRecord, 'id'>[] = [];

      for (const row of rawRows) {
        // Flexible key matching
        const noContainer = (
          row['No Container'] || 
          row['no_container'] || 
          row['NO CONTAINER'] || 
          row['Container No'] || 
          row['NO'] || 
          ''
        ).toString().trim();

        if (!noContainer) continue;

        const category = (
          row['Category'] || 
          row['category'] || 
          row['Kategori'] || 
          row['CATEGORY'] || 
          'IMPORT'
        ).toString().trim();

        const tglPriukRaw = row['Tgl Tiba Di Priuk'] || row['tgl_tiba_priuk'] || row['TIBA PRIUK'] || row['Tgl Tiba Priuk'] || '';
        const tglBintaraRaw = row['Tgl Tiba Di Bintara'] || row['tgl_tiba_bintara'] || row['TIBA BINTARA'] || row['Tgl Tiba Bintara'] || '';

        const tglTibaPriuk = normalizeExcelDate(tglPriukRaw);
        const tglTibaBintara = normalizeExcelDate(tglBintaraRaw);

        const itemCategoryBarang = (
          row['Item Category Barang'] || 
          row['item_category_barang'] || 
          row['Category Barang'] || 
          row['ITEM CATEGORY'] || 
          ''
        ).toString().trim();

        const rawStatus = (
          row['Status Container'] || 
          row['status_container'] || 
          row['STATUS'] || 
          ''
        ).toString().trim().toLowerCase();

        let statusContainer: ContainerStatusType = 'Container Masih OTW';
        if (rawStatus.includes('bintara') || rawStatus.includes('tiba')) {
          statusContainer = 'Barang Sudah Tiba di Bintara';
        } else if (rawStatus.includes('belum otw') || rawStatus.includes('belum')) {
          statusContainer = 'Container Belum OTW';
        } else if (rawStatus.includes('otw')) {
          statusContainer = 'Container Masih OTW';
        } else if (tglTibaBintara) {
          statusContainer = 'Barang Sudah Tiba di Bintara';
        }

        const totalQty = Number(
          row['Total Qty'] || row['total_qty'] || row['Qty'] || row['qty'] || row['Jumlah Qty'] || 0
        ) || 0;

        const totalCost = Number(
          row['Total Cost'] || row['total_cost'] || row['Cost'] || row['cost'] || row['Nilai Cost'] || row['Harga Beli'] || 0
        ) || 0;

        const totalPrice = Number(
          row['Total Price'] || row['total_price'] || row['Price'] || row['price'] || row['Nilai Price'] || row['Harga Jual'] || 0
        ) || 0;

        const remark = (row['Remark'] || row['Keterangan'] || row['remark'] || '').toString().trim();

        parsedRecords.push({
          noContainer,
          category,
          tglTibaPriuk,
          tglTibaBintara,
          itemCategoryBarang,
          statusContainer,
          totalQty,
          totalCost,
          totalPrice,
          remark
        });
      }

      if (parsedRecords.length === 0) {
        showToast('Tidak ada data container valid yang ditemukan di file.', 'error');
        setImportLoading(false);
        return;
      }

      const res = await saveBatchContainerStatus(parsedRecords);
      showToast(`Berhasil mengimpor ${res.insertedCount} baru & ${res.updatedCount || 0} terupdate data container ke database SQL Server!`, 'success');
      setIsImportOpen(false);
      onRefreshData();
    } catch (err: any) {
      showToast(`Gagal mengimpor Excel: ${err.message}`, 'error');
    } finally {
      setImportLoading(false);
      e.target.value = '';
    }
  };

  const handleSyncToSupabase = async () => {
    if (!containers || containers.length === 0) {
      showToast('Tidak ada data container untuk disinkronkan.', 'info');
      return;
    }
    setSyncingSupabase(true);
    try {
      const res = await syncAllContainerStatusToSupabase(containers);
      if (res.success) {
        showToast(res.message, 'success');
        onRefreshData();
      } else {
        showToast(res.message, 'error');
      }
    } catch (err: any) {
      showToast(`Gagal menyimpan ke database: ${err.message}`, 'error');
    } finally {
      setSyncingSupabase(false);
    }
  };

  // Generate Email Report Draft Logic
  const emailDraftData = useMemo(() => {
    let targetContainers = containers;
    if (emailMonthFilter !== 'ALL') {
      targetContainers = containers.filter(c => {
        const dateStr = c.tglTibaBintara || c.tglTibaPriuk || c.createdAt || '';
        return dateStr.startsWith(emailMonthFilter);
      });
    }

    // Grouping by Month for detailed breakdown
    const monthlySummary: Record<string, { total: number; tibaBintara: number; masihOTW: number; belumOTW: number }> = {};

    let totalAll = 0;
    let totalTibaBintara = 0;
    let totalMasihOTW = 0;
    let totalBelumOTW = 0;

    targetContainers.forEach(c => {
      const dateStr = c.tglTibaBintara || c.tglTibaPriuk || c.createdAt || new Date().toISOString().slice(0, 7);
      const mKey = dateStr.length >= 7 ? dateStr.slice(0, 7) : 'Unknown';

      if (!monthlySummary[mKey]) {
        monthlySummary[mKey] = { total: 0, tibaBintara: 0, masihOTW: 0, belumOTW: 0 };
      }

      monthlySummary[mKey].total++;
      totalAll++;

      if (c.statusContainer === 'Barang Sudah Tiba di Bintara') {
        monthlySummary[mKey].tibaBintara++;
        totalTibaBintara++;
      } else if (c.statusContainer === 'Container Masih OTW') {
        monthlySummary[mKey].masihOTW++;
        totalMasihOTW++;
      } else {
        monthlySummary[mKey].belumOTW++;
        totalBelumOTW++;
      }
    });

    const formatMonthName = (mStr: string) => {
      if (mStr === 'ALL') return 'Semua Periode Bulan';
      try {
        const [year, month] = mStr.split('-');
        const dateObj = new Date(parseInt(year), parseInt(month) - 1, 1);
        return dateObj.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
      } catch {
        return mStr;
      }
    };

    const periodName = formatMonthName(emailMonthFilter);
    const currentDateFormatted = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    const subject = `[LAPORAN CONTAINER] Rekapan Status Perjalanan Container - ${periodName} (${currentDateFormatted})`;

    let bodyText = `Yth. Bapak/Ibu Manajemen & Team Logistik,

Berikut disampaikan Laporan Rekapan Status Perjalanan Container untuk periode ${periodName}:

==================================================
RINGKASAN UTAMA STATUS CONTAINER (${periodName.toUpperCase()})
==================================================
• Total Keseluruhan Container  : ${totalAll} Container
• Barang Sudah Tiba di Bintara : ${totalTibaBintara} Container
• Container Masih OTW          : ${totalMasihOTW} Container
• Container Belum OTW          : ${totalBelumOTW} Container

`;

    // Monthly breakdown text block
    const monthKeys = Object.keys(monthlySummary).sort().reverse();
    if (monthKeys.length > 0) {
      bodyText += `--------------------------------------------------\n`;
      bodyText += `PERINCIAN RINCIAN PER BULAN:\n`;
      bodyText += `--------------------------------------------------\n`;

      monthKeys.forEach(mk => {
        const mLabel = formatMonthName(mk);
        const mData = monthlySummary[mk];
        bodyText += `📅 ${mLabel}:\n`;
        bodyText += `   - Total Container        : ${mData.total} Container\n`;
        bodyText += `   - Sudah Tiba di Bintara  : ${mData.tibaBintara} Container\n`;
        bodyText += `   - Container Masih OTW    : ${mData.masihOTW} Container\n`;
        bodyText += `   - Container Belum OTW    : ${mData.belumOTW} Container\n\n`;
      });
    }

    // List of active OTW & Belum OTW Containers
    const pendingContainers = targetContainers.filter(c => c.statusContainer !== 'Barang Sudah Tiba di Bintara');
    if (pendingContainers.length > 0) {
      bodyText += `--------------------------------------------------\n`;
      bodyText += `DAFTAR CONTAINER DALAM PERJALANAN / PENDING:\n`;
      bodyText += `--------------------------------------------------\n`;
      pendingContainers.slice(0, 20).forEach((c, idx) => {
        bodyText += `${idx + 1}. [${c.noContainer}] - ${c.category} | ${c.itemCategoryBarang || 'Umum'} | Status: ${c.statusContainer} (Priuk: ${c.tglTibaPriuk || '-'})\n`;
      });
      if (pendingContainers.length > 20) {
        bodyText += `... Dan ${pendingContainers.length - 20} container pending lainnya (dapat dicek selengkapnya di sistem inventoris web).\n`;
      }
      bodyText += `\n`;
    }

    bodyText += `Demikian laporan status perjalanan container ini kami sampaikan. Mohon bantuan koordinasi untuk pemantauan penerimaan barang di Bintara.

Terima kasih.

Salam hormat,
Team Admin Logistik & Inventoris
Aplikasi Inventoris Gudang`;

    return { subject, bodyText, totalAll, totalTibaBintara, totalMasihOTW, totalBelumOTW };
  }, [containers, emailMonthFilter]);

  const handleCopySubject = () => {
    navigator.clipboard.writeText(emailDraftData.subject);
    setCopiedSubject(true);
    showToast('Subjek email berhasil disalin ke clipboard!', 'success');
    setTimeout(() => setCopiedSubject(false), 2000);
  };

  const handleCopyBody = () => {
    navigator.clipboard.writeText(emailDraftData.bodyText);
    setCopiedBody(true);
    showToast('Isi body email laporan berhasil disalin!', 'success');
    setTimeout(() => setCopiedBody(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header Title Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
              <Ship className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Status Perjalanan Container</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Monitoring tracking pengiriman container impor &amp; lokal dari Tanjung Priuk ke Bintara
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSyncToSupabase}
            disabled={syncingSupabase}
            className="px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-sm font-semibold flex items-center space-x-2 transition-all shadow-sm hover:shadow disabled:opacity-50"
            title="Simpan seluruh Data Status Container (baris yang belum tersimpan) ke Database SQL Server"
          >
            <Database className={`w-4 h-4 ${syncingSupabase ? 'animate-spin' : ''}`} />
            <span>{syncingSupabase ? 'Menyimpan...' : 'Simpan Ke Database'}</span>
          </button>

          <button
            onClick={() => setIsEmailModalOpen(true)}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold flex items-center space-x-2 transition-all shadow-sm hover:shadow"
          >
            <Mail className="w-4 h-4" />
            <span>Draft Email Laporan</span>
          </button>

          <button
            onClick={() => setIsImportOpen(true)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold flex items-center space-x-2 transition-all shadow-sm hover:shadow"
          >
            <Upload className="w-4 h-4" />
            <span>Import Rekapan</span>
          </button>

          <button
            onClick={handleExport}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-semibold flex items-center space-x-2 transition-all shadow-sm"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Export Excel</span>
          </button>

          <button
            onClick={() => handleOpenForm()}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold flex items-center space-x-2 transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Container</span>
          </button>

          <button
            onClick={onRefreshData}
            className="p-2.5 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200"
            title="Refresh Data"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Summary Cards with Minimize/Expand Toggle */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all">
        {/* Dashboard Header Bar */}
        <button 
          type="button"
          onClick={() => setIsDashboardMinimized(prev => !prev)}
          className={`w-full bg-slate-50 hover:bg-slate-100/80 p-3 sm:p-4 flex items-center justify-between cursor-pointer select-none transition text-left ${
            !isDashboardMinimized ? 'border-b border-slate-200/80' : ''
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="p-1.5 bg-blue-100 text-blue-700 rounded-xl shrink-0">
              <Ship className="w-4 h-4" />
            </div>
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="text-xs sm:text-sm font-bold text-slate-800 tracking-tight shrink-0">
                Dashboard Summary Status Container
              </span>
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-blue-100 text-blue-800 rounded-full border border-blue-200 shrink-0">
                {summaryMetrics.total} Container ({summaryMetrics.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs)
              </span>
              <span className="hidden md:inline-block px-2 py-0.5 text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 rounded-full border border-emerald-200 shrink-0">
                Tiba: {summaryMetrics.tibaBintara} | OTW: {summaryMetrics.masihOTW} | Belum: {summaryMetrics.belumOTW}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white px-3 py-1.5 rounded-xl border border-slate-300 shadow-2xs transition shrink-0 ml-2">
            {isDashboardMinimized ? (
              <>
                <ChevronDown className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="whitespace-nowrap">Buka Dashboard</span>
              </>
            ) : (
              <>
                <ChevronUp className="w-4 h-4 text-slate-600 shrink-0" />
                <span className="whitespace-nowrap">Minimize</span>
              </>
            )}
          </div>
        </button>

        {/* Collapsible Content */}
        {!isDashboardMinimized && (
          <div className="p-3.5 space-y-3 bg-slate-50/30">
            {/* Row 1: Grand Summary Metrics (4 Cards) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Total Container */}
              <div 
                onClick={() => setStatusFilter('ALL')}
                className={`p-3.5 rounded-2xl border shadow-sm flex flex-col justify-between cursor-pointer transition-all hover:scale-[1.01] ${
                  statusFilter === 'ALL' 
                    ? 'bg-blue-50/40 border-blue-500 ring-2 ring-blue-500/20' 
                    : 'bg-white border-slate-200/80 hover:border-blue-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Container</p>
                  <div className="p-1.5 bg-blue-50 text-blue-600 rounded-xl">
                    <Ship className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-2">
                  <h3 className="text-xl font-bold text-slate-800">{summaryMetrics.total}</h3>
                  <p className="text-[10px] text-slate-400 mt-0.5 truncate">Total Rekapan Container</p>
                </div>
              </div>

              {/* Total Qty */}
              <div className="p-3.5 rounded-2xl border border-indigo-200/80 bg-indigo-50/20 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">Total Qty</p>
                  <div className="p-1.5 bg-indigo-100 text-indigo-700 rounded-xl">
                    <Boxes className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-2">
                  <h3 className="text-xl font-bold text-indigo-900 font-mono">{summaryMetrics.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</h3>
                  <p className="text-[10px] text-indigo-600 mt-0.5 truncate">Total Pcs / Item</p>
                </div>
              </div>

              {/* Total Cost */}
              <div className="p-3.5 rounded-2xl border border-blue-200/80 bg-blue-50/20 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Total Nilai Cost</p>
                  <div className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-bold font-mono text-[10px]">
                    Rp
                  </div>
                </div>
                <div className="mt-2">
                  <h3 className="text-sm md:text-base font-bold text-blue-900 font-mono truncate">{formatCurrency(summaryMetrics.totalCost)}</h3>
                  <p className="text-[10px] text-blue-600 mt-0.5 truncate">Harga Beli</p>
                </div>
              </div>

              {/* Total Price */}
              <div className="p-3.5 rounded-2xl border border-emerald-200/80 bg-emerald-50/20 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Total Nilai Price</p>
                  <div className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-bold font-mono text-[10px]">
                    Rp
                  </div>
                </div>
                <div className="mt-2">
                  <h3 className="text-sm md:text-base font-bold text-emerald-900 font-mono truncate">{formatCurrency(summaryMetrics.totalPrice)}</h3>
                  <p className="text-[10px] text-emerald-600 mt-0.5 truncate">Harga Jual</p>
                </div>
              </div>
            </div>

            {/* Row 2: Status Breakdown Cards (Barang Sudah Diterima, Barang Sudah OTW, Barang Belum OTW) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Card 1: Barang Sudah Diterima (Tiba Bintara) */}
              <div 
                onClick={() => setStatusFilter('Barang Sudah Tiba di Bintara')}
                className={`p-4 rounded-2xl border shadow-sm flex flex-col justify-between cursor-pointer transition-all hover:scale-[1.01] ${
                  statusFilter === 'Barang Sudah Tiba di Bintara'
                    ? 'bg-emerald-50/80 border-emerald-500 ring-2 ring-emerald-500/20'
                    : 'bg-gradient-to-br from-emerald-50/40 to-white border-emerald-200/80 hover:border-emerald-400'
                }`}
              >
                <div className="flex items-center justify-between pb-2 border-b border-emerald-100">
                  <div className="flex items-center gap-1.5">
                    <div className="p-1.5 bg-emerald-100 text-emerald-700 rounded-xl">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-emerald-900 uppercase tracking-wide">Barang Sudah Diterima</p>
                      <p className="text-[10px] text-emerald-700 font-medium">Tiba di Bintara</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                    Siap Diproses
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-medium text-slate-600">Jumlah Container:</span>
                    <span className="text-lg font-bold text-emerald-800 font-mono">{summaryMetrics.tibaBintara} <span className="text-xs font-normal text-slate-500">Container</span></span>
                  </div>

                  <div className="bg-white/80 p-2.5 rounded-xl border border-emerald-100 space-y-1.5 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600 font-medium">Total Qty:</span>
                      <span className="font-mono font-bold text-slate-900">{summaryMetrics.tibaBintaraQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600 font-medium">Total Cost (Beli):</span>
                      <span className="font-mono font-bold text-blue-700">{formatCurrency(summaryMetrics.tibaBintaraCost)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600 font-medium">Nilai Jual (Price):</span>
                      <span className="font-mono font-bold text-emerald-700">{formatCurrency(summaryMetrics.tibaBintaraPrice)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 2: Barang Sudah OTW (Container Masih OTW) */}
              <div 
                onClick={() => setStatusFilter('Container Masih OTW')}
                className={`p-4 rounded-2xl border shadow-sm flex flex-col justify-between cursor-pointer transition-all hover:scale-[1.01] ${
                  statusFilter === 'Container Masih OTW'
                    ? 'bg-amber-50/80 border-amber-500 ring-2 ring-amber-500/20'
                    : 'bg-gradient-to-br from-amber-50/40 to-white border-amber-200/80 hover:border-amber-400'
                }`}
              >
                <div className="flex items-center justify-between pb-2 border-b border-amber-100">
                  <div className="flex items-center gap-1.5">
                    <div className="p-1.5 bg-amber-100 text-amber-700 rounded-xl">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-amber-900 uppercase tracking-wide">Barang Sudah OTW</p>
                      <p className="text-[10px] text-amber-700 font-medium">Container Masih OTW</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                    Dalam Perjalanan
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-medium text-slate-600">Jumlah Container:</span>
                    <span className="text-lg font-bold text-amber-800 font-mono">{summaryMetrics.masihOTW} <span className="text-xs font-normal text-slate-500">Container</span></span>
                  </div>

                  <div className="bg-white/80 p-2.5 rounded-xl border border-amber-100 space-y-1.5 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600 font-medium">Total Qty:</span>
                      <span className="font-mono font-bold text-slate-900">{summaryMetrics.masihOTWQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600 font-medium">Total Cost (Beli):</span>
                      <span className="font-mono font-bold text-blue-700">{formatCurrency(summaryMetrics.masihOTWCost)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600 font-medium">Nilai Jual (Price):</span>
                      <span className="font-mono font-bold text-amber-700">{formatCurrency(summaryMetrics.masihOTWPrice)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 3: Barang Belum OTW (Container Belum OTW) */}
              <div 
                onClick={() => setStatusFilter('Container Belum OTW')}
                className={`p-4 rounded-2xl border shadow-sm flex flex-col justify-between cursor-pointer transition-all hover:scale-[1.01] ${
                  statusFilter === 'Container Belum OTW'
                    ? 'bg-slate-100 border-slate-500 ring-2 ring-slate-400/20'
                    : 'bg-gradient-to-br from-slate-50 to-white border-slate-200 hover:border-slate-400'
                }`}
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <div className="flex items-center gap-1.5">
                    <div className="p-1.5 bg-slate-200 text-slate-700 rounded-xl">
                      <HelpCircle className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900 uppercase tracking-wide">Barang Belum OTW</p>
                      <p className="text-[10px] text-slate-600 font-medium">Container Belum OTW</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-semibold text-slate-700 bg-slate-200 px-2 py-0.5 rounded-full">
                    Menunggu Kirim
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-medium text-slate-600">Jumlah Container:</span>
                    <span className="text-lg font-bold text-slate-800 font-mono">{summaryMetrics.belumOTW} <span className="text-xs font-normal text-slate-500">Container</span></span>
                  </div>

                  <div className="bg-white/80 p-2.5 rounded-xl border border-slate-200 space-y-1.5 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600 font-medium">Total Qty:</span>
                      <span className="font-mono font-bold text-slate-900">{summaryMetrics.belumOTWQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600 font-medium">Total Cost (Beli):</span>
                      <span className="font-mono font-bold text-blue-700">{formatCurrency(summaryMetrics.belumOTWCost)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600 font-medium">Nilai Jual (Price):</span>
                      <span className="font-mono font-bold text-emerald-700">{formatCurrency(summaryMetrics.belumOTWPrice)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Cari No Container, Category, atau Category Barang..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 hover:bg-slate-100/80 focus:bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          />
        </div>

        {/* Filter Dropdowns */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Status Filter */}
          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="ALL">Semua Status Container</option>
              <option value="Barang Sudah Tiba di Bintara">🟢 Barang Sudah Tiba di Bintara</option>
              <option value="Container Masih OTW">🟡 Container Masih OTW</option>
              <option value="Container Belum OTW">⚪ Container Belum OTW</option>
            </select>
          </div>

          {/* Category Filter */}
          {availableCategories.length > 0 && (
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="ALL">Semua Kategori</option>
              {availableCategories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          )}

          {/* Month Filter */}
          {availableMonths.length > 0 && (
            <div className="flex items-center space-x-2">
              <Calendar className="w-4 h-4 text-slate-400" />
              <select
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="ALL">Semua Bulan</option>
                {availableMonths.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Main Table Container */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200/80 text-xs font-bold text-slate-600 uppercase tracking-wider">
                <th className="py-3.5 px-4 text-center w-12">No</th>
                <SortableHeader
                  label="No Container"
                  field="noContainer"
                  currentSortKey={sortField}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Category"
                  field="category"
                  currentSortKey={sortField}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Tgl Tiba Di Priuk"
                  field="tglTibaPriuk"
                  currentSortKey={sortField}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Tgl Tiba Di Bintara"
                  field="tglTibaBintara"
                  currentSortKey={sortField}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Item Category Barang"
                  field="itemCategoryBarang"
                  currentSortKey={sortField}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Status Container"
                  field="statusContainer"
                  currentSortKey={sortField}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Total Qty"
                  field="totalQty"
                  currentSortKey={sortField}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Total Cost"
                  field="totalCost"
                  currentSortKey={sortField}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Total Price"
                  field="totalPrice"
                  currentSortKey={sortField}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Keterangan / Remark"
                  field="remark"
                  currentSortKey={sortField}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <th className="py-3.5 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredContainers.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <Ship className="w-10 h-10 text-slate-300 stroke-[1.5]" />
                      <p className="font-medium text-slate-600">Tidak ada data status container ditemukan</p>
                      <p className="text-xs text-slate-400">Silakan tambahkan container baru atau gunakan fitur Import Excel.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedContainers.map((item, idx) => {
                  let badgeStyle = 'bg-slate-100 text-slate-700 border-slate-200';
                  let icon = <HelpCircle className="w-3.5 h-3.5" />;

                  if (item.statusContainer === 'Barang Sudah Tiba di Bintara') {
                    badgeStyle = 'bg-emerald-50 text-emerald-700 border-emerald-200/80 font-semibold';
                    icon = <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />;
                  } else if (item.statusContainer === 'Container Masih OTW') {
                    badgeStyle = 'bg-amber-50 text-amber-700 border-amber-200/80 font-semibold';
                    icon = <Clock className="w-3.5 h-3.5 text-amber-600" />;
                  } else if (item.statusContainer === 'Container Belum OTW') {
                    badgeStyle = 'bg-slate-100 text-slate-600 border-slate-200';
                    icon = <HelpCircle className="w-3.5 h-3.5 text-slate-400" />;
                  }

                  return (
                    <tr key={item.id || idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4 text-center text-xs text-slate-400 font-mono">
                        {idx + 1}
                      </td>

                      {/* No Container */}
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-800">
                        {item.noContainer}
                      </td>

                      {/* Category */}
                      <td className="py-3.5 px-4 text-slate-600">
                        <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold uppercase">
                          {item.category || '-'}
                        </span>
                      </td>

                      {/* Tgl Tiba Di Priuk */}
                      <td className="py-3.5 px-4 text-slate-600 font-mono text-xs">
                        {item.tglTibaPriuk || '-'}
                      </td>

                      {/* Tgl Tiba Di Bintara */}
                      <td className="py-3.5 px-4 text-slate-600 font-mono text-xs">
                        {item.tglTibaBintara ? (
                          <span className="text-emerald-700 font-medium">{item.tglTibaBintara}</span>
                        ) : (
                          <span className="text-slate-400 italic">- Belum -</span>
                        )}
                      </td>

                      {/* Item Category Barang */}
                      <td className="py-3.5 px-4 text-slate-700 font-medium">
                        {item.itemCategoryBarang || '-'}
                      </td>

                      {/* Status Container Badge */}
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs border ${badgeStyle}`}>
                          {icon}
                          <span>{item.statusContainer}</span>
                        </span>
                      </td>

                      {/* Total Qty */}
                      <td className="py-3.5 px-4 text-slate-800 font-mono font-bold text-xs">
                        {item.totalQty ? item.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 }) : '-'}
                      </td>

                      {/* Total Cost */}
                      <td className="py-3.5 px-4 text-blue-700 font-mono text-xs font-semibold">
                        {item.totalCost ? formatCurrency(item.totalCost) : '-'}
                      </td>

                      {/* Total Price */}
                      <td className="py-3.5 px-4 text-emerald-700 font-mono text-xs font-bold">
                        {item.totalPrice ? formatCurrency(item.totalPrice) : '-'}
                      </td>

                      {/* Remark / Keterangan */}
                      <td className="py-3.5 px-4 text-xs text-slate-600 max-w-xs leading-relaxed">
                        {item.remark ? (
                          <span className="bg-slate-50 border border-slate-200/80 px-2 py-1 rounded-md inline-block font-mono text-[11px] text-slate-700 break-words whitespace-pre-wrap">
                            {item.remark}
                          </span>
                        ) : (
                          <span className="text-slate-300 italic">-</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end space-x-1">
                          <button
                            onClick={() => handleOpenForm(item)}
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit Status"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeletingId(item.id || null)}
                            className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Hapus"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredContainers.length > 0 && totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 px-1">
            <span className="text-xs text-slate-500 font-medium">
              Menampilkan {((safePage - 1) * PAGE_SIZE) + 1}–{Math.min(safePage * PAGE_SIZE, filteredContainers.length)} dari {filteredContainers.length.toLocaleString('id-ID', { maximumFractionDigits: 0 })} item
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ← Sebelumnya
              </button>
              <span className="text-xs font-mono font-semibold text-slate-600 px-2">{safePage} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Selanjutnya →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add / Edit Container Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-5 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800">
                {editingRecord ? 'Edit Status Container' : 'Tambah Container Baru'}
              </h3>
              <button
                onClick={() => setIsFormOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  No Container *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: TCNU-1234567"
                  value={formData.noContainer}
                  onChange={e => setFormData({ ...formData, noContainer: e.target.value.toUpperCase() })}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Category Container
                  </label>
                  <input
                    type="text"
                    placeholder="E.g. IMPORT / LOKAL"
                    value={formData.category}
                    onChange={e => setFormData({ ...formData, category: e.target.value.toUpperCase() })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Item Category Barang
                  </label>
                  <input
                    type="text"
                    placeholder="E.g. SPAREPART, AKSESORIS"
                    value={formData.itemCategoryBarang}
                    onChange={e => setFormData({ ...formData, itemCategoryBarang: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Tgl Tiba Di Priuk
                  </label>
                  <input
                    type="date"
                    value={formData.tglTibaPriuk}
                    onChange={e => setFormData({ ...formData, tglTibaPriuk: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Tgl Tiba Di Bintara
                  </label>
                  <input
                    type="date"
                    value={formData.tglTibaBintara}
                    onChange={e => {
                      const newTglBintara = e.target.value;
                      let newStatus = formData.statusContainer;
                      if (newTglBintara) {
                        newStatus = 'Barang Sudah Tiba di Bintara';
                      }
                      setFormData({ 
                        ...formData, 
                        tglTibaBintara: newTglBintara,
                        statusContainer: newStatus 
                      });
                    }}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Total Qty
                  </label>
                  <input
                    type="number"
                    placeholder="0"
                    value={formData.totalQty || ''}
                    onChange={e => setFormData({ ...formData, totalQty: Number(e.target.value) })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Total Cost (Rp)
                  </label>
                  <input
                    type="number"
                    placeholder="0"
                    value={formData.totalCost || ''}
                    onChange={e => setFormData({ ...formData, totalCost: Number(e.target.value) })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Total Price (Rp)
                  </label>
                  <input
                    type="number"
                    placeholder="0"
                    value={formData.totalPrice || ''}
                    onChange={e => setFormData({ ...formData, totalPrice: Number(e.target.value) })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Status Container *
                </label>
                <select
                  value={formData.statusContainer}
                  onChange={e => setFormData({ ...formData, statusContainer: e.target.value as ContainerStatusType })}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  <option value="Barang Sudah Tiba di Bintara">🟢 Barang Sudah Tiba di Bintara</option>
                  <option value="Container Masih OTW">🟡 Container Masih OTW</option>
                  <option value="Container Belum OTW">⚪ Container Belum OTW</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Keterangan / Remark (Opsional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Catatan tambahan lokasi atau nomor surat jalan..."
                  value={formData.remark || ''}
                  onChange={e => setFormData({ ...formData, remark: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-semibold transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold shadow-sm transition-all disabled:opacity-50"
                >
                  {submitting ? 'Menyimpan...' : editingRecord ? 'Simpan Perubahan' : 'Tambah Container'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {isImportOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                <h3 className="text-lg font-bold text-slate-800">Import Rekapan Container (Excel)</h3>
              </div>
              <button
                onClick={() => setIsImportOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Unggah file Excel (.xlsx / .xls) yang berisi data status container. Pastikan memiliki kolom header:
                <span className="block mt-1 font-mono text-xs bg-slate-100 p-2 rounded-lg text-slate-700">
                  No Container, Category, Tgl Tiba Di Priuk, Tgl Tiba Di Bintara, Item Category Barang, Status Container
                </span>
              </p>

              <div className="p-4 bg-emerald-50/50 rounded-xl border border-emerald-100 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-emerald-800">Belum punya format Excel?</p>
                  <p className="text-xs text-emerald-600 mt-0.5">Unduh template Excel standar status container.</p>
                </div>
                <button
                  onClick={() => downloadExcelTemplate('container')}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm"
                >
                  Download Template
                </button>
              </div>

              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center hover:bg-slate-50 transition-colors relative cursor-pointer">
                <input
                  type="file"
                  accept=".xlsx, .xls"
                  onChange={handleFileUpload}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  disabled={importLoading}
                />
                <div className="flex flex-col items-center justify-center space-y-2">
                  <Upload className="w-8 h-8 text-slate-400" />
                  <p className="text-sm font-semibold text-slate-700">
                    {importLoading ? 'Memproses File Excel...' : 'Klik atau Tarik File Excel ke Sini'}
                  </p>
                  <p className="text-xs text-slate-400">Format didukung: .xlsx, .xls</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-100">
              <button
                onClick={() => setIsImportOpen(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-semibold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email Container Report Modal */}
      <EmailContainerReportModal
        isOpen={isEmailModalOpen}
        onClose={() => setIsEmailModalOpen(false)}
        containers={containers}
      />

      {/* Delete Confirmation Modal */}
      {deletingId && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 text-center space-y-4">
            <div className="w-12 h-12 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800">Hapus Container Ini?</h3>
              <p className="text-xs text-slate-500 mt-1">
                Data container akan dihapus permanent dari database SQL Server.
              </p>
            </div>
            <div className="flex items-center justify-center space-x-3 pt-2">
              <button
                onClick={() => setDeletingId(null)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-semibold"
              >
                Batal
              </button>
              <button
                onClick={() => handleDelete(deletingId)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-sm"
              >
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
