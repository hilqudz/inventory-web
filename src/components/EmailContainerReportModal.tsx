import React, { useState, useMemo, useEffect } from 'react';
import { 
  X, 
  Mail, 
  Copy, 
  Check, 
  ExternalLink, 
  FileText,
  Table as TableIcon,
  Sparkles,
  Ship,
  ChevronDown,
  Filter,
  CheckSquare,
  Square,
  CheckCircle2,
  Clock,
  HelpCircle
} from 'lucide-react';
import { ContainerRecord } from '../types';

interface EmailContainerReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  containers: ContainerRecord[];
}

export const EmailContainerReportModal: React.FC<EmailContainerReportModalProps> = ({
  isOpen,
  onClose,
  containers
}) => {
  const [copiedText, setCopiedText] = useState(false);
  const [copiedHtml, setCopiedHtml] = useState(false);
  const [copiedSubject, setCopiedSubject] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [activeTab, setActiveTab] = useState<'preview' | 'text'>('preview');
  const [emailMonthFilter, setEmailMonthFilter] = useState<string>('ALL');
  
  // Category Multi-Select Filter States
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState<boolean>(false);

  // Format Date
  const reportDate = useMemo(() => {
    return new Date().toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }, []);

  // Available unique container categories
  const availableCategories = useMemo(() => {
    const catSet = new Set<string>();
    containers.forEach(c => {
      const cat = (c.category || 'LAINNYA').trim().toUpperCase();
      if (cat) catSet.add(cat);
    });
    return Array.from(catSet).sort();
  }, [containers]);

  // Sync selectedCategories when availableCategories or modal open changes
  useEffect(() => {
    if (isOpen) {
      setSelectedCategories(availableCategories);
    }
  }, [availableCategories, isOpen]);

  // Multi-select Category Handlers
  const toggleCategory = (cat: string) => {
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const handleSelectAllCategories = () => {
    setSelectedCategories(availableCategories);
  };

  const handleClearAllCategories = () => {
    setSelectedCategories([]);
  };

  // Label for category filter
  const categoryFilterLabel = useMemo(() => {
    if (selectedCategories.length === 0) return 'Tanpa Category';
    if (selectedCategories.length === availableCategories.length) return 'Semua Category';
    return selectedCategories.join(', ');
  }, [selectedCategories, availableCategories]);

  // Available unique months
  const availableMonths = useMemo(() => {
    const monthSet = new Set<string>();
    containers.forEach(c => {
      const dateStr = c.tglTibaBintara || c.tglTibaPriuk || c.createdAt || '';
      if (dateStr && dateStr.length >= 7 && dateStr.includes('-')) {
        monthSet.add(dateStr.slice(0, 7));
      }
    });
    return Array.from(monthSet).sort().reverse();
  }, [containers]);

  // Calculations with Category Multi-Select Filter
  const reportData = useMemo(() => {
    let targetContainers = containers;
    
    // Filter by Month
    if (emailMonthFilter !== 'ALL') {
      targetContainers = targetContainers.filter(c => {
        const dateStr = c.tglTibaBintara || c.tglTibaPriuk || c.createdAt || '';
        return dateStr.startsWith(emailMonthFilter);
      });
    }

    // Filter by Multi-Select Categories
    if (selectedCategories.length === 0) {
      targetContainers = [];
    } else if (selectedCategories.length < availableCategories.length) {
      targetContainers = targetContainers.filter(c => {
        const cat = (c.category || 'LAINNYA').trim().toUpperCase();
        return selectedCategories.includes(cat);
      });
    }

    let totalAll = 0;
    let totalTibaBintara = 0;
    let totalMasihOTW = 0;
    let totalBelumOTW = 0;

    let totalQtyAll = 0;
    let totalCostAll = 0;
    let totalPriceAll = 0;

    let tibaQty = 0, tibaCost = 0, tibaPrice = 0;
    let otwQty = 0, otwCost = 0, otwPrice = 0;
    let belumQty = 0, belumCost = 0, belumPrice = 0;

    // Grouping by Category (IMPORT vs LOKAL)
    const categoryMap: Record<string, {
      categoryName: string;
      total: number;
      tibaBintara: number;
      tibaQty: number;
      tibaCost: number;
      tibaPrice: number;
      masihOTW: number;
      otwQty: number;
      otwCost: number;
      otwPrice: number;
      belumOTW: number;
      belumQty: number;
      belumCost: number;
      belumPrice: number;
      totalQty: number;
      totalCost: number;
      totalPrice: number;
    }> = {};

    // Grouping by Month
    const monthlyMap: Record<string, {
      monthKey: string;
      total: number;
      tibaBintara: number;
      tibaQty: number;
      tibaCost: number;
      tibaPrice: number;
      masihOTW: number;
      otwQty: number;
      otwCost: number;
      otwPrice: number;
      belumOTW: number;
      belumQty: number;
      belumCost: number;
      belumPrice: number;
      totalQty: number;
      totalCost: number;
      totalPrice: number;
    }> = {};

    targetContainers.forEach(c => {
      totalAll++;
      const st = c.statusContainer;
      const cat = (c.category || 'LAINNYA').trim().toUpperCase();

      const q = Number(c.totalQty) || 0;
      const cost = Number(c.totalCost) || 0;
      const price = Number(c.totalPrice) || 0;

      totalQtyAll += q;
      totalCostAll += cost;
      totalPriceAll += price;

      let isTiba = false;
      let isOTW = false;
      let isBelum = false;

      if (st === 'Barang Sudah Tiba di Bintara') {
        totalTibaBintara++;
        tibaQty += q;
        tibaCost += cost;
        tibaPrice += price;
        isTiba = true;
      } else if (st === 'Container Masih OTW') {
        totalMasihOTW++;
        otwQty += q;
        otwCost += cost;
        otwPrice += price;
        isOTW = true;
      } else {
        totalBelumOTW++;
        belumQty += q;
        belumCost += cost;
        belumPrice += price;
        isBelum = true;
      }

      // Populate Category
      if (!categoryMap[cat]) {
        categoryMap[cat] = {
          categoryName: cat,
          total: 0,
          tibaBintara: 0,
          tibaQty: 0,
          tibaCost: 0,
          tibaPrice: 0,
          masihOTW: 0,
          otwQty: 0,
          otwCost: 0,
          otwPrice: 0,
          belumOTW: 0,
          belumQty: 0,
          belumCost: 0,
          belumPrice: 0,
          totalQty: 0,
          totalCost: 0,
          totalPrice: 0
        };
      }
      categoryMap[cat].total++;
      categoryMap[cat].totalQty += q;
      categoryMap[cat].totalCost += cost;
      categoryMap[cat].totalPrice += price;
      if (isTiba) {
        categoryMap[cat].tibaBintara++;
        categoryMap[cat].tibaQty += q;
        categoryMap[cat].tibaCost += cost;
        categoryMap[cat].tibaPrice += price;
      } else if (isOTW) {
        categoryMap[cat].masihOTW++;
        categoryMap[cat].otwQty += q;
        categoryMap[cat].otwCost += cost;
        categoryMap[cat].otwPrice += price;
      } else {
        categoryMap[cat].belumOTW++;
        categoryMap[cat].belumQty += q;
        categoryMap[cat].belumCost += cost;
        categoryMap[cat].belumPrice += price;
      }

      // Populate Month
      const dateStr = c.tglTibaBintara || c.tglTibaPriuk || c.createdAt || new Date().toISOString().slice(0, 7);
      const mKey = dateStr.length >= 7 ? dateStr.slice(0, 7) : 'Lainnya';

      if (!monthlyMap[mKey]) {
        monthlyMap[mKey] = {
          monthKey: mKey,
          total: 0,
          tibaBintara: 0,
          tibaQty: 0,
          tibaCost: 0,
          tibaPrice: 0,
          masihOTW: 0,
          otwQty: 0,
          otwCost: 0,
          otwPrice: 0,
          belumOTW: 0,
          belumQty: 0,
          belumCost: 0,
          belumPrice: 0,
          totalQty: 0,
          totalCost: 0,
          totalPrice: 0
        };
      }
      monthlyMap[mKey].total++;
      monthlyMap[mKey].totalQty += q;
      monthlyMap[mKey].totalCost += cost;
      monthlyMap[mKey].totalPrice += price;
      if (isTiba) {
        monthlyMap[mKey].tibaBintara++;
        monthlyMap[mKey].tibaQty += q;
        monthlyMap[mKey].tibaCost += cost;
        monthlyMap[mKey].tibaPrice += price;
      } else if (isOTW) {
        monthlyMap[mKey].masihOTW++;
        monthlyMap[mKey].otwQty += q;
        monthlyMap[mKey].otwCost += cost;
        monthlyMap[mKey].otwPrice += price;
      } else {
        monthlyMap[mKey].belumOTW++;
        monthlyMap[mKey].belumQty += q;
        monthlyMap[mKey].belumCost += cost;
        monthlyMap[mKey].belumPrice += price;
      }
    });

    const categoryList = Object.values(categoryMap).sort((a, b) => b.total - a.total);
    const monthlyList = Object.values(monthlyMap).sort((a, b) => b.monthKey.localeCompare(a.monthKey));

    // Pending containers sorted by Status Perjalanan (Masih OTW first, then Belum OTW)
    const statusPriority: Record<string, number> = {
      'Container Masih OTW': 1,
      'Container Belum OTW': 2
    };

    const pendingContainers = targetContainers
      .filter(c => c.statusContainer !== 'Barang Sudah Tiba di Bintara')
      .sort((a, b) => {
        const orderA = statusPriority[a.statusContainer] || 99;
        const orderB = statusPriority[b.statusContainer] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return (a.noContainer || '').localeCompare(b.noContainer || '');
      });

    let totalPendingQty = 0;
    let totalPendingCost = 0;
    let totalPendingPrice = 0;

    pendingContainers.forEach(c => {
      totalPendingQty += (Number(c.totalQty) || 0);
      totalPendingCost += (Number(c.totalCost) || 0);
      totalPendingPrice += (Number(c.totalPrice) || 0);
    });

    const formatMonthLabel = (mStr: string) => {
      if (mStr === 'ALL') return 'Semua Periode';
      try {
        const [year, month] = mStr.split('-');
        const dateObj = new Date(parseInt(year), parseInt(month) - 1, 1);
        return dateObj.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
      } catch {
        return mStr;
      }
    };

    const periodName = formatMonthLabel(emailMonthFilter);

    return {
      targetContainers,
      totalAll,
      totalTibaBintara,
      totalMasihOTW,
      totalBelumOTW,
      totalQtyAll,
      totalCostAll,
      totalPriceAll,
      tibaQty,
      tibaCost,
      tibaPrice,
      otwQty,
      otwCost,
      otwPrice,
      belumQty,
      belumCost,
      belumPrice,
      totalPendingQty,
      totalPendingCost,
      totalPendingPrice,
      categoryList,
      monthlyList,
      pendingContainers,
      periodName,
      formatMonthLabel
    };
  }, [containers, emailMonthFilter, selectedCategories, availableCategories]);

  if (!isOpen) return null;

  const emailSubject = `[LAPORAN CONTAINER] Rekapan Status Perjalanan Container (${categoryFilterLabel}) - ${reportData.periodName} (${reportDate})`;

  const formatRp = (val: number) => 'Rp ' + Math.round(val || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });
  const formatQty = (val: number) => (val || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });

  // Plain Text Version with ASCII Tables
  const plainTextEmail = `Yth. Bapak/Ibu Manajemen & Team Logistik,

Berikut adalah LAPORAN RESMI REKAPAN STATUS PERJALANAN CONTAINER per tanggal ${reportDate} (Periode: ${reportData.periodName}):

* RINGKASAN REKAPAN TOTAL *
• Total Container  : ${reportData.totalAll} Unit
• Total Qty Barang : ${formatQty(reportData.totalQtyAll)} Pcs
• Total Nilai Beli : ${formatRp(reportData.totalCostAll)}

==============================================================================================================================================
1. TABEL RINGKASAN UTAMA STATUS CONTAINER (${reportData.periodName.toUpperCase()})
==============================================================================================================================================
+------------------------------------------+---------------------+-------------------+--------------------------+-----------------------+
| Status Perjalanan Container              | Total Container     | Total Qty         | Total Nilai Beli (Cost)  | Persentase Status     |
+------------------------------------------+---------------------+-------------------+--------------------------+-----------------------+
| Barang Sudah Tiba di Bintara             | ${reportData.totalTibaBintara.toString().padEnd(12)} unit | ${formatQty(reportData.tibaQty).padEnd(17)} | ${formatRp(reportData.tibaCost).padEnd(24)} | ${(reportData.totalAll > 0 ? ((reportData.totalTibaBintara / reportData.totalAll) * 100).toFixed(1) : '0.0').padEnd(14)} % |
| Container Masih OTW                      | ${reportData.totalMasihOTW.toString().padEnd(12)} unit | ${formatQty(reportData.otwQty).padEnd(17)} | ${formatRp(reportData.otwCost).padEnd(24)} | ${(reportData.totalAll > 0 ? ((reportData.totalMasihOTW / reportData.totalAll) * 100).toFixed(1) : '0.0').padEnd(14)} % |
| Container Belum OTW                      | ${reportData.totalBelumOTW.toString().padEnd(12)} unit | ${formatQty(reportData.belumQty).padEnd(17)} | ${formatRp(reportData.belumCost).padEnd(24)} | ${(reportData.totalAll > 0 ? ((reportData.totalBelumOTW / reportData.totalAll) * 100).toFixed(1) : '0.0').padEnd(14)} % |
+------------------------------------------+---------------------+-------------------+--------------------------+-----------------------+
| TOTAL KESELURUHAN CONTAINER              | ${reportData.totalAll.toString().padEnd(12)} unit | ${formatQty(reportData.totalQtyAll).padEnd(17)} | ${formatRp(reportData.totalCostAll).padEnd(24)} | 100.0          % |
+------------------------------------------+---------------------+-------------------+--------------------------+-----------------------+

==============================================================================================================================================
2. TABEL PERINCIAN STATUS CONTAINER PER KATEGORI (IMPORT vs LOKAL)
==============================================================================================================================================
+----+---------------------------------------------------+-------------------+-------------------+--------------------------+
| No | Kategori / Status Perjalanan                      | Total Container   | Total Qty         | Total Nilai Beli (Cost)  |
+----+---------------------------------------------------+-------------------+-------------------+--------------------------+
${reportData.categoryList.length === 0 ? '| -  | Tidak ada data                                    | 0 Container       | 0                 | Rp 0                     |' : reportData.categoryList.map((cat, i) => 
  `| ${(i + 1).toString().padEnd(2)} | ${cat.categoryName.padEnd(25)} (TOTAL KATEGORI)   | ${cat.total.toString().padEnd(10)} Container | ${formatQty(cat.totalQty).padEnd(17)} | ${formatRp(cat.totalCost).padEnd(24)} |
|    |   ├─ Barang Sudah Tiba di Bintara                 | ${cat.tibaBintara.toString().padEnd(10)} Container | ${formatQty(cat.tibaQty).padEnd(17)} | ${formatRp(cat.tibaCost).padEnd(24)} |
|    |   ├─ Container Masih OTW                          | ${cat.masihOTW.toString().padEnd(10)} Container | ${formatQty(cat.otwQty).padEnd(17)} | ${formatRp(cat.otwCost).padEnd(24)} |
|    |   └─ Container Belum OTW                          | ${cat.belumOTW.toString().padEnd(10)} Container | ${formatQty(cat.belumQty).padEnd(17)} | ${formatRp(cat.belumCost).padEnd(24)} |`
).join('\n+----+---------------------------------------------------+-------------------+-------------------+--------------------------+\n')}
+----+---------------------------------------------------+-------------------+-------------------+--------------------------+
| TOTAL KATEGORI                                         | ${reportData.totalAll.toString().padEnd(10)} Container | ${formatQty(reportData.totalQtyAll).padEnd(17)} | ${formatRp(reportData.totalCostAll).padEnd(24)} |
+----+---------------------------------------------------+-------------------+-------------------+--------------------------+

==============================================================================================================================================
3. TABEL PERINCIAN CONTAINER PER PERIODE BULAN TIBA
==============================================================================================================================================
+----+---------------------------------------------------+-------------------+-------------------+--------------------------+
| No | Periode Bulan / Status Perjalanan                 | Total Container   | Total Qty         | Total Nilai Beli (Cost)  |
+----+---------------------------------------------------+-------------------+-------------------+--------------------------+
${reportData.monthlyList.length === 0 ? '| -  | Tidak ada data bulan                              | 0 Container       | 0                 | Rp 0                     |' : reportData.monthlyList.map((m, i) => 
  `| ${(i + 1).toString().padEnd(2)} | ${reportData.formatMonthLabel(m.monthKey).padEnd(25)} (TOTAL BULAN)      | ${m.total.toString().padEnd(10)} Container | ${formatQty(m.totalQty).padEnd(17)} | ${formatRp(m.totalCost).padEnd(24)} |
|    |   ├─ Barang Sudah Tiba di Bintara                 | ${m.tibaBintara.toString().padEnd(10)} Container | ${formatQty(m.tibaQty).padEnd(17)} | ${formatRp(m.tibaCost).padEnd(24)} |
|    |   ├─ Container Masih OTW                          | ${m.masihOTW.toString().padEnd(10)} Container | ${formatQty(m.otwQty).padEnd(17)} | ${formatRp(m.otwCost).padEnd(24)} |
|    |   └─ Container Belum OTW                          | ${m.belumOTW.toString().padEnd(10)} Container | ${formatQty(m.belumQty).padEnd(17)} | ${formatRp(m.belumCost).padEnd(24)} |`
).join('\n+----+---------------------------------------------------+-------------------+-------------------+--------------------------+\n')}
+----+---------------------------------------------------+-------------------+-------------------+--------------------------+
| TOTAL REKAPAN PERIODE                                  | ${reportData.totalAll.toString().padEnd(10)} Container | ${formatQty(reportData.totalQtyAll).padEnd(17)} | ${formatRp(reportData.totalCostAll).padEnd(24)} |
+----+---------------------------------------------------+-------------------+-------------------+--------------------------+

==============================================================================================================================================
4. DAFTAR CONTAINER DALAM PERJALANAN / PENDING (MASIH OTW & BELUM OTW) - DISORT BERDASARKAN STATUS PERJALANAN
==============================================================================================================================================
+----+-------------------+-----------+-----------------+-----------------+-----------------------+-----------------------------+-------------------+--------------------------+-----------------+
| No | No Container      | Category  | Tiba Priuk      | Tiba Bintara    | Item Category Barang  | Status Container            | Total Qty         | Nilai Beli (Cost)        | Keterangan      |
+----+-------------------+-----------+-----------------+-----------------+-----------------------+-----------------------------+-------------------+--------------------------+-----------------+
${reportData.pendingContainers.length === 0 ? '| -  | Semua Container Telah Sampai di Bintara (Tidak ada container pending)                                                                                                    |' : reportData.pendingContainers.map((c, i) => 
  `| ${(i + 1).toString().padEnd(2)} | ${(c.noContainer || '-').padEnd(17)} | ${(c.category || '-').padEnd(9)} | ${(c.tglTibaPriuk || '-').padEnd(15)} | ${(c.tglTibaBintara || '-').padEnd(15)} | ${(c.itemCategoryBarang || 'Umum').slice(0, 21).padEnd(21)} | ${(c.statusContainer).padEnd(27)} | ${formatQty(Number(c.totalQty) || 0).padEnd(17)} | ${formatRp(Number(c.totalCost) || 0).padEnd(24)} | ${(c.remark || '-').slice(0, 15).padEnd(15)} |`
).join('\n')}
+----+-------------------+-----------+-----------------+-----------------+-----------------------+-----------------------------+-------------------+--------------------------+-----------------+
| TOTAL PENDING CONTAINER (${reportData.pendingContainers.length.toString().padEnd(4)} unit)                                                             | ${formatQty(reportData.totalPendingQty).padEnd(17)} | ${formatRp(reportData.totalPendingCost).padEnd(24)} |                 |
+----+-------------------+-----------+-----------------+-----------------+-----------------------+-----------------------------+-------------------+--------------------------+-----------------+

==============================================================================================================================================
5. DAFTAR SELURUH DATA CONTAINER (LENGKAP SESUAI TAMPILAN WEB)
==============================================================================================================================================
+----+-------------------+-----------+-----------------+-----------------+-----------------------+-----------------------------+-------------------+--------------------------+-----------------+
| No | No Container      | Category  | Tiba Priuk      | Tiba Bintara    | Item Category Barang  | Status Container            | Total Qty         | Nilai Beli (Cost)        | Keterangan      |
+----+-------------------+-----------+-----------------+-----------------+-----------------------+-----------------------------+-------------------+--------------------------+-----------------+
${reportData.targetContainers.length === 0 ? '| -  | Tidak ada data container ditemukan                                                                                                                      |' : reportData.targetContainers.map((c, i) => 
  `| ${(i + 1).toString().padEnd(2)} | ${(c.noContainer || '-').padEnd(17)} | ${(c.category || '-').padEnd(9)} | ${(c.tglTibaPriuk || '-').padEnd(15)} | ${(c.tglTibaBintara || '-').padEnd(15)} | ${(c.itemCategoryBarang || 'Umum').slice(0, 21).padEnd(21)} | ${(c.statusContainer).padEnd(27)} | ${formatQty(Number(c.totalQty) || 0).padEnd(17)} | ${formatRp(Number(c.totalCost) || 0).padEnd(24)} | ${(c.remark || '-').slice(0, 15).padEnd(15)} |`
).join('\n')}
+----+-------------------+-----------+-----------------+-----------------+-----------------------+-----------------------------+-------------------+--------------------------+-----------------+
| TOTAL SELURUH CONTAINER (${reportData.targetContainers.length.toString().padEnd(4)} unit)                                                           | ${formatQty(reportData.totalQtyAll).padEnd(17)} | ${formatRp(reportData.totalCostAll).padEnd(24)} |                 |
+----+-------------------+-----------+-----------------+-----------------+-----------------------+-----------------------------+-------------------+--------------------------+-----------------+

Demikian laporan rekapan status perjalanan container ini kami sampaikan. Mohon koordinasi lanjutan untuk pemantauan penerimaan barang di Bintara.

Laporan ini dihasilkan secara otomatis oleh Sistem Aplikasi Inventory Gudang.
Terima Kasih.`;

  // HTML table rendering helpers for clipboard email export
  const renderStatusBadgeHtml = (status: string) => {
    if (status === 'Barang Sudah Tiba di Bintara') {
      return `<span style="background-color: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; padding: 3px 8px; border-radius: 12px; font-weight: bold; font-size: 10px; display: inline-block; white-space: nowrap;">✓ Barang Sudah Tiba di Bintara</span>`;
    } else if (status === 'Container Masih OTW') {
      return `<span style="background-color: #fffbeb; color: #b45309; border: 1px solid #fde68a; padding: 3px 8px; border-radius: 12px; font-weight: bold; font-size: 10px; display: inline-block; white-space: nowrap;">⏳ Container Masih OTW</span>`;
    } else {
      return `<span style="background-color: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; padding: 3px 8px; border-radius: 12px; font-weight: bold; font-size: 10px; display: inline-block; white-space: nowrap;">❓ Container Belum OTW</span>`;
    }
  };

  const renderCategoryBadgeHtml = (cat?: string) => {
    const name = (cat || '-').trim().toUpperCase();
    return `<span style="background-color: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: bold; text-transform: uppercase; display: inline-block; white-space: nowrap;">${name}</span>`;
  };

  const renderTglBintaraHtml = (tgl?: string) => {
    if (tgl) {
      return `<span style="color: #047857; font-weight: 600; font-family: monospace;">${tgl}</span>`;
    }
    return `<span style="color: #94a3b8; font-style: italic;">- Belum -</span>`;
  };

  const renderRemarkHtml = (remark?: string) => {
    if (remark && remark.trim()) {
      return `<span style="background-color: #f8fafc; border: 1px solid #cbd5e1; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 10px; color: #334155; display: inline-block; max-width: 180px; word-break: break-word;">${remark.trim()}</span>`;
    }
    return `<span style="color: #cbd5e1; font-style: italic;">-</span>`;
  };

  const renderContainerTableHtml = (list: ContainerRecord[], emptyText: string) => {
    if (list.length === 0) {
      return `
      <table width="100%" border="1" cellpadding="6" cellspacing="0" style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; border: 1px solid #cbd5e1;">
        <thead>
          <tr style="background-color: #f1f5f9; color: #0f172a; text-align: left; font-size: 11px; font-weight: bold;">
            <th style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: center; width: 35px;">No</th>
            <th style="padding: 8px 6px; border: 1px solid #cbd5e1;">No Container</th>
            <th style="padding: 8px 6px; border: 1px solid #cbd5e1;">Category</th>
            <th style="padding: 8px 6px; border: 1px solid #cbd5e1;">Tgl Tiba Priuk</th>
            <th style="padding: 8px 6px; border: 1px solid #cbd5e1;">Tgl Tiba Bintara</th>
            <th style="padding: 8px 6px; border: 1px solid #cbd5e1;">Item Category Barang</th>
            <th style="padding: 8px 6px; border: 1px solid #cbd5e1;">Status Container</th>
            <th style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: right;">Total Qty</th>
            <th style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: right;">Total Cost</th>
            <th style="padding: 8px 6px; border: 1px solid #cbd5e1;">Keterangan / Remark</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colspan="10" style="padding: 12px; text-align: center; color: #047857; font-weight: bold;">
              ${emptyText}
            </td>
          </tr>
        </tbody>
      </table>`;
    }

    let totQty = 0;
    let totCost = 0;

    const rowsHtml = list.map((c, i) => {
      const q = Number(c.totalQty) || 0;
      const cost = Number(c.totalCost) || 0;

      totQty += q;
      totCost += cost;

      return `
      <tr style="background-color: ${i % 2 === 0 ? '#ffffff' : '#f8fafc'};">
        <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: center; font-size: 11px; font-family: monospace; color: #64748b;">${i + 1}</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1; font-family: monospace; font-weight: bold; color: #0369a1; font-size: 11px;">${c.noContainer}</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1; font-size: 11px;">${renderCategoryBadgeHtml(c.category)}</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1; font-family: monospace; font-size: 11px; color: #475569;">${c.tglTibaPriuk || '-'}</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1; font-size: 11px;">${renderTglBintaraHtml(c.tglTibaBintara)}</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1; font-size: 11px; color: #334155; font-weight: 500;">${c.itemCategoryBarang || '-'}</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1; font-size: 11px;">${renderStatusBadgeHtml(c.statusContainer)}</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace; font-weight: bold; font-size: 11px; color: #0f172a;">${formatQty(q)}</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace; font-weight: 600; font-size: 11px; color: #1d4ed8;">${formatRp(cost)}</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1; font-size: 11px;">${renderRemarkHtml(c.remark)}</td>
      </tr>`;
    }).join('');

    return `
    <table width="100%" border="1" cellpadding="6" cellspacing="0" style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; border: 1px solid #cbd5e1;">
      <thead>
        <tr style="background-color: #f1f5f9; color: #0f172a; text-align: left; font-size: 11px; font-weight: bold;">
          <th style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: center; width: 35px;">No</th>
          <th style="padding: 8px 6px; border: 1px solid #cbd5e1;">No Container</th>
          <th style="padding: 8px 6px; border: 1px solid #cbd5e1;">Category</th>
          <th style="padding: 8px 6px; border: 1px solid #cbd5e1;">Tgl Tiba Priuk</th>
          <th style="padding: 8px 6px; border: 1px solid #cbd5e1;">Tgl Tiba Bintara</th>
          <th style="padding: 8px 6px; border: 1px solid #cbd5e1;">Item Category Barang</th>
          <th style="padding: 8px 6px; border: 1px solid #cbd5e1;">Status Container</th>
          <th style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: right;">Total Qty</th>
          <th style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: right;">Total Cost</th>
          <th style="padding: 8px 6px; border: 1px solid #cbd5e1;">Keterangan / Remark</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
      <tfoot>
        <tr style="background-color: #f1f5f9; font-weight: bold; color: #0f172a; font-size: 11px;">
          <td colspan="7" style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: right;">TOTAL (${list.length} Container):</td>
          <td style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace; color: #0f172a;">${formatQty(totQty)}</td>
          <td style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace; color: #1d4ed8;">${formatRp(totCost)}</td>
          <td style="padding: 8px 6px; border: 1px solid #cbd5e1;"></td>
        </tr>
      </tfoot>
    </table>`;
  };

  const renderContainerJsxTable = (list: ContainerRecord[], emptyText: string) => {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left border border-slate-200 rounded-lg text-[11px]">
          <thead>
            <tr className="bg-slate-100 text-slate-900 font-bold">
              <th className="p-2 text-center border-b border-slate-200 w-10">No</th>
              <th className="p-2 border-b border-slate-200">No Container</th>
              <th className="p-2 border-b border-slate-200">Category</th>
              <th className="p-2 border-b border-slate-200">Tgl Tiba Priuk</th>
              <th className="p-2 border-b border-slate-200">Tgl Tiba Bintara</th>
              <th className="p-2 border-b border-slate-200">Item Category Barang</th>
              <th className="p-2 border-b border-slate-200">Status Container</th>
              <th className="p-2 text-right border-b border-slate-200">Total Qty</th>
              <th className="p-2 text-right border-b border-slate-200">Total Cost</th>
              <th className="p-2 border-b border-slate-200">Keterangan / Remark</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-4 text-center text-slate-500 font-bold">
                  {emptyText}
                </td>
              </tr>
            ) : (
              list.map((c, i) => {
                let badgeStyle = 'bg-slate-100 text-slate-700 border-slate-200';
                let icon = <HelpCircle className="w-3 h-3 text-slate-400" />;

                if (c.statusContainer === 'Barang Sudah Tiba di Bintara') {
                  badgeStyle = 'bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold';
                  icon = <CheckCircle2 className="w-3 h-3 text-emerald-600" />;
                } else if (c.statusContainer === 'Container Masih OTW') {
                  badgeStyle = 'bg-amber-50 text-amber-700 border-amber-200 font-semibold';
                  icon = <Clock className="w-3 h-3 text-amber-600" />;
                }

                return (
                  <tr key={c.id || c.noContainer + i} className="hover:bg-slate-50 transition">
                    <td className="p-2 text-center font-mono font-bold text-slate-400">{i + 1}</td>
                    <td className="p-2 font-mono font-bold text-sky-700">{c.noContainer}</td>
                    <td className="p-2">
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-semibold uppercase">
                        {c.category || '-'}
                      </span>
                    </td>
                    <td className="p-2 font-mono text-slate-600">{c.tglTibaPriuk || '-'}</td>
                    <td className="p-2 font-mono">
                      {c.tglTibaBintara ? (
                        <span className="text-emerald-700 font-semibold">{c.tglTibaBintara}</span>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">- Belum -</span>
                      )}
                    </td>
                    <td className="p-2 text-slate-800 font-medium">{c.itemCategoryBarang || '-'}</td>
                    <td className="p-2">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] border ${badgeStyle}`}>
                        {icon}
                        <span>{c.statusContainer}</span>
                      </span>
                    </td>
                    <td className="p-2 text-right font-mono font-bold text-slate-900">
                      {formatQty(Number(c.totalQty) || 0)}
                    </td>
                    <td className="p-2 text-right font-mono font-semibold text-blue-700">
                      {formatRp(Number(c.totalCost) || 0)}
                    </td>
                    <td className="p-2">
                      {c.remark ? (
                        <span className="bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded font-mono text-[10px] text-slate-700 break-words whitespace-pre-wrap">
                          {c.remark}
                        </span>
                      ) : (
                        <span className="text-slate-300 italic">-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {list.length > 0 && (
            <tfoot>
              <tr className="bg-slate-100 font-bold text-slate-900 border-t-2 border-slate-300">
                <td colSpan={7} className="p-2 text-right uppercase text-[10px]">
                  TOTAL ({list.length} Unit):
                </td>
                <td className="p-2 text-right font-mono text-slate-900">
                  {formatQty(list.reduce((acc, c) => acc + (Number(c.totalQty) || 0), 0))}
                </td>
                <td className="p-2 text-right font-mono text-blue-700">
                  {formatRp(list.reduce((acc, c) => acc + (Number(c.totalCost) || 0), 0))}
                </td>
                <td className="p-2"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    );
  };

  // HTML Raw table format for clipboard copy to Gmail/Outlook
  const generateRichHtmlEmail = () => {
    return `
<div style="font-family: Arial, sans-serif; font-size: 13px; color: #1e293b; max-width: 1100px; margin: 0 auto; line-height: 1.5;">
  
  <div style="background-color: #0f172a; color: #ffffff; padding: 16px 20px; border-radius: 8px; margin-bottom: 20px;">
    <div style="font-size: 10px; font-weight: bold; color: #38bdf8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">
      OFFICIAL CONTAINER TRACKING REPORT
    </div>
    <h2 style="margin: 0 0 6px 0; font-size: 18px; color: #ffffff;">LAPORAN REKAPAN STATUS PERJALANAN CONTAINER</h2>
    <div style="font-size: 11px; color: #cbd5e1;">${reportDate} &bull; Periode: ${reportData.periodName}</div>
  </div>

  <!-- Summary Cards -->
  <table width="100%" border="0" cellpadding="0" cellspacing="10" style="width: 100%; border-collapse: separate; border-spacing: 10px; margin-bottom: 20px;">
    <tr>
      <td style="width: 33.3%; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center;">
        <div style="font-size: 11px; color: #64748b; font-weight: bold;">TOTAL CONTAINER</div>
        <div style="font-size: 18px; font-weight: bold; color: #0f172a; margin-top: 4px;">${reportData.totalAll} Container</div>
      </td>
      <td style="width: 33.3%; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px; text-align: center;">
        <div style="font-size: 11px; color: #166534; font-weight: bold;">TOTAL QTY BARANG</div>
        <div style="font-size: 18px; font-weight: bold; color: #15803d; margin-top: 4px;">${formatQty(reportData.totalQtyAll)} Pcs</div>
      </td>
      <td style="width: 33.3%; background-color: #fefce8; border: 1px solid #fef08a; border-radius: 8px; padding: 12px; text-align: center;">
        <div style="font-size: 11px; color: #854d0e; font-weight: bold;">TOTAL NILAI BELI (COST)</div>
        <div style="font-size: 16px; font-weight: bold; color: #a16207; margin-top: 4px;">${formatRp(reportData.totalCostAll)}</div>
      </td>
    </tr>
  </table>

  <p style="margin-bottom: 16px;">Yth. Bapak/Ibu Manajemen & Team Logistik,</p>
  <p style="margin-bottom: 20px;">Berikut disampaikan rincian lengkap laporan rekapan status perjalanan container (impor & lokal) beserta Total Qty dan Total Nilai Beli:</p>

  <!-- Point 1 -->
  <h3 style="font-size: 14px; color: #0f172a; border-bottom: 2px solid #0284c7; padding-bottom: 6px; margin-top: 24px; margin-bottom: 10px;">
    1. RINGKASAN UTAMA STATUS CONTAINER (${reportData.periodName.toUpperCase()})
  </h3>
  <table width="100%" border="1" cellpadding="6" cellspacing="0" style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; border: 1px solid #cbd5e1;">
    <thead>
      <tr style="background-color: #e0f2fe; color: #0369a1; text-align: left;">
        <th style="padding: 8px; border: 1px solid #cbd5e1;">Status Perjalanan Container</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: center;">Total Container</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Total Qty</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Total Nilai Beli (Cost)</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Persentase (%)</th>
      </tr>
    </thead>
    <tbody>
      <tr style="background-color: #ffffff;">
        <td style="padding: 8px; border: 1px solid #cbd5e1; font-weight: bold; color: #047857;">Barang Sudah Tiba di Bintara</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; color: #047857;">${reportData.totalTibaBintara} Container</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #047857;">${formatQty(reportData.tibaQty)}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #047857;">${formatRp(reportData.tibaCost)}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #047857;">
          ${reportData.totalAll > 0 ? ((reportData.totalTibaBintara / reportData.totalAll) * 100).toFixed(1) : '0.0'}%
        </td>
      </tr>
      <tr style="background-color: #f8fafc;">
        <td style="padding: 8px; border: 1px solid #cbd5e1; font-weight: bold; color: #b45309;">Container Masih OTW</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; color: #b45309;">${reportData.totalMasihOTW} Container</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #b45309;">${formatQty(reportData.otwQty)}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #b45309;">${formatRp(reportData.otwCost)}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #b45309;">
          ${reportData.totalAll > 0 ? ((reportData.totalMasihOTW / reportData.totalAll) * 100).toFixed(1) : '0.0'}%
        </td>
      </tr>
      <tr style="background-color: #ffffff;">
        <td style="padding: 8px; border: 1px solid #cbd5e1; font-weight: bold; color: #475569;">Container Belum OTW</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; color: #475569;">${reportData.totalBelumOTW} Container</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #475569;">${formatQty(reportData.belumQty)}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #475569;">${formatRp(reportData.belumCost)}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #475569;">
          ${reportData.totalAll > 0 ? ((reportData.totalBelumOTW / reportData.totalAll) * 100).toFixed(1) : '0.0'}%
        </td>
      </tr>
    </tbody>
    <tfoot>
      <tr style="background-color: #0f172a; color: #ffffff; font-weight: bold;">
        <td style="padding: 8px; border: 1px solid #cbd5e1;">TOTAL KESELURUHAN CONTAINER:</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; color: #38bdf8;">${reportData.totalAll} Container</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; color: #38bdf8;">${formatQty(reportData.totalQtyAll)}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; color: #38bdf8;">${formatRp(reportData.totalCostAll)}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; color: #38bdf8;">100.0%</td>
      </tr>
    </tfoot>
  </table>

  <!-- Point 2 -->
  <h3 style="font-size: 14px; color: #0f172a; border-bottom: 2px solid #d97706; padding-bottom: 6px; margin-top: 24px; margin-bottom: 10px;">
    2. PERINCIAN STATUS CONTAINER PER KATEGORI (IMPORT vs LOKAL)
  </h3>
  <table width="100%" border="1" cellpadding="6" cellspacing="0" style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; border: 1px solid #cbd5e1;">
    <thead>
      <tr style="background-color: #fef3c7; color: #78350f; text-align: left; font-weight: bold;">
        <th style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: center; width: 35px;">No</th>
        <th style="padding: 8px 6px; border: 1px solid #cbd5e1;">Kategori / Status Perjalanan</th>
        <th style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: center;">Total Container</th>
        <th style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: right;">Total Qty</th>
        <th style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: right;">Total Nilai Beli (Cost)</th>
      </tr>
    </thead>
    <tbody>
      ${reportData.categoryList.length === 0 ? `
      <tr>
        <td colspan="5" style="padding: 12px; text-align: center; color: #64748b;">Tidak ada data container</td>
      </tr>
      ` : reportData.categoryList.map((cat, i) => `
      <!-- Total Kategori Row -->
      <tr style="background-color: #fef3c7; font-weight: bold; color: #78350f;">
        <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: center; font-family: monospace;">${i + 1}</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1;">${cat.categoryName} (TOTAL KATEGORI)</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: center; font-family: monospace;">${cat.total} Container</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace;">${formatQty(cat.totalQty)}</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace; color: #92400e;">${formatRp(cat.totalCost)}</td>
      </tr>
      <!-- Sub-row 1: Sudah Tiba Bintara -->
      <tr style="background-color: #ecfdf5; color: #065f46;">
        <td style="padding: 5px; border: 1px solid #cbd5e1;"></td>
        <td style="padding: 5px 6px 5px 20px; border: 1px solid #cbd5e1; font-weight: 600;">├─ Barang Sudah Tiba di Bintara</td>
        <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: center; font-family: monospace;">${cat.tibaBintara} Container</td>
        <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace;">${formatQty(cat.tibaQty)}</td>
        <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace;">${formatRp(cat.tibaCost)}</td>
      </tr>
      <!-- Sub-row 2: Container Masih OTW -->
      <tr style="background-color: #fffbeb; color: #92400e;">
        <td style="padding: 5px; border: 1px solid #cbd5e1;"></td>
        <td style="padding: 5px 6px 5px 20px; border: 1px solid #cbd5e1; font-weight: 600;">├─ Container Masih OTW</td>
        <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: center; font-family: monospace;">${cat.masihOTW} Container</td>
        <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace;">${formatQty(cat.otwQty)}</td>
        <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace;">${formatRp(cat.otwCost)}</td>
      </tr>
      <!-- Sub-row 3: Container Belum OTW -->
      <tr style="background-color: #f8fafc; color: #334155;">
        <td style="padding: 5px; border: 1px solid #cbd5e1;"></td>
        <td style="padding: 5px 6px 5px 20px; border: 1px solid #cbd5e1; font-weight: 600;">└─ Container Belum OTW</td>
        <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: center; font-family: monospace;">${cat.belumOTW} Container</td>
        <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace;">${formatQty(cat.belumQty)}</td>
        <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace;">${formatRp(cat.belumCost)}</td>
      </tr>
      `).join('')}
    </tbody>
    <tfoot>
      <tr style="background-color: #fef3c7; font-weight: bold; color: #78350f;">
        <td colspan="2" style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: right; text-transform: uppercase;">TOTAL KATEGORI:</td>
        <td style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: center; font-family: monospace;">${reportData.totalAll} Container</td>
        <td style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace;">${formatQty(reportData.totalQtyAll)}</td>
        <td style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace; color: #92400e;">${formatRp(reportData.totalCostAll)}</td>
      </tr>
    </tfoot>
  </table>

  <!-- Point 3 -->
  <h3 style="font-size: 14px; color: #0f172a; border-bottom: 2px solid #4f46e5; padding-bottom: 6px; margin-top: 24px; margin-bottom: 10px;">
    3. PERINCIAN CONTAINER PER PERIODE BULAN TIBA
  </h3>
  <table width="100%" border="1" cellpadding="6" cellspacing="0" style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; border: 1px solid #cbd5e1;">
    <thead>
      <tr style="background-color: #e0e7ff; color: #3730a3; text-align: left; font-weight: bold;">
        <th style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: center; width: 35px;">No</th>
        <th style="padding: 8px 6px; border: 1px solid #cbd5e1;">Periode Bulan / Status Perjalanan</th>
        <th style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: center;">Total Container</th>
        <th style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: right;">Total Qty</th>
        <th style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: right;">Total Nilai Beli (Cost)</th>
      </tr>
    </thead>
    <tbody>
      ${reportData.monthlyList.length === 0 ? `
      <tr>
        <td colspan="5" style="padding: 12px; text-align: center; color: #64748b;">Tidak ada data periode bulan</td>
      </tr>
      ` : reportData.monthlyList.map((m, i) => `
      <!-- Total Bulan Row -->
      <tr style="background-color: #e0e7ff; font-weight: bold; color: #3730a3;">
        <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: center; font-family: monospace;">${i + 1}</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1;">${reportData.formatMonthLabel(m.monthKey)} (TOTAL BULAN)</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: center; font-family: monospace;">${m.total} Container</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace;">${formatQty(m.totalQty)}</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace; color: #92400e;">${formatRp(m.totalCost)}</td>
      </tr>
      <!-- Sub-row 1: Barang Sudah Tiba di Bintara -->
      <tr style="background-color: #ecfdf5; color: #065f46;">
        <td style="padding: 5px; border: 1px solid #cbd5e1;"></td>
        <td style="padding: 5px 6px 5px 20px; border: 1px solid #cbd5e1; font-weight: 600;">├─ Barang Sudah Tiba di Bintara</td>
        <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: center; font-family: monospace;">${m.tibaBintara} Container</td>
        <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace;">${formatQty(m.tibaQty)}</td>
        <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace;">${formatRp(m.tibaCost)}</td>
      </tr>
      <!-- Sub-row 2: Container Masih OTW -->
      <tr style="background-color: #fffbeb; color: #92400e;">
        <td style="padding: 5px; border: 1px solid #cbd5e1;"></td>
        <td style="padding: 5px 6px 5px 20px; border: 1px solid #cbd5e1; font-weight: 600;">├─ Container Masih OTW</td>
        <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: center; font-family: monospace;">${m.masihOTW} Container</td>
        <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace;">${formatQty(m.otwQty)}</td>
        <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace;">${formatRp(m.otwCost)}</td>
      </tr>
      <!-- Sub-row 3: Container Belum OTW -->
      <tr style="background-color: #f8fafc; color: #334155;">
        <td style="padding: 5px; border: 1px solid #cbd5e1;"></td>
        <td style="padding: 5px 6px 5px 20px; border: 1px solid #cbd5e1; font-weight: 600;">└─ Container Belum OTW</td>
        <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: center; font-family: monospace;">${m.belumOTW} Container</td>
        <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace;">${formatQty(m.belumQty)}</td>
        <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace;">${formatRp(m.belumCost)}</td>
      </tr>
      `).join('')}
    </tbody>
    <tfoot>
      <tr style="background-color: #e0e7ff; font-weight: bold; color: #3730a3;">
        <td colspan="2" style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: right; text-transform: uppercase;">TOTAL REKAPAN PERIODE:</td>
        <td style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: center; font-family: monospace;">${reportData.totalAll} Container</td>
        <td style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace;">${formatQty(reportData.totalQtyAll)}</td>
        <td style="padding: 8px 6px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace; color: #92400e;">${formatRp(reportData.totalCostAll)}</td>
      </tr>
    </tfoot>
  </table>

  <!-- Point 4 -->
  <h3 style="font-size: 14px; color: #0f172a; border-bottom: 2px solid #0284c7; padding-bottom: 6px; margin-top: 24px; margin-bottom: 10px;">
    4. DAFTAR CONTAINER DALAM PERJALANAN / PENDING (MASIH OTW & BELUM OTW)
  </h3>
  ${renderContainerTableHtml(reportData.pendingContainers, "Semua Container Telah Sampai di Bintara (Tidak ada container pending/OTW)")}

  <!-- Point 5 -->
  <h3 style="font-size: 14px; color: #0f172a; border-bottom: 2px solid #0284c7; padding-bottom: 6px; margin-top: 24px; margin-bottom: 10px;">
    5. DAFTAR SELURUH DATA CONTAINER (LENGKAP SESUAI TAMPILAN WEB)
  </h3>
  ${renderContainerTableHtml(reportData.targetContainers, "Tidak ada data container ditemukan")}

  <div style="margin-top: 24px; padding-top: 12px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #64748b;">
    Laporan ini di-generate secara otomatis oleh Sistem Aplikasi Inventory Gudang.
  </div>
</div>
    `;
  };

  // Helper for copying HTML with multiple fallback mechanisms
  const copyHtmlWithFallback = async (htmlContent: string, plainTextFallback: string) => {
    const fullHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  table { border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; font-size: 12px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; }
</style>
</head>
<body style="font-family: Arial, sans-serif; font-size: 13px; color: #1e293b;">
${htmlContent}
</body>
</html>`;

    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const blobHtml = new Blob([fullHtml], { type: 'text/html' });
        const blobText = new Blob([plainTextFallback], { type: 'text/plain' });
        const item = new ClipboardItem({
          'text/html': blobHtml,
          'text/plain': blobText,
        });
        await navigator.clipboard.write([item]);
        return true;
      }
    } catch (err) {
      console.warn('Clipboard API write failed, trying DOM selection fallback', err);
    }

    try {
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.left = '-9999px';
      container.style.top = '0';
      container.style.opacity = '0';
      container.innerHTML = fullHtml;
      document.body.appendChild(container);

      const range = document.createRange();
      range.selectNodeContents(container);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
        const ok = document.execCommand('copy');
        selection.removeAllRanges();
        document.body.removeChild(container);
        if (ok) return true;
      }
      if (container.parentNode) {
        document.body.removeChild(container);
      }
    } catch (e) {
      console.error('DOM selection fallback failed', e);
    }

    await navigator.clipboard.writeText(plainTextFallback);
    return true;
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(plainTextEmail);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  const handleCopyHtml = async () => {
    const htmlStr = generateRichHtmlEmail();
    await copyHtmlWithFallback(htmlStr, plainTextEmail);
    setCopiedHtml(true);
    setTimeout(() => setCopiedHtml(false), 2000);
  };

  const handleCopySubject = () => {
    navigator.clipboard.writeText(emailSubject);
    setCopiedSubject(true);
    setTimeout(() => setCopiedSubject(false), 2000);
  };

  const handleOpenMailClient = () => {
    const bodyEncoded = encodeURIComponent(plainTextEmail);
    const subjectEncoded = encodeURIComponent(emailSubject);
    const mailtoUrl = `mailto:${recipientEmail}?subject=${subjectEncoded}&body=${bodyEncoded}`;
    window.open(mailtoUrl, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 overflow-y-auto">
      <div className="bg-white w-full max-w-5xl rounded-xl shadow-2xl border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[92vh]">
        
        {/* Modal Header */}
        <div className="bg-slate-900 text-white p-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-sky-500/20 text-sky-400 border border-sky-500/30 rounded-lg">
              <Ship className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Report Email Status Container (Tabel Rapi)</h2>
              <p className="text-xs text-slate-400 font-mono">
                Generator Laporan Email Resmi (Ringkasan Status, Kategori Import/Lokal, Periode Bulan & Detail Pending)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Top Control Bar */}
        <div className="p-3.5 bg-slate-50 border-b border-slate-200 space-y-2.5 shrink-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
            {/* Subject Email */}
            <div className="md:col-span-3">
              <label className="block font-bold text-slate-700 mb-0.5">Subject Email:</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  readOnly
                  value={emailSubject}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded font-mono text-slate-800 text-[11px] font-semibold focus:outline-none"
                />
                <button
                  onClick={handleCopySubject}
                  className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded flex items-center gap-1 shrink-0 transition cursor-pointer"
                  title="Salin Subject"
                >
                  {copiedSubject ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSubject ? 'Tersalin' : 'Salin Subject'}</span>
                </button>
              </div>
            </div>

            {/* Filter Category Container (Multi-Select) */}
            <div className="relative md:col-span-2">
              <label className="block font-bold text-slate-700 mb-0.5 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Filter className="w-3.5 h-3.5 text-sky-600" />
                  <span>Filter Category Container ({selectedCategories.length}/{availableCategories.length} Dipilih):</span>
                </span>
                <span className="text-[10px] text-slate-500 font-normal">
                  (Bisa pilih beberapa category)
                </span>
              </label>

              <button
                type="button"
                onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-slate-800 text-[11px] font-semibold flex items-center justify-between focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer shadow-2xs"
              >
                <span className="truncate">
                  {selectedCategories.length === availableCategories.length
                    ? `Semua Category Container (${availableCategories.length})`
                    : selectedCategories.length === 0
                    ? '⚠️ Tidak ada category dipilih (0 item)'
                    : `${selectedCategories.length} Category Dipilih (${selectedCategories.join(', ')})`}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-500 shrink-0 ml-1 transition-transform ${isCategoryDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Multi-Select Category Dropdown Panel */}
              {isCategoryDropdownOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-20" 
                    onClick={() => setIsCategoryDropdownOpen(false)} 
                  />
                  <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-300 rounded-xl shadow-xl z-30 p-2.5 space-y-2 text-xs animate-in fade-in zoom-in-95 duration-100">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-1.5 text-[11px]">
                      <span className="font-bold text-slate-800">Pilih Category Container:</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSelectAllCategories}
                          className="text-sky-600 hover:text-sky-800 font-bold hover:underline cursor-pointer"
                        >
                          Pilih Semua
                        </button>
                        <span className="text-slate-300">|</span>
                        <button
                          type="button"
                          onClick={handleClearAllCategories}
                          className="text-red-600 hover:text-red-800 font-bold hover:underline cursor-pointer"
                        >
                          Hapus Semua
                        </button>
                      </div>
                    </div>

                    <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                      {availableCategories.length === 0 ? (
                        <p className="text-slate-400 text-center py-2 text-[11px]">Tidak ada data category</p>
                      ) : (
                        availableCategories.map(cat => {
                          const isChecked = selectedCategories.includes(cat);
                          const catCount = containers.filter(c => (c.category || 'LAINNYA').trim().toUpperCase() === cat).length;
                          return (
                            <label
                              key={cat}
                              className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition select-none text-[11px] ${
                                isChecked ? 'bg-sky-50 text-sky-900 font-bold' : 'hover:bg-slate-100 text-slate-600'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleCategory(cat)}
                                  className="rounded border-slate-300 text-sky-600 focus:ring-sky-500 w-3.5 h-3.5 cursor-pointer shrink-0"
                                />
                                <span className="truncate">{cat}</span>
                              </div>
                              <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-200/60 px-1.5 py-0.2 rounded-full shrink-0 ml-2">
                                {catCount} Container
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>

                    <div className="pt-1.5 border-t border-slate-200 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setIsCategoryDropdownOpen(false)}
                        className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg text-[11px] cursor-pointer"
                      >
                        Selesai
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Filter Periode Bulan */}
            <div>
              <label className="block font-bold text-slate-700 mb-0.5">Filter Periode Bulan:</label>
              <select
                value={emailMonthFilter}
                onChange={e => setEmailMonthFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-slate-800 text-[11px] font-semibold focus:outline-none focus:ring-1 focus:ring-sky-500 shadow-2xs cursor-pointer"
              >
                <option value="ALL">Semua Periode Terdata</option>
                {availableMonths.map(m => (
                  <option key={m} value={m}>{reportData.formatMonthLabel(m)} ({m})</option>
                ))}
              </select>
            </div>
          </div>

          {/* Active Category Badges/Pills */}
          {selectedCategories.length > 0 && selectedCategories.length < availableCategories.length && (
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] bg-sky-50/60 p-2 rounded-lg border border-sky-100">
              <span className="font-bold text-sky-800 flex items-center gap-1">
                <Filter className="w-3 h-3 text-sky-600" />
                Filter Category Aktif:
              </span>
              {selectedCategories.map(cat => (
                <span
                  key={cat}
                  className="px-2 py-0.5 bg-white text-sky-800 border border-sky-300 rounded-full font-bold flex items-center gap-1 shadow-2xs"
                >
                  <span>{cat}</span>
                  <button
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className="hover:text-red-600 cursor-pointer font-bold ml-0.5"
                    title={`Hapus filter ${cat}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={handleSelectAllCategories}
                className="text-sky-600 hover:underline font-bold text-[10px] ml-1 cursor-pointer"
              >
                Reset Semua Category
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-1 gap-2 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-0.5">Kirim Ke (Optional Email Tujuan):</label>
              <input
                type="email"
                placeholder="misal: logistik@perusahaan.com, manajer@perusahaan.com"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-slate-800 text-[11px] focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
          </div>

          {/* View Mode Toggle & Copy Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2">
            <div className="flex items-center gap-1 bg-slate-200/80 p-0.5 rounded-lg text-xs font-bold">
              <button
                onClick={() => setActiveTab('preview')}
                className={`px-3 py-1 rounded-md transition flex items-center gap-1.5 ${
                  activeTab === 'preview' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <TableIcon className="w-3.5 h-3.5 text-sky-600" />
                <span>Format Tabel Rapi (Tampilan Email)</span>
              </button>
              <button
                onClick={() => setActiveTab('text')}
                className={`px-3 py-1 rounded-md transition flex items-center gap-1.5 ${
                  activeTab === 'text' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="w-3.5 h-3.5 text-blue-600" />
                <span>Format Teks ASCII (Plain Text)</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleCopyHtml}
                className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs rounded-lg shadow-2xs flex items-center gap-1.5 transition"
                title="Salin tabel berwarna untuk langsung di-paste ke Gmail / Outlook composer"
              >
                {copiedHtml ? <Check className="w-4 h-4 text-emerald-200" /> : <Sparkles className="w-4 h-4 text-amber-300" />}
                <span>{copiedHtml ? 'Tabel HTML Tersalin!' : 'Salin Tabel HTML (Gmail/Outlook)'}</span>
              </button>

              <button
                onClick={handleCopyText}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-lg shadow-2xs flex items-center gap-1.5 transition"
              >
                {copiedText ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-sky-400" />}
                <span>{copiedText ? 'Teks Tersalin!' : 'Salin Teks (ASCII Table)'}</span>
              </button>

              <button
                onClick={handleOpenMailClient}
                className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs rounded-lg shadow-2xs flex items-center gap-1.5 transition"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Buka Client Email</span>
              </button>
            </div>
          </div>
        </div>

        {/* Modal Scrollable Content Body */}
        <div className="p-4 overflow-y-auto space-y-6 flex-1 text-slate-800">
          
          {activeTab === 'text' ? (
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-500 block uppercase">
                Preview Teks Email ASCII Table (Siap Disalin ke Email/WhatsApp):
              </span>
              <textarea
                readOnly
                value={plainTextEmail}
                rows={20}
                className="w-full p-3 bg-slate-900 text-sky-300 font-mono text-[11px] rounded-lg border border-slate-800 focus:outline-none leading-relaxed shadow-inner"
              />
            </div>
          ) : (
            <div className="bg-white border border-slate-300 rounded-xl p-5 shadow-sm space-y-6 text-xs">
              
              {/* Header Email Banner */}
              <div className="bg-slate-900 text-white p-4 rounded-lg border border-slate-800 space-y-1">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-mono text-sky-400 uppercase tracking-wider font-bold">
                    OFFICIAL CONTAINER TRACKING REPORT
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">{reportDate}</span>
                </div>
                <h1 className="text-base font-extrabold text-white">LAPORAN REKAPAN STATUS PERJALANAN CONTAINER</h1>
                <p className="text-[11px] text-slate-300">
                  Tracking Container Impor &amp; Lokal (Priuk ke Bintara) &bull; Periode: {reportData.periodName}
                </p>
              </div>

              {/* Point 1: Ringkasan Utama Table */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-1.5">
                  <span className="px-2 py-0.5 bg-sky-600 text-white font-mono font-bold rounded text-[10px]">1</span>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                    RINGKASAN UTAMA STATUS CONTAINER ({reportData.periodName.toUpperCase()})
                  </h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border border-slate-200 rounded-lg text-[11px]">
                    <thead>
                      <tr className="bg-sky-100/70 text-sky-950 font-bold">
                        <th className="p-2.5 border-b border-sky-200">Status Perjalanan Container</th>
                        <th className="p-2.5 text-center border-b border-sky-200">Total Container</th>
                        <th className="p-2.5 text-right border-b border-sky-200">Total Qty</th>
                        <th className="p-2.5 text-right border-b border-sky-200">Total Nilai Beli (Cost)</th>
                        <th className="p-2.5 text-right border-b border-sky-200">Persentase (%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="bg-white font-semibold">
                        <td className="p-2.5 border-b border-slate-200 text-emerald-800">
                          Barang Sudah Tiba di Bintara
                        </td>
                        <td className="p-2.5 text-center border-b border-slate-200 font-mono font-bold text-emerald-700">
                          {reportData.totalTibaBintara} Container
                        </td>
                        <td className="p-2.5 text-right border-b border-slate-200 font-mono font-bold text-emerald-700">
                          {formatQty(reportData.tibaQty)}
                        </td>
                        <td className="p-2.5 text-right border-b border-slate-200 font-mono font-bold text-amber-700">
                          {formatRp(reportData.tibaCost)}
                        </td>
                        <td className="p-2.5 text-right border-b border-slate-200 font-mono font-bold text-emerald-700">
                          {reportData.totalAll > 0 ? ((reportData.totalTibaBintara / reportData.totalAll) * 100).toFixed(1) : '0.0'} %
                        </td>
                      </tr>
                      <tr className="bg-slate-50 font-semibold">
                        <td className="p-2.5 border-b border-slate-200 text-amber-800">
                          Container Masih OTW
                        </td>
                        <td className="p-2.5 text-center border-b border-slate-200 font-mono font-bold text-amber-700">
                          {reportData.totalMasihOTW} Container
                        </td>
                        <td className="p-2.5 text-right border-b border-slate-200 font-mono font-bold text-amber-700">
                          {formatQty(reportData.otwQty)}
                        </td>
                        <td className="p-2.5 text-right border-b border-slate-200 font-mono font-bold text-amber-700">
                          {formatRp(reportData.otwCost)}
                        </td>
                        <td className="p-2.5 text-right border-b border-slate-200 font-mono font-bold text-amber-700">
                          {reportData.totalAll > 0 ? ((reportData.totalMasihOTW / reportData.totalAll) * 100).toFixed(1) : '0.0'} %
                        </td>
                      </tr>
                      <tr className="bg-white font-semibold">
                        <td className="p-2.5 border-b border-slate-200 text-slate-700">
                          Container Belum OTW
                        </td>
                        <td className="p-2.5 text-center border-b border-slate-200 font-mono font-bold text-slate-700">
                          {reportData.totalBelumOTW} Container
                        </td>
                        <td className="p-2.5 text-right border-b border-slate-200 font-mono font-bold text-slate-700">
                          {formatQty(reportData.belumQty)}
                        </td>
                        <td className="p-2.5 text-right border-b border-slate-200 font-mono font-bold text-amber-700">
                          {formatRp(reportData.belumCost)}
                        </td>
                        <td className="p-2.5 text-right border-b border-slate-200 font-mono font-bold text-slate-700">
                          {reportData.totalAll > 0 ? ((reportData.totalBelumOTW / reportData.totalAll) * 100).toFixed(1) : '0.0'} %
                        </td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-900 text-white font-bold">
                        <td className="p-2.5 border-b border-slate-800">TOTAL KESELURUHAN CONTAINER:</td>
                        <td className="p-2.5 text-center font-mono text-sky-400">{reportData.totalAll} Container</td>
                        <td className="p-2.5 text-right font-mono text-emerald-400">{formatQty(reportData.totalQtyAll)}</td>
                        <td className="p-2.5 text-right font-mono text-amber-400">{formatRp(reportData.totalCostAll)}</td>
                        <td className="p-2.5 text-right font-mono text-sky-400">100.0 %</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Point 2: Perincian Per Kategori Table */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-1.5">
                  <span className="px-2 py-0.5 bg-amber-600 text-white font-mono font-bold rounded text-[10px]">2</span>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                    PERINCIAN STATUS CONTAINER PER KATEGORI (IMPORT vs LOKAL)
                  </h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border border-slate-200 rounded-lg text-[11px]">
                    <thead>
                      <tr className="bg-amber-100/70 text-amber-950 font-bold">
                        <th className="p-2 text-center border-b border-amber-200 w-10">No</th>
                        <th className="p-2 border-b border-amber-200">Kategori / Status Perjalanan</th>
                        <th className="p-2 text-center border-b border-amber-200">Total Container</th>
                        <th className="p-2 text-right border-b border-amber-200">Total Qty</th>
                        <th className="p-2 text-right border-b border-amber-200">Total Nilai Beli (Cost)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reportData.categoryList.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-3 text-center text-slate-400">
                            Tidak ada data container
                          </td>
                        </tr>
                      ) : (
                        reportData.categoryList.map((cat, i) => (
                          <React.Fragment key={cat.categoryName}>
                            <tr className="bg-amber-100/40 font-bold text-amber-950">
                              <td className="p-2 text-center font-mono">{i + 1}</td>
                              <td className="p-2">{cat.categoryName} (TOTAL KATEGORI)</td>
                              <td className="p-2 text-center font-mono">{cat.total} Container</td>
                              <td className="p-2 text-right font-mono">{formatQty(cat.totalQty)}</td>
                              <td className="p-2 text-right font-mono text-amber-800">{formatRp(cat.totalCost)}</td>
                            </tr>
                            <tr className="bg-emerald-50/40 font-medium">
                              <td className="p-1.5"></td>
                              <td className="p-1.5 pl-6 text-emerald-800 font-semibold">├─ Barang Sudah Tiba di Bintara</td>
                              <td className="p-1.5 text-center font-mono text-emerald-800">{cat.tibaBintara} Container</td>
                              <td className="p-1.5 text-right font-mono text-emerald-800">{formatQty(cat.tibaQty)}</td>
                              <td className="p-1.5 text-right font-mono text-emerald-800">{formatRp(cat.tibaCost)}</td>
                            </tr>
                            <tr className="bg-amber-50/40 font-medium">
                              <td className="p-1.5"></td>
                              <td className="p-1.5 pl-6 text-amber-800 font-semibold">├─ Container Masih OTW</td>
                              <td className="p-1.5 text-center font-mono text-amber-800">{cat.masihOTW} Container</td>
                              <td className="p-1.5 text-right font-mono text-amber-800">{formatQty(cat.otwQty)}</td>
                              <td className="p-1.5 text-right font-mono text-amber-800">{formatRp(cat.otwCost)}</td>
                            </tr>
                            <tr className="bg-slate-50/60 font-medium">
                              <td className="p-1.5"></td>
                              <td className="p-1.5 pl-6 text-slate-700 font-semibold">└─ Container Belum OTW</td>
                              <td className="p-1.5 text-center font-mono text-slate-700">{cat.belumOTW} Container</td>
                              <td className="p-1.5 text-right font-mono text-slate-700">{formatQty(cat.belumQty)}</td>
                              <td className="p-1.5 text-right font-mono text-slate-700">{formatRp(cat.belumCost)}</td>
                            </tr>
                          </React.Fragment>
                        ))
                      )}
                    </tbody>
                    {reportData.categoryList.length > 0 && (
                      <tfoot>
                        <tr className="bg-amber-100/90 font-bold text-amber-950 border-t-2 border-amber-200">
                          <td colSpan={2} className="p-2 text-right uppercase text-[10px]">
                            TOTAL KATEGORI:
                          </td>
                          <td className="p-2 text-center font-mono">{reportData.totalAll} Container</td>
                          <td className="p-2 text-right font-mono">{formatQty(reportData.totalQtyAll)}</td>
                          <td className="p-2 text-right font-mono text-amber-800">{formatRp(reportData.totalCostAll)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              {/* Point 3: Perincian Per Bulan Table */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-1.5">
                  <span className="px-2 py-0.5 bg-indigo-600 text-white font-mono font-bold rounded text-[10px]">3</span>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                    PERINCIAN CONTAINER PER PERIODE BULAN TIBA
                  </h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border border-slate-200 rounded-lg text-[11px]">
                    <thead>
                      <tr className="bg-indigo-100/70 text-indigo-950 font-bold">
                        <th className="p-2 text-center border-b border-indigo-200 w-10">No</th>
                        <th className="p-2 border-b border-indigo-200">Periode Bulan / Status Perjalanan</th>
                        <th className="p-2 text-center border-b border-indigo-200">Total Container</th>
                        <th className="p-2 text-right border-b border-indigo-200">Total Qty</th>
                        <th className="p-2 text-right border-b border-indigo-200">Total Nilai Beli (Cost)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reportData.monthlyList.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-3 text-center text-slate-400">
                            Tidak ada data periode bulan
                          </td>
                        </tr>
                      ) : (
                        reportData.monthlyList.map((m, i) => (
                          <React.Fragment key={m.monthKey}>
                            <tr className="bg-indigo-100/40 font-bold text-indigo-950">
                              <td className="p-2 text-center font-mono">{i + 1}</td>
                              <td className="p-2">{reportData.formatMonthLabel(m.monthKey)} (TOTAL BULAN)</td>
                              <td className="p-2 text-center font-mono">{m.total} Container</td>
                              <td className="p-2 text-right font-mono">{formatQty(m.totalQty)}</td>
                              <td className="p-2 text-right font-mono text-amber-800">{formatRp(m.totalCost)}</td>
                            </tr>
                            <tr className="bg-emerald-50/40 font-medium">
                              <td className="p-1.5"></td>
                              <td className="p-1.5 pl-6 text-emerald-800 font-semibold">├─ Barang Sudah Tiba di Bintara</td>
                              <td className="p-1.5 text-center font-mono text-emerald-800">{m.tibaBintara} Container</td>
                              <td className="p-1.5 text-right font-mono text-emerald-800">{formatQty(m.tibaQty)}</td>
                              <td className="p-1.5 text-right font-mono text-emerald-800">{formatRp(m.tibaCost)}</td>
                            </tr>
                            <tr className="bg-amber-50/40 font-medium">
                              <td className="p-1.5"></td>
                              <td className="p-1.5 pl-6 text-amber-800 font-semibold">├─ Container Masih OTW</td>
                              <td className="p-1.5 text-center font-mono text-amber-800">{m.masihOTW} Container</td>
                              <td className="p-1.5 text-right font-mono text-amber-800">{formatQty(m.otwQty)}</td>
                              <td className="p-1.5 text-right font-mono text-amber-800">{formatRp(m.otwCost)}</td>
                            </tr>
                            <tr className="bg-slate-50/60 font-medium">
                              <td className="p-1.5"></td>
                              <td className="p-1.5 pl-6 text-slate-700 font-semibold">└─ Container Belum OTW</td>
                              <td className="p-1.5 text-center font-mono text-slate-700">{m.belumOTW} Container</td>
                              <td className="p-1.5 text-right font-mono text-slate-700">{formatQty(m.belumQty)}</td>
                              <td className="p-1.5 text-right font-mono text-slate-700">{formatRp(m.belumCost)}</td>
                            </tr>
                          </React.Fragment>
                        ))
                      )}
                    </tbody>
                    {reportData.monthlyList.length > 0 && (
                      <tfoot>
                        <tr className="bg-indigo-100/90 font-bold text-indigo-950 border-t-2 border-indigo-200">
                          <td colSpan={2} className="p-2 text-right uppercase text-[10px]">
                            TOTAL BULAN:
                          </td>
                          <td className="p-2 text-center font-mono">{reportData.totalAll} Container</td>
                          <td className="p-2 text-right font-mono">{formatQty(reportData.totalQtyAll)}</td>
                          <td className="p-2 text-right font-mono text-amber-800">{formatRp(reportData.totalCostAll)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              {/* Point 4: Daftar Pending Containers Table */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-1.5">
                  <span className="px-2 py-0.5 bg-blue-600 text-white font-mono font-bold rounded text-[10px]">4</span>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                    DAFTAR CONTAINER DALAM PERJALANAN / PENDING (MASIH OTW &amp; BELUM OTW)
                  </h3>
                </div>
                {renderContainerJsxTable(
                  reportData.pendingContainers,
                  "Semua Container Telah Sampai di Bintara (Tidak ada container pending/OTW)"
                )}
              </div>

              {/* Point 5: Daftar Seluruh Data Container Table */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-1.5">
                  <span className="px-2 py-0.5 bg-slate-800 text-white font-mono font-bold rounded text-[10px]">5</span>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                    DAFTAR SELURUH DATA CONTAINER (LENGKAP SESUAI TAMPILAN WEB)
                  </h3>
                </div>
                {renderContainerJsxTable(
                  reportData.targetContainers,
                  "Tidak ada data container ditemukan"
                )}
              </div>

              <div className="mt-6 pt-3 border-t border-slate-200 text-center text-[11px] text-slate-500">
                Laporan ini di-generate secara otomatis oleh Sistem Aplikasi Inventory Gudang.
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
