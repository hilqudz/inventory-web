import React, { useState, useMemo, useEffect } from 'react';
import {
  Package,
  Boxes,
  Clock,
  GitCompare,
  FileSpreadsheet,
  TrendingUp,
  ShieldAlert,
  Truck,
  CheckCircle2,
  ListFilter,
  Mail,
  Ship,
  HelpCircle,
  Calendar,
  Search,
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2
} from 'lucide-react';
import { MasterItem, TransactionRecord, DoOpenRecord, ContainerRecord, ActiveTab, getDoOpenLogistikGroup } from '../types';
import { EmailStockReportModal } from '../components/EmailStockReportModal';
import { EmailRekapTahunReportModal } from '../components/EmailRekapTahunReportModal';
import { exportToExcel, exportMultiSheetExcel } from '../utils/excel';

const isDoOpenStatus = (str?: string): boolean => {
  if (!str) return false;
  const s = str.trim().toUpperCase();
  return (
    s.includes('SHIPPING') ||
    s.includes('LOGISTIK') ||
    s.includes('RECEIPT') ||
    s.includes('AREA QC') ||
    s.includes('POSTING') ||
    s.includes('DO SUDAH') ||
    s.includes('DO BELUM') ||
    s.includes('DO OPEN') ||
    s.includes('STATUS DO') ||
    s.includes('BELUM DI') ||
    s.includes('MASIH ADA DI')
  );
};

export interface DashboardViewProps {
  masterItems: MasterItem[];
  transaksiMasuk: TransactionRecord[];
  transaksiKeluar: TransactionRecord[];
  doOpen: DoOpenRecord[];
  containers?: ContainerRecord[];
  userRole?: string;
  onNavigateTab: (tab: ActiveTab) => void;
  onOpenImport: (type: 'master' | 'transaksi_masuk' | 'transaksi_keluar' | 'do_open') => void;
  onRunAutoReconcile: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  masterItems,
  transaksiMasuk,
  transaksiKeluar,
  doOpen,
  containers = [],
  userRole,
  onNavigateTab,
  onOpenImport,
  onRunAutoReconcile
}) => {
  // Category Limit & Sort controls
  const [categoryLimit, setCategoryLimit] = useState<'20' | 'all'>('20');
  const [categorySort, setCategorySort] = useState<'sisa' | 'doOpen' | 'lepasan' | 'nilaiJual' | 'nilaiBeli'>('sisa');
  const [showEmailReportModal, setShowEmailReportModal] = useState(false);
  const [showEmailRekapModal, setShowEmailRekapModal] = useState(false);

  // Controls for Created Date & Group Name Detailed Items Table
  const [cdDetailSearch, setCdDetailSearch] = useState('');
  const [cdDetailYear, setCdDetailYear] = useState<string>('ALL');
  const [cdDetailGroup, setCdDetailGroup] = useState<string>('ALL');
  const [cdDetailPage, setCdDetailPage] = useState<number>(1);
  const cdDetailRowsPerPage = 20;

  // Container Summary Metrics Calculation
  const totalContainerCount = containers.length;
  const totalContainerQty = containers.reduce((sum, c) => sum + (Number(c.totalQty) || 0), 0);
  const totalContainerPrice = containers.reduce((sum, c) => sum + (Number(c.totalPrice) || 0), 0);
  const totalContainerCost = containers.reduce((sum, c) => sum + (Number(c.totalCost) || 0), 0);

  let containerTibaBintaraCount = 0;
  let containerTibaBintaraQty = 0;
  let containerTibaBintaraCost = 0;
  let containerTibaBintaraPrice = 0;

  let containerMasihOTWCount = 0;
  let containerMasihOTWQty = 0;
  let containerMasihOTWCost = 0;
  let containerMasihOTWPrice = 0;

  let containerBelumOTWCount = 0;
  let containerBelumOTWQty = 0;
  let containerBelumOTWCost = 0;
  let containerBelumOTWPrice = 0;

  containers.forEach(c => {
    const q = Number(c.totalQty) || 0;
    const cost = Number(c.totalCost) || 0;
    const price = Number(c.totalPrice) || 0;

    if (c.statusContainer === 'Barang Sudah Tiba di Bintara') {
      containerTibaBintaraCount++;
      containerTibaBintaraQty += q;
      containerTibaBintaraCost += cost;
      containerTibaBintaraPrice += price;
    } else if (c.statusContainer === 'Container Masih OTW') {
      containerMasihOTWCount++;
      containerMasihOTWQty += q;
      containerMasihOTWCost += cost;
      containerMasihOTWPrice += price;
    } else {
      containerBelumOTWCount++;
      containerBelumOTWQty += q;
      containerBelumOTWCost += cost;
      containerBelumOTWPrice += price;
    }
  });

  // Currency formatter
  const formatCurrency = (val: number) => {
    return 'Rp ' + val.toLocaleString('id-ID', { maximumFractionDigits: 0 });
  };

  const masterMap = new Map<string, MasterItem>();
  masterItems.forEach(m => {
    if (m.itemCode) masterMap.set(m.itemCode, m);
  });

  // 1. Calculate Per-Item Sisa Stock, DO OPEN Qty, Qty Lepasan & Nilai Harga Jual / Beli
  const itemStockMap: Record<string, { 
    itemCode: string; 
    itemName: string; 
    groupName: string;
    hargaJual: number;
    hargaBeli: number;
    masuk: number; 
    keluar: number; 
    sisa: number;
    doOpenQty: number;
    qtyLepasan: number;
    nilaiJual: number;
    nilaiBeli: number;
  }> = {};

  // Initialize from Master
  masterItems.forEach(m => {
    if (!m.itemCode) return;
    const gName = (m.groupName && !isDoOpenStatus(m.groupName)) ? m.groupName : 'Umum';
    itemStockMap[m.itemCode] = {
      itemCode: m.itemCode,
      itemName: m.itemName,
      groupName: gName,
      hargaJual: m.hargaJual || 0,
      hargaBeli: m.hargaBeli || 0,
      masuk: 0,
      keluar: 0,
      sisa: 0,
      doOpenQty: 0,
      qtyLepasan: 0,
      nilaiJual: 0,
      nilaiBeli: 0
    };
  });

  // Aggregate Masuk
  transaksiMasuk.forEach(t => {
    if (!t.itemCode) return;
    if (!itemStockMap[t.itemCode]) {
      const gName = (t.category && !isDoOpenStatus(t.category)) ? t.category : 'Umum';
      itemStockMap[t.itemCode] = { 
        itemCode: t.itemCode, 
        itemName: t.itemCode, 
        groupName: gName,
        hargaJual: 0,
        hargaBeli: 0,
        masuk: 0, 
        keluar: 0, 
        sisa: 0,
        doOpenQty: 0,
        qtyLepasan: 0,
        nilaiJual: 0,
        nilaiBeli: 0
      };
    }
    itemStockMap[t.itemCode].masuk += (t.qty || 0);
  });

  // Aggregate Keluar
  transaksiKeluar.forEach(t => {
    if (!t.itemCode) return;
    if (!itemStockMap[t.itemCode]) {
      const gName = (t.category && !isDoOpenStatus(t.category)) ? t.category : 'Umum';
      itemStockMap[t.itemCode] = { 
        itemCode: t.itemCode, 
        itemName: t.itemCode, 
        groupName: gName,
        hargaJual: 0,
        hargaBeli: 0,
        masuk: 0, 
        keluar: 0, 
        sisa: 0,
        doOpenQty: 0,
        qtyLepasan: 0,
        nilaiJual: 0,
        nilaiBeli: 0
      };
    }
    itemStockMap[t.itemCode].keluar += (t.qty || 0);
  });

  // Aggregate DO OPEN per Item
  doOpen.forEach(d => {
    if (!d.itemCode) return;
    if (!itemStockMap[d.itemCode]) {
      const m = masterItems.find(i => i.itemCode === d.itemCode);
      const gName = (m?.groupName && !isDoOpenStatus(m.groupName)) ? m.groupName : 'Umum';
      itemStockMap[d.itemCode] = {
        itemCode: d.itemCode,
        itemName: m?.itemName || d.itemCode,
        groupName: gName,
        hargaJual: m?.hargaJual || 0,
        hargaBeli: m?.hargaBeli || 0,
        masuk: 0,
        keluar: 0,
        sisa: 0,
        doOpenQty: 0,
        qtyLepasan: 0,
        nilaiJual: 0,
        nilaiBeli: 0
      };
    }
    itemStockMap[d.itemCode].doOpenQty += (d.qty || 0);
  });

  // Compute final sisa & nilai
  let totalSisaStockQty = 0;
  let totalNilaiHargaJual = 0;
  let totalNilaiHargaBeli = 0;

  Object.values(itemStockMap).forEach(item => {
    item.sisa = item.masuk - item.keluar;
    item.qtyLepasan = Math.max(0, item.sisa - item.doOpenQty);
    item.nilaiJual = item.sisa * item.hargaJual;
    item.nilaiBeli = item.sisa * item.hargaBeli;

    totalSisaStockQty += item.sisa;
    totalNilaiHargaJual += item.nilaiJual;
    totalNilaiHargaBeli += item.nilaiBeli;
  });

  const totalDoOpenQty = doOpen.reduce((sum, t) => sum + (t.qty || 0), 0);
  const totalQtyLepasan = Math.max(0, totalSisaStockQty - totalDoOpenQty);

  // 2. Group by Kategori for "Kategori Terbanyak Berdasarkan Total Sisa Qty, DO OPEN, & Qty"
  const groupCategoryMap: Record<string, {
    groupName: string;
    itemCount: number;
    totalSisaQty: number;
    totalDoOpenQty: number;
    totalQtyLepasan: number;
    totalNilaiJual: number;
    totalNilaiBeli: number;
  }> = {};

  Object.values(itemStockMap).forEach(item => {
    const grp = item.groupName || 'Umum';
    if (!groupCategoryMap[grp]) {
      groupCategoryMap[grp] = {
        groupName: grp,
        itemCount: 0,
        totalSisaQty: 0,
        totalDoOpenQty: 0,
        totalQtyLepasan: 0,
        totalNilaiJual: 0,
        totalNilaiBeli: 0
      };
    }
    groupCategoryMap[grp].itemCount += 1;
    groupCategoryMap[grp].totalSisaQty += item.sisa;
    groupCategoryMap[grp].totalDoOpenQty += item.doOpenQty;
    groupCategoryMap[grp].totalQtyLepasan += item.qtyLepasan;
    groupCategoryMap[grp].totalNilaiJual += item.nilaiJual;
    groupCategoryMap[grp].totalNilaiBeli += item.nilaiBeli;
  });

  // Sort categories list based on user selection
  const categoryList = Object.values(groupCategoryMap).sort((a, b) => {
    if (categorySort === 'doOpen') return b.totalDoOpenQty - a.totalDoOpenQty;
    if (categorySort === 'lepasan') return b.totalQtyLepasan - a.totalQtyLepasan;
    if (categorySort === 'nilaiJual') return b.totalNilaiJual - a.totalNilaiJual;
    if (categorySort === 'nilaiBeli') return b.totalNilaiBeli - a.totalNilaiBeli;
    return b.totalSisaQty - a.totalSisaQty; // default 'sisa'
  });

  const displayedCategories = categoryLimit === '20' ? categoryList.slice(0, 20) : categoryList;

  // Compute grand totals for displayed categories
  const displayedTotals = displayedCategories.reduce((acc, cat) => {
    acc.itemCount += cat.itemCount;
    acc.totalSisaQty += cat.totalSisaQty;
    acc.totalDoOpenQty += cat.totalDoOpenQty;
    acc.totalQtyLepasan += cat.totalQtyLepasan;
    acc.totalNilaiJual += cat.totalNilaiJual;
    acc.totalNilaiBeli += cat.totalNilaiBeli;
    return acc;
  }, {
    itemCount: 0,
    totalSisaQty: 0,
    totalDoOpenQty: 0,
    totalQtyLepasan: 0,
    totalNilaiJual: 0,
    totalNilaiBeli: 0
  });

  // 3. DO OPEN Breakdown by Status & Posisi Barang (Count Unique No DO / DocumentNo)
  const targetDoOpen = userRole === 'OPR'
    ? doOpen.filter(d => getDoOpenLogistikGroup(d.category) === 'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)')
    : doOpen;

  const totalUniqueDoCount = new Set(
    targetDoOpen.map(d => (d.documentNo || '').trim().toUpperCase()).filter(Boolean)
  ).size;

  const qcDocSet = new Set<string>();
  let qtyBarangQC = 0;
  const logistikDocSet = new Set<string>();
  let qtyBarangLogistik = 0;

  const doStatusBreakdownMap: Record<string, {
    categoryStatus: string;
    logistikGroup: 'BARANG MASIH ADA DI AREA QC' | 'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)';
    docSet: Set<string>;
    totalQty: number;
  }> = {};

  targetDoOpen.forEach(d => {
    const status = (d.category || 'BELUM SHIPPING KE LOGISTIK').trim();
    const group = getDoOpenLogistikGroup(status);
    const docNo = (d.documentNo || '').trim().toUpperCase();
    const q = Number(d.qty) || 0;

    if (group === 'BARANG MASIH ADA DI AREA QC') {
      if (docNo) qcDocSet.add(docNo);
      qtyBarangQC += q;
    } else {
      if (docNo) logistikDocSet.add(docNo);
      qtyBarangLogistik += q;
    }

    if (!doStatusBreakdownMap[status]) {
      doStatusBreakdownMap[status] = {
        categoryStatus: status,
        logistikGroup: group,
        docSet: new Set<string>(),
        totalQty: 0
      };
    }
    if (docNo) doStatusBreakdownMap[status].docSet.add(docNo);
    doStatusBreakdownMap[status].totalQty += q;
  });

  const countBarangQC = qcDocSet.size;
  const countBarangLogistik = logistikDocSet.size;

  const sortedDoStatusList = Object.values(doStatusBreakdownMap).map(st => ({
    categoryStatus: st.categoryStatus,
    logistikGroup: st.logistikGroup,
    docCount: st.docSet.size,
    totalQty: st.totalQty
  })).sort((a, b) => b.totalQty - a.totalQty);

  // 4. Dashboard Total Barang Per Tahun (Berdasarkan Posting Date)
  const yearlySummary = useMemo(() => {
    const map: Record<string, {
      year: string;
      masukQty: number;
      masukTxCount: number;
      masukNilaiBeli: number;
      keluarQty: number;
      keluarTxCount: number;
      keluarNilaiBeli: number;
      doOpenQty: number;
      doOpenDocSet: Set<string>;
      doOpenNilaiBeli: number;
    }> = {};

    const extractYear = (dateStr?: string): string => {
      if (!dateStr) return 'Tanpa Tahun';
      const clean = dateStr.trim();
      if (!clean) return 'Tanpa Tahun';
      const match = clean.match(/^(\d{4})/);
      if (match) return match[1];
      const parts = clean.split(/[-/]/);
      if (parts.length === 3) {
        if (parts[2].length === 4) return parts[2];
        if (parts[0].length === 4) return parts[0];
      }
      return 'Tanpa Tahun';
    };

    const getItem = (yr: string) => {
      if (!map[yr]) {
        map[yr] = {
          year: yr,
          masukQty: 0,
          masukTxCount: 0,
          masukNilaiBeli: 0,
          keluarQty: 0,
          keluarTxCount: 0,
          keluarNilaiBeli: 0,
          doOpenQty: 0,
          doOpenDocSet: new Set<string>(),
          doOpenNilaiBeli: 0
        };
      }
      return map[yr];
    };

    transaksiMasuk.forEach(t => {
      const yr = extractYear(t.postingDate);
      const item = getItem(yr);
      const q = Number(t.qty) || 0;
      const m = masterMap.get(t.itemCode);
      item.masukQty += q;
      item.masukTxCount += 1;
      item.masukNilaiBeli += q * (m?.hargaBeli || 0);
    });

    transaksiKeluar.forEach(t => {
      const yr = extractYear(t.postingDate);
      const item = getItem(yr);
      const q = Number(t.qty) || 0;
      const m = masterMap.get(t.itemCode);
      item.keluarQty += q;
      item.keluarTxCount += 1;
      item.keluarNilaiBeli += q * (m?.hargaBeli || 0);
    });

    doOpen.forEach(d => {
      const yr = extractYear(d.postingDate);
      const item = getItem(yr);
      const q = Number(d.qty) || 0;
      const m = masterMap.get(d.itemCode);
      item.doOpenQty += q;
      if (d.documentNo) {
        item.doOpenDocSet.add(d.documentNo.trim().toUpperCase());
      }
      item.doOpenNilaiBeli += q * (m?.hargaBeli || 0);
    });

    return Object.values(map)
      .map(y => ({
        year: y.year,
        masukQty: y.masukQty,
        masukTxCount: y.masukTxCount,
        masukNilaiBeli: y.masukNilaiBeli,
        keluarQty: y.keluarQty,
        keluarTxCount: y.keluarTxCount,
        keluarNilaiBeli: y.keluarNilaiBeli,
        doOpenQty: y.doOpenQty,
        doOpenDocCount: y.doOpenDocSet.size,
        doOpenNilaiBeli: y.doOpenNilaiBeli,
        netStockChange: y.masukQty - y.keluarQty,
        totalVolume: y.masukQty + y.keluarQty + y.doOpenQty
      }))
      .sort((a, b) => {
        if (a.year === 'Tanpa Tahun') return 1;
        if (b.year === 'Tanpa Tahun') return -1;
        return b.year.localeCompare(a.year, undefined, { numeric: true });
      });
  }, [transaksiMasuk, transaksiKeluar, doOpen, masterMap]);

  const yearlyTotals = useMemo(() => {
    return yearlySummary.reduce((acc, y) => {
      acc.masukQty += y.masukQty;
      acc.masukTxCount += y.masukTxCount;
      acc.masukNilaiBeli += y.masukNilaiBeli;
      acc.keluarQty += y.keluarQty;
      acc.keluarTxCount += y.keluarTxCount;
      acc.keluarNilaiBeli += y.keluarNilaiBeli;
      acc.doOpenQty += y.doOpenQty;
      acc.doOpenDocCount += y.doOpenDocCount;
      acc.doOpenNilaiBeli += y.doOpenNilaiBeli;
      acc.netStockChange += y.netStockChange;
      acc.totalVolume += y.totalVolume;
      return acc;
    }, {
      masukQty: 0,
      masukTxCount: 0,
      masukNilaiBeli: 0,
      keluarQty: 0,
      keluarTxCount: 0,
      keluarNilaiBeli: 0,
      doOpenQty: 0,
      doOpenDocCount: 0,
      doOpenNilaiBeli: 0,
      netStockChange: 0,
      totalVolume: 0
    });
  }, [yearlySummary]);

  // 4b. Dashboard Total Barang Per Tahun Berdasarkan Posting Date & Lokasi Position (QC vs Logistik)
  const doOpenYearlyByLocation = useMemo(() => {
    const baseYears = ['2021', '2022', '2023', '2024', '2025', '2026'];
    const yearsSet = new Set<string>(baseYears);

    const extractYear = (dateStr?: string): string => {
      if (!dateStr) return 'Tanpa Tahun';
      const clean = dateStr.trim();
      if (!clean) return 'Tanpa Tahun';
      const match = clean.match(/(\d{4})/);
      if (match) return match[1];
      return 'Tanpa Tahun';
    };

    doOpen.forEach(d => {
      const yr = extractYear(d.postingDate);
      yearsSet.add(yr);
    });

    const sortedYears = Array.from(yearsSet).sort((a, b) => {
      if (a === 'Tanpa Tahun') return 1;
      if (b === 'Tanpa Tahun') return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    });

    const qcYearMap: Record<string, { year: string; doSet: Set<string>; qty: number; nilaiBeli: number; nilaiJual: number }> = {};
    const logistikYearMap: Record<string, { year: string; doSet: Set<string>; qty: number; nilaiBeli: number; nilaiJual: number }> = {};

    sortedYears.forEach(yr => {
      qcYearMap[yr] = { year: yr, doSet: new Set<string>(), qty: 0, nilaiBeli: 0, nilaiJual: 0 };
      logistikYearMap[yr] = { year: yr, doSet: new Set<string>(), qty: 0, nilaiBeli: 0, nilaiJual: 0 };
    });

    const qcOverallSet = new Set<string>();
    let qcOverallQty = 0;
    let qcOverallNilaiBeli = 0;
    let qcOverallNilaiJual = 0;

    const logistikOverallSet = new Set<string>();
    let logistikOverallQty = 0;
    let logistikOverallNilaiBeli = 0;
    let logistikOverallNilaiJual = 0;

    doOpen.forEach(d => {
      const yr = extractYear(d.postingDate);
      const docNo = (d.documentNo || '').trim().toUpperCase();
      const q = Number(d.qty) || 0;
      const m = masterMap.get(d.itemCode);
      const nb = q * (m?.hargaBeli || 0);
      const nj = q * (m?.hargaJual || 0);

      const isLogistik = getDoOpenLogistikGroup(d.category) === 'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)';

      if (isLogistik) {
        if (!logistikYearMap[yr]) {
          logistikYearMap[yr] = { year: yr, doSet: new Set<string>(), qty: 0, nilaiBeli: 0, nilaiJual: 0 };
        }
        if (docNo) logistikYearMap[yr].doSet.add(docNo);
        logistikYearMap[yr].qty += q;
        logistikYearMap[yr].nilaiBeli += nb;
        logistikYearMap[yr].nilaiJual += nj;

        if (docNo) logistikOverallSet.add(docNo);
        logistikOverallQty += q;
        logistikOverallNilaiBeli += nb;
        logistikOverallNilaiJual += nj;
      } else {
        if (!qcYearMap[yr]) {
          qcYearMap[yr] = { year: yr, doSet: new Set<string>(), qty: 0, nilaiBeli: 0, nilaiJual: 0 };
        }
        if (docNo) qcYearMap[yr].doSet.add(docNo);
        qcYearMap[yr].qty += q;
        qcYearMap[yr].nilaiBeli += nb;
        qcYearMap[yr].nilaiJual += nj;

        if (docNo) qcOverallSet.add(docNo);
        qcOverallQty += q;
        qcOverallNilaiBeli += nb;
        qcOverallNilaiJual += nj;
      }
    });

    const qcRows = sortedYears.map(yr => ({
      year: yr,
      totalDo: qcYearMap[yr]?.doSet.size || 0,
      qty: qcYearMap[yr]?.qty || 0,
      nilaiBeli: qcYearMap[yr]?.nilaiBeli || 0,
      nilaiJual: qcYearMap[yr]?.nilaiJual || 0
    }));

    const logistikRows = sortedYears.map(yr => ({
      year: yr,
      totalDo: logistikYearMap[yr]?.doSet.size || 0,
      qty: logistikYearMap[yr]?.qty || 0,
      nilaiBeli: logistikYearMap[yr]?.nilaiBeli || 0,
      nilaiJual: logistikYearMap[yr]?.nilaiJual || 0
    }));

    return {
      sortedYears,
      qcRows,
      qcTotals: {
        totalDo: qcOverallSet.size,
        qty: qcOverallQty,
        nilaiBeli: qcOverallNilaiBeli,
        nilaiJual: qcOverallNilaiJual
      },
      logistikRows,
      logistikTotals: {
        totalDo: logistikOverallSet.size,
        qty: logistikOverallQty,
        nilaiJual: logistikOverallNilaiJual,
        nilaiBeli: logistikOverallNilaiBeli
      }
    };
  }, [doOpen, masterMap]);

  // 4c. Dashboard Qty Stock Berdasarkan CreatedDate (Tahun, Total Qty, Total Nilai Beli)
  const createdDateYearlySummary = useMemo(() => {
    const map: Record<string, {
      year: string;
      itemCount: number;
      totalQty: number;
      totalNilaiBeli: number;
      totalNilaiJual: number;
    }> = {};

    const extractYearFromCreatedDate = (createdDateStr?: string, createdAtStr?: string): string => {
      const str = (createdDateStr || createdAtStr || '').trim();
      if (!str) return 'Tanpa Tahun';

      const fourDigit = str.match(/\b(20\d{2}|19\d{2})\b/);
      if (fourDigit) return fourDigit[1];

      const twoDigit = str.match(/[-/](\d{2})$/);
      if (twoDigit) {
        const yy = parseInt(twoDigit[1], 10);
        return yy < 70 ? `20${twoDigit[1]}` : `19${twoDigit[1]}`;
      }

      if (str.length >= 4 && !isNaN(Number(str.slice(0, 4)))) {
        return str.slice(0, 4);
      }

      return str || 'Tanpa Tahun';
    };

    masterItems.forEach(item => {
      if (!item.itemCode) return;
      const yr = extractYearFromCreatedDate(item.createdDate, item.createdAt);
      const stockInfo = itemStockMap[item.itemCode];
      const sisaQty = stockInfo ? stockInfo.sisa : 0;
      const hb = Number(item.hargaBeli || stockInfo?.hargaBeli || 0);
      const hj = Number(item.hargaJual || stockInfo?.hargaJual || 0);
      const nilaiBeli = sisaQty * hb;
      const nilaiJual = sisaQty * hj;

      if (!map[yr]) {
        map[yr] = {
          year: yr,
          itemCount: 0,
          totalQty: 0,
          totalNilaiBeli: 0,
          totalNilaiJual: 0
        };
      }
      map[yr].itemCount += 1;
      map[yr].totalQty += sisaQty;
      map[yr].totalNilaiBeli += nilaiBeli;
      map[yr].totalNilaiJual += nilaiJual;
    });

    const hiddenYears = new Set(['2013', '2014', '2015', '2016']);

    return Object.values(map)
      .filter(r => !hiddenYears.has(r.year) && r.totalQty > 0)
      .sort((a, b) => {
        if (a.year === 'Tanpa Tahun') return 1;
        if (b.year === 'Tanpa Tahun') return -1;
        return b.year.localeCompare(a.year, undefined, { numeric: true });
      });
  }, [masterItems, itemStockMap]);

  const createdDateTotals = useMemo(() => {
    return createdDateYearlySummary.reduce((acc, row) => {
      acc.itemCount += row.itemCount;
      acc.totalQty += row.totalQty;
      acc.totalNilaiBeli += row.totalNilaiBeli;
      acc.totalNilaiJual += row.totalNilaiJual;
      return acc;
    }, { itemCount: 0, totalQty: 0, totalNilaiBeli: 0, totalNilaiJual: 0 });
  }, [createdDateYearlySummary]);

  const handleExportCreatedDateExcel = () => {
    const summaryRows = createdDateYearlySummary.map(r => ({
      'Tahun (Created Date)': r.year,
      'Total Qty Stock (Pcs)': r.totalQty,
      'Total Nilai Beli (Rp)': r.totalNilaiBeli,
      'Total Nilai Jual (Rp)': r.totalNilaiJual
    }));

    summaryRows.push({
      'Tahun (Created Date)': 'Grand Total',
      'Total Qty Stock (Pcs)': createdDateTotals.totalQty,
      'Total Nilai Beli (Rp)': createdDateTotals.totalNilaiBeli,
      'Total Nilai Jual (Rp)': createdDateTotals.totalNilaiJual
    });

    exportToExcel(summaryRows, `Dashboard_Qty_Stock_CreatedDate_${new Date().toISOString().slice(0, 10)}`);
  };

  const { cdGroupedAllRows, cdDetailYearOptions, cdDetailGroupOptions } = useMemo(() => {
    const extractYearFromCreatedDate = (createdDateStr?: string, createdAtStr?: string): string => {
      const str = (createdDateStr || createdAtStr || '').trim();
      if (!str) return 'Tanpa Tahun';

      const fourDigit = str.match(/\b(20\d{2}|19\d{2})\b/);
      if (fourDigit) return fourDigit[1];

      const twoDigit = str.match(/[-/](\d{2})$/);
      if (twoDigit) {
        const yy = parseInt(twoDigit[1], 10);
        return yy < 70 ? `20${twoDigit[1]}` : `19${twoDigit[1]}`;
      }

      if (str.length >= 4 && !isNaN(Number(str.slice(0, 4)))) {
        return str.slice(0, 4);
      }

      return str || 'Tanpa Tahun';
    };

    const hiddenYears = new Set(['2013', '2014', '2015', '2016']);
    const yearsSet = new Set<string>();
    const groupsSet = new Set<string>();

    const groupMap = new Map<string, {
      year: string;
      groupName: string;
      itemCount: number;
      totalQty: number;
      totalCost: number;
      totalCostJual: number;
    }>();

    masterItems.forEach(item => {
      const yr = extractYearFromCreatedDate(item.createdDate, item.createdAt);
      if (hiddenYears.has(yr)) return;

      const stockInfo = itemStockMap[item.itemCode];
      const sisaQty = stockInfo ? stockInfo.sisa : 0;
      const hb = Number(item.hargaBeli || stockInfo?.hargaBeli || 0);
      const hj = Number(item.hargaJual || stockInfo?.hargaJual || 0);
      const totalCost = sisaQty * hb;
      const totalCostJual = sisaQty * hj;
      let grp = (item.groupName || 'Tanpa Group').trim();
      if (isDoOpenStatus(grp)) {
        grp = 'Tanpa Group';
      }

      yearsSet.add(yr);
      if (grp) groupsSet.add(grp);

      const key = `${yr}___${grp}`;
      const existing = groupMap.get(key);
      if (existing) {
        existing.itemCount += 1;
        existing.totalQty += sisaQty;
        existing.totalCost += totalCost;
        existing.totalCostJual += totalCostJual;
      } else {
        groupMap.set(key, {
          year: yr,
          groupName: grp,
          itemCount: 1,
          totalQty: sisaQty,
          totalCost: totalCost,
          totalCostJual: totalCostJual
        });
      }
    });

    const sortedYears = Array.from(yearsSet).sort((a, b) => {
      if (a === 'Tanpa Tahun') return 1;
      if (b === 'Tanpa Tahun') return -1;
      return b.localeCompare(a, undefined, { numeric: true });
    });

    const sortedGroups = Array.from(groupsSet).sort((a, b) => a.localeCompare(b));

    return {
      cdGroupedAllRows: Array.from(groupMap.values()),
      cdDetailYearOptions: sortedYears,
      cdDetailGroupOptions: sortedGroups
    };
  }, [masterItems, itemStockMap]);

  const cdDetailFilteredRows = useMemo(() => {
    const q = cdDetailSearch.toLowerCase().trim();
    return cdGroupedAllRows.filter(r => {
      if (cdDetailYear !== 'ALL' && r.year !== cdDetailYear) return false;
      if (cdDetailGroup !== 'ALL' && r.groupName !== cdDetailGroup) return false;
      if (q) {
        const matchGroup = r.groupName.toLowerCase().includes(q);
        const matchYear = r.year.toLowerCase().includes(q);
        if (!matchGroup && !matchYear) return false;
      }
      return true;
    }).sort((a, b) => {
      if (a.year !== b.year) {
        if (a.year === 'Tanpa Tahun') return 1;
        if (b.year === 'Tanpa Tahun') return -1;
        return b.year.localeCompare(a.year, undefined, { numeric: true });
      }
      if (b.totalQty !== a.totalQty) return b.totalQty - a.totalQty;
      return a.groupName.localeCompare(b.groupName);
    });
  }, [cdGroupedAllRows, cdDetailSearch, cdDetailYear, cdDetailGroup]);

  const cdDetailTotals = useMemo(() => {
    return cdDetailFilteredRows.reduce((acc, r) => {
      acc.totalItems += r.itemCount;
      acc.totalQty += r.totalQty;
      acc.totalCost += r.totalCost;
      acc.totalCostJual += r.totalCostJual;
      return acc;
    }, { totalItems: 0, totalQty: 0, totalCost: 0, totalCostJual: 0 });
  }, [cdDetailFilteredRows]);

  const totalCdPages = Math.max(1, Math.ceil(cdDetailFilteredRows.length / cdDetailRowsPerPage));
  const safeCdPage = Math.min(cdDetailPage, totalCdPages);
  const cdDetailPaginatedRows = useMemo(() => {
    const start = (safeCdPage - 1) * cdDetailRowsPerPage;
    return cdDetailFilteredRows.slice(start, start + cdDetailRowsPerPage);
  }, [cdDetailFilteredRows, safeCdPage, cdDetailRowsPerPage]);

  const handleExportCdDetailExcel = () => {
    const exportRows = cdDetailFilteredRows.map(r => ({
      'Tahun (Created Date)': r.year,
      'Group Name': r.groupName,
      'Jumlah Jenis Item': r.itemCount,
      'Total Qty (Pcs)': r.totalQty,
      'Total Cost (Rp)': r.totalCost,
      'Total Nilai Jual (Rp)': r.totalCostJual
    }));

    exportRows.push({
      'Tahun (Created Date)': 'Grand Total',
      'Group Name': `${cdDetailFilteredRows.length} Group`,
      'Jumlah Jenis Item': cdDetailTotals.totalItems,
      'Total Qty (Pcs)': cdDetailTotals.totalQty,
      'Total Cost (Rp)': cdDetailTotals.totalCost,
      'Total Nilai Jual (Rp)': cdDetailTotals.totalCostJual
    });

    exportToExcel(exportRows, `Rekap_Group_CreatedDate_${new Date().toISOString().slice(0, 10)}`);
  };

  const handleExportLocationYearlyExcel = () => {
    const summaryRows = doOpenYearlyByLocation.sortedYears.map(yr => {
      const qc = doOpenYearlyByLocation.qcRows.find(r => r.year === yr);
      const log = doOpenYearlyByLocation.logistikRows.find(r => r.year === yr);
      return {
        'Tahun DO (QC)': yr,
        'Total DO (QC)': qc?.totalDo || 0,
        'Qty (QC)': qc?.qty || 0,
        'Nilai Beli QC (Rp)': qc?.nilaiBeli || 0,
        'Tahun DO (Logistik)': yr,
        'Total DO (Logistik)': log?.totalDo || 0,
        'Qty (Logistik)': log?.qty || 0,
        'Nilai Beli Logistik (Rp)': log?.nilaiBeli || 0,
      };
    });

    summaryRows.push({
      'Tahun DO (QC)': 'Grand Total',
      'Total DO (QC)': doOpenYearlyByLocation.qcTotals.totalDo,
      'Qty (QC)': doOpenYearlyByLocation.qcTotals.qty,
      'Nilai Beli QC (Rp)': doOpenYearlyByLocation.qcTotals.nilaiBeli,
      'Tahun DO (Logistik)': 'Grand Total',
      'Total DO (Logistik)': doOpenYearlyByLocation.logistikTotals.totalDo,
      'Qty (Logistik)': doOpenYearlyByLocation.logistikTotals.qty,
      'Nilai Beli Logistik (Rp)': doOpenYearlyByLocation.logistikTotals.nilaiBeli,
    });

    const formatDetailRow = (r: DoOpenRecord) => {
      const m = masterMap.get(r.itemCode);
      const q = Number(r.qty) || 0;
      const hjSatuan = r.hargaJual !== undefined ? r.hargaJual : (m?.hargaJual || 0);
      const hbSatuan = r.hargaBeli !== undefined ? r.hargaBeli : (m?.hargaBeli || 0);
      const totalHj = q * hjSatuan;
      const totalHb = q * hbSatuan;

      const rawGrp = (r.groupName || m?.groupName || '-').trim();
      const finalGrp = isDoOpenStatus(rawGrp) ? 'Tanpa Group' : (rawGrp || '-');

      return {
        'Posting Date': r.postingDate || '-',
        'Area RM OPR': r.entryName || '-',
        'No DO OPEN': r.documentNo || '-',
        'No DOSL': r.noDosl || '-',
        'Item Code': r.itemCode || '-',
        'Item Name': r.itemName || m?.itemName || '-',
        'Group Name': finalGrp,
        'Status DO OPEN': r.category || '-',
        'Area SPV OPR': r.remark || '-',
        'Qty (Pcs)': q,
        'Harga Jual Satuan (Rp)': hjSatuan,
        'Total Nilai Jual (Rp)': totalHj,
        'Harga Beli Satuan (Rp)': hbSatuan,
        'Total Nilai Beli (Rp)': totalHb,
        'From': r.fromLocation || '-',
        'To': r.toLocation || '-',
        'Keterangan': r.keterangan || '-'
      };
    };

    const qcRecords = doOpen.filter(d => getDoOpenLogistikGroup(d.category) !== 'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)');
    const logistikRecords = doOpen.filter(d => getDoOpenLogistikGroup(d.category) === 'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)');

    const qcDetailRows = qcRecords.map(formatDetailRow);
    const logistikDetailRows = logistikRecords.map(formatDetailRow);

    exportMultiSheetExcel([
      { sheetName: 'Summary Lokasi Per Tahun', data: summaryRows },
      { sheetName: 'Detail DO OPEN - Area QC', data: qcDetailRows },
      { sheetName: 'Detail DO OPEN - Logistik', data: logistikDetailRows }
    ], 'Dashboard_Status_Lokasi_Barang_Per_Tahun');
  };

  return (
    <div className="space-y-6">
      
      {/* Welcome Banner & Quick Action Bar */}
      <div className="bg-slate-900 p-3.5 rounded border border-slate-800 text-white shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.2 bg-blue-500/20 text-blue-300 border border-blue-400/30 text-[10px] font-mono rounded">
              GUDANG REAL-TIME
            </span>
            <h2 className="text-sm md:text-base font-bold text-white">Ringkasan Dashboard Inventory Gudang</h2>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
            Sisa Stock = Total Masuk - Total Keluar | Nilai Sisa Stock = Sisa Stock &times; Harga
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setShowEmailRekapModal(true)}
            className="flex items-center gap-1.5 px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded shadow-xs transition cursor-pointer"
            title="Report Email Rekapitulasi Qty Stock & Nilai Beli Per Tahun (Created Date)"
          >
            <Mail className="w-3.5 h-3.5" />
            Report Email Rekap Per Tahun
          </button>
          <button
            onClick={() => setShowEmailReportModal(true)}
            className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded shadow-xs transition cursor-pointer"
          >
            <Mail className="w-3.5 h-3.5" />
            Report Email Stock Complete
          </button>
          <button
            onClick={() => onOpenImport('transaksi_masuk')}
            className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded shadow-xs transition"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Import Transaksi
          </button>
          <button
            onClick={onRunAutoReconcile}
            className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded shadow-xs transition"
          >
            <GitCompare className="w-3.5 h-3.5" />
            Jalankan Rekonsiliasi
          </button>
        </div>
      </div>

      {/* Core Metric Cards */}
      <div className={`grid grid-cols-2 md:grid-cols-3 ${userRole === 'OPR' ? 'lg:grid-cols-5' : 'lg:grid-cols-6'} gap-2 mb-3`}>
        
        {/* Card 1: Master Items */}
        <div 
          onClick={() => onNavigateTab('master_item')}
          className="bg-white p-2.5 rounded border border-slate-200 shadow-xs hover:border-slate-400 transition cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-slate-500">Master Item</span>
            <div className="p-1 bg-indigo-50 text-indigo-600 rounded">
              <Package className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-1.5">
            <span className="text-lg font-bold text-slate-900 font-mono">{masterItems.length}</span>
            <span className="text-[10px] text-slate-400 block font-mono">Jenis Barang</span>
          </div>
        </div>

        {/* Card 2: Sisa Stock Qty */}
        <div 
          onClick={() => onNavigateTab('sisa_stock')}
          className="bg-white p-2.5 rounded border border-slate-200 shadow-xs hover:border-slate-400 transition cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-slate-500">Sisa Stock Qty</span>
            <div className="p-1 bg-cyan-50 text-cyan-600 rounded">
              <Boxes className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-1.5">
            <span className="text-lg font-bold text-cyan-700 font-mono">{totalSisaStockQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
            <span className="text-[10px] text-slate-400 block font-mono">Fisik Gudang</span>
          </div>
        </div>

        {/* Card 3: Total Nilai Sisa Stock Harga Beli */}
        <div 
          onClick={() => onNavigateTab('sisa_stock')}
          className="bg-white p-2.5 rounded border border-blue-200 bg-blue-50/20 shadow-xs hover:border-blue-400 transition cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-blue-800">Nilai Stock (Harga Beli)</span>
            <div className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-bold font-mono text-[10px]">
              Rp
            </div>
          </div>
          <div className="mt-1.5">
            <span className="text-xs sm:text-sm font-bold text-blue-700 font-mono block leading-tight break-words">
              {formatCurrency(totalNilaiHargaBeli)}
            </span>
            <span className="text-[10px] text-blue-600 block font-mono">Harga Beli &times; Qty</span>
          </div>
        </div>

        {/* Card 4: Total Nilai Sisa Stock Harga Jual */}
        <div
          onClick={() => onNavigateTab('sisa_stock')}
          className="bg-white p-2.5 rounded border border-emerald-200 bg-emerald-50/20 shadow-xs hover:border-emerald-400 transition cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-emerald-800">Nilai Stock (Jual)</span>
            <div className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-bold font-mono text-[10px]">
              Rp
            </div>
          </div>
          <div className="mt-1.5">
            <span className="text-xs sm:text-sm font-bold text-emerald-700 font-mono block leading-tight break-words">
              {formatCurrency(totalNilaiHargaJual)}
            </span>
            <span className="text-[10px] text-emerald-600 block font-mono">Harga Jual &times; Qty</span>
          </div>
        </div>

        {/* Card 5: DO OPEN */}
        <div 
          onClick={() => onNavigateTab('do_open')}
          className="bg-white p-2.5 rounded border border-slate-200 shadow-xs hover:border-slate-400 transition cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-slate-500">DO OPEN Qty</span>
            <div className="p-1 bg-amber-50 text-amber-600 rounded">
              <Clock className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-1.5">
            <span className="text-lg font-bold text-amber-600 font-mono">{totalDoOpenQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
            <span className="text-[10px] text-slate-400 block font-mono">{totalUniqueDoCount.toLocaleString('id-ID', { maximumFractionDigits: 0 })} No DO</span>
          </div>
        </div>

        {/* Card 6: Qty Lepasan */}
        <div 
          onClick={() => onNavigateTab('rekonsiliasi_stock')}
          className="bg-white p-2.5 rounded border border-slate-200 shadow-xs hover:border-slate-400 transition cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-slate-500">Qty Lepasan</span>
            <div className="p-1 bg-purple-50 text-purple-600 rounded">
              <GitCompare className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-1.5">
            <span className="text-lg font-bold text-purple-700 font-mono">{totalQtyLepasan.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
            <span className="text-[10px] text-slate-400 block font-mono">Bebas Alokasi</span>
          </div>
        </div>

      </div>

      {/* DASHBOARD QTY STOCK BERDASARKAN CREATED DATE */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg border border-blue-200 shadow-2xs">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span>Dashboard Qty Stock Berdasarkan CreatedDate</span>
                <span className="px-2 py-0.5 bg-blue-100 text-blue-800 border border-blue-300 rounded text-[10px] font-mono font-bold">
                  Master Item Created Date
                </span>
              </h3>
              <p className="text-xs text-slate-500 font-mono">
                Rekapitulasi Tahun, Total Qty Stock, dan Total Nilai Beli Berdasarkan Tanggal Pembuatan Item (Created Date)
              </p>
            </div>
          </div>

          <button
            onClick={handleExportCreatedDateExcel}
            className="px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg flex items-center gap-1.5 transition shadow-2xs cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Export Excel</span>
          </button>
        </div>

        {/* Summary Stat Badges */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs font-mono">
          <div className="p-2.5 bg-blue-50/60 rounded-xl border border-blue-100">
            <span className="text-[10px] uppercase text-blue-800 font-bold block mb-0.5">Total Tahun Terdata</span>
            <span className="text-base font-extrabold text-blue-900">{createdDateYearlySummary.length} Tahun</span>
          </div>
          <div className="p-2.5 bg-emerald-50/60 rounded-xl border border-emerald-100">
            <span className="text-[10px] uppercase text-emerald-800 font-bold block mb-0.5">Total Qty Stock</span>
            <span className="text-base font-extrabold text-emerald-900">{createdDateTotals.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs</span>
          </div>
          <div className="p-2.5 bg-purple-50/60 rounded-xl border border-purple-100">
            <span className="text-[10px] uppercase text-purple-800 font-bold block mb-0.5">Total Nilai Beli</span>
            <span className="text-base font-extrabold text-purple-900">Rp {createdDateTotals.totalNilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="p-2.5 bg-teal-50/60 rounded-xl border border-teal-100">
            <span className="text-[10px] uppercase text-teal-800 font-bold block mb-0.5">Total Nilai Jual</span>
            <span className="text-base font-extrabold text-teal-900">Rp {createdDateTotals.totalNilaiJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
          </div>
        </div>

        {/* Table Dashboard CreatedDate */}
        <div className="border border-slate-300 rounded-xl overflow-hidden bg-white shadow-xs">
          <div className="bg-slate-900 text-white font-extrabold text-xs p-2.5 text-center border-b border-slate-950 uppercase tracking-wide">
            Tabel Rekapitulasi Qty Stock & Nilai Beli Per Tahun (Created Date)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left data-grid text-xs border-collapse">
              <thead>
                <tr className="bg-blue-50 text-slate-800 font-bold border-b border-slate-300">
                  <th className="p-3 border-r border-slate-200 font-bold text-slate-900">Tahun</th>
                  <th className="p-3 text-right border-r border-slate-200 font-bold text-emerald-900">Total Qty</th>
                  <th className="p-3 text-right border-r border-slate-200 font-bold text-blue-900">Total Nilai Beli</th>
                  <th className="p-3 text-right font-bold text-teal-900">Total Nilai Jual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono">
                {createdDateYearlySummary.map(row => (
                  <tr key={row.year} className="hover:bg-blue-50/50 transition">
                    <td className="p-3 font-bold text-slate-800 border-r border-slate-100">{row.year}</td>
                    <td className="p-3 text-right font-bold text-emerald-700 border-r border-slate-100">
                      {row.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs
                    </td>
                    <td className="p-3 text-right font-bold text-blue-800 border-r border-slate-100">
                      Rp {row.totalNilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="p-3 text-right font-bold text-teal-800">
                      Rp {row.totalNilaiJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-blue-100/90 font-bold text-slate-900 border-t-2 border-blue-300 font-mono text-xs">
                  <td className="p-3 uppercase text-[11px] border-r border-slate-300 font-extrabold text-slate-900">
                    Grand Total
                  </td>
                  <td className="p-3 text-right border-r border-slate-300 text-emerald-900 font-extrabold">
                    {createdDateTotals.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs
                  </td>
                  <td className="p-3 text-right border-r border-slate-300 text-blue-900 font-extrabold">
                    Rp {createdDateTotals.totalNilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="p-3 text-right text-teal-900 font-extrabold">
                    Rp {createdDateTotals.totalNilaiJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* TABEL RINCIAN BARANG BERDASARKAN CREATED DATE & GROUP NAME */}
        <div className="border border-slate-300 rounded-xl overflow-hidden bg-white shadow-xs p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-indigo-50 text-indigo-700 rounded-lg border border-indigo-200">
                <Boxes className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <span>Dashboard Rekapitulasi Group Name Berdasarkan Created Date</span>
                  <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 border border-indigo-300 rounded text-[10px] font-mono font-bold">
                    Rekap Per Group
                  </span>
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  Tabel Rekapitulasi Tahun, Group Name, Total Qty Stock (Pcs), dan Total Cost (Nilai Beli)
                </p>
              </div>
            </div>

            <button
              onClick={handleExportCdDetailExcel}
              className="px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg flex items-center gap-1.5 transition shadow-2xs cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Export Excel</span>
            </button>
          </div>

          {/* Search & Filter Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={cdDetailSearch}
                onChange={e => {
                  setCdDetailSearch(e.target.value);
                  setCdDetailPage(1);
                }}
                placeholder="Cari Group Name, Tahun..."
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <select
              value={cdDetailYear}
              onChange={e => {
                setCdDetailYear(e.target.value);
                setCdDetailPage(1);
              }}
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">-- Semua Tahun --</option>
              {cdDetailYearOptions.map(yr => (
                <option key={yr} value={yr}>Tahun {yr}</option>
              ))}
            </select>

            <select
              value={cdDetailGroup}
              onChange={e => {
                setCdDetailGroup(e.target.value);
                setCdDetailPage(1);
              }}
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">-- Semua Group Name --</option>
              {cdDetailGroupOptions.map(grp => (
                <option key={grp} value={grp}>{grp}</option>
              ))}
            </select>
          </div>

          {/* Stat Summary Badges */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs font-mono bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-bold block font-sans">Total Groups</span>
              <span className="text-sm font-extrabold text-slate-900">{cdDetailFilteredRows.length.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Group</span>
            </div>
            <div>
              <span className="text-[10px] text-emerald-700 uppercase font-bold block font-sans">Total Qty Stock</span>
              <span className="text-sm font-extrabold text-emerald-800">{cdDetailTotals.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs</span>
            </div>
            <div>
              <span className="text-[10px] text-blue-700 uppercase font-bold block font-sans">Total Cost (Nilai Beli)</span>
              <span className="text-sm font-extrabold text-blue-900">Rp {cdDetailTotals.totalCost.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
            </div>
            <div>
              <span className="text-[10px] text-teal-700 uppercase font-bold block font-sans">Total Nilai Jual</span>
              <span className="text-sm font-extrabold text-teal-900">Rp {cdDetailTotals.totalCostJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</span>
            </div>
          </div>

          {/* Table */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-indigo-50/80 text-slate-900 font-bold border-b border-slate-300">
                    <th className="p-2.5 border-r border-slate-200 w-28">Tahun</th>
                    <th className="p-2.5 border-r border-slate-200">Group Name</th>
                    <th className="p-2.5 text-right border-r border-slate-200 w-36">Total Qty</th>
                    <th className="p-2.5 text-right border-r border-slate-200 w-44">Total Cost</th>
                    <th className="p-2.5 text-right w-44">Total Nilai Jual</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono">
                  {cdDetailPaginatedRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-slate-400">
                        Tidak ada data rekap group yang cocok dengan filter pencarian.
                      </td>
                    </tr>
                  ) : (
                    cdDetailPaginatedRows.map((r, idx) => (
                      <tr key={`${r.year}-${r.groupName}-${idx}`} className="hover:bg-slate-50 transition">
                        <td className="p-2.5 font-bold text-slate-800 border-r border-slate-100">{r.year}</td>
                        <td className="p-2.5 text-slate-900 font-bold border-r border-slate-100 truncate max-w-md" title={r.groupName}>{r.groupName}</td>
                        <td className="p-2.5 text-right font-bold text-emerald-700 border-r border-slate-100">
                          {r.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs
                        </td>
                        <td className="p-2.5 text-right font-bold text-blue-800 border-r border-slate-100">
                          Rp {r.totalCost.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="p-2.5 text-right font-bold text-teal-800">
                          Rp {r.totalCostJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-indigo-100/90 font-bold text-slate-900 border-t-2 border-indigo-300 font-mono text-xs">
                    <td colSpan={2} className="p-2.5 uppercase text-[11px] border-r border-slate-300 font-extrabold text-slate-900">
                      Grand Total ({cdDetailFilteredRows.length.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Group)
                    </td>
                    <td className="p-2.5 text-right border-r border-slate-300 text-emerald-900 font-extrabold">
                      {cdDetailTotals.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs
                    </td>
                    <td className="p-2.5 text-right border-r border-slate-300 text-blue-900 font-extrabold">
                      Rp {cdDetailTotals.totalCost.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="p-2.5 text-right text-teal-900 font-extrabold">
                      Rp {cdDetailTotals.totalCostJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-slate-600 font-mono">
            <div>
              Menampilkan {cdDetailFilteredRows.length === 0 ? 0 : (safeCdPage - 1) * cdDetailRowsPerPage + 1} - {Math.min(safeCdPage * cdDetailRowsPerPage, cdDetailFilteredRows.length)} dari {cdDetailFilteredRows.length.toLocaleString('id-ID', { maximumFractionDigits: 0 })} group
            </div>

            <div className="flex items-center gap-1">
              <button
                disabled={safeCdPage <= 1}
                onClick={() => setCdDetailPage(prev => Math.max(1, prev - 1))}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Prev</span>
              </button>
              <span className="px-3 py-1 bg-slate-50 border border-slate-200 rounded font-bold">
                {safeCdPage} / {totalCdPages}
              </span>
              <button
                disabled={safeCdPage >= totalCdPages}
                onClick={() => setCdDetailPage(prev => Math.min(totalCdPages, prev + 1))}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* DASHBOARD TOTAL BARANG PER TAHUN (BERDASARKAN POSTING DATE & LOKASI) */}
      <div className="bg-white rounded border border-slate-200 p-3.5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-amber-50 text-amber-600 rounded border border-amber-200">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <span>Dashboard Total Barang Per Tahun</span>
                <span className="px-1.5 py-0.2 bg-amber-100 text-amber-800 border border-amber-300 rounded text-[10px] font-mono">
                  Berdasarkan Posting Date & Lokasi Barang
                </span>
              </h3>
              <p className="text-[10px] text-slate-500 font-mono">
                Rekapitulasi Total DO, Qty, dan Nilai Beli Berdasarkan Tahun Posting Date Dipisahkan Sesuai Lokasi Posisi Barang
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportLocationYearlyExcel}
              className="px-2.5 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded flex items-center gap-1 transition"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export Summary Excel</span>
            </button>
            <div className="text-[10px] font-mono font-bold bg-slate-100 text-slate-700 px-2 py-1 rounded border border-slate-200">
              Total {doOpenYearlyByLocation.sortedYears.length} Tahun
            </div>
          </div>
        </div>

        {/* TWO SIDE-BY-SIDE TABLES (STATUS LOKASI BARANG DI AREA QC vs LOGISTIK) MATCHING SCREENSHOT */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          
          {/* Table 1: Status Lokasi Barang di Area QC */}
          <div className="border border-slate-300 rounded-md overflow-hidden bg-white shadow-xs">
            <div className="bg-amber-500 text-white font-extrabold text-xs p-2 text-center border-b border-amber-600 shadow-xs uppercase tracking-wide">
              Status Lokasi Barang di Area QC
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left data-grid text-[11px] border-collapse">
                <thead>
                  <tr className="bg-amber-50 text-slate-800 font-bold border-b border-slate-300">
                    <th className="p-2 border-r border-slate-200 font-bold text-slate-900">Tahun DO</th>
                    <th className="p-2 text-right border-r border-slate-200 font-bold text-slate-900">Total DO</th>
                    <th className="p-2 text-right border-r border-slate-200 font-bold text-slate-900">Qty</th>
                    <th className="p-2 text-right border-r border-slate-200 font-bold text-amber-900">Nilai Beli</th>
                    <th className="p-2 text-right font-bold text-emerald-800">Nilai Jual</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {doOpenYearlyByLocation.qcRows.map(row => (
                    <tr key={row.year} className="hover:bg-amber-50/40 transition font-mono">
                      <td className="p-2 font-bold text-slate-800 border-r border-slate-100">{row.year}</td>
                      <td className="p-2 text-right text-slate-700 border-r border-slate-100 font-medium">
                        {row.totalDo > 0 ? row.totalDo.toLocaleString('id-ID', { maximumFractionDigits: 0 }) : '-'}
                      </td>
                      <td className="p-2 text-right font-bold text-amber-700 border-r border-slate-100">
                        {row.qty > 0 ? row.qty.toLocaleString('id-ID', { maximumFractionDigits: 0 }) : '-'}
                      </td>
                      <td className="p-2 text-right font-bold text-blue-800 border-r border-slate-100">
                        {row.nilaiBeli > 0 ? `Rp ${row.nilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}` : 'Rp 0'}
                      </td>
                      <td className="p-2 text-right font-bold text-emerald-700">
                        {row.nilaiJual > 0 ? `Rp ${row.nilaiJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}` : 'Rp 0'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-amber-100/90 font-bold text-slate-900 border-t-2 border-amber-300 font-mono text-xs">
                    <td className="p-2 uppercase text-[10px] border-r border-slate-300 font-extrabold text-slate-900">
                      Grand Total
                    </td>
                    <td className="p-2 text-right border-r border-slate-300 text-slate-900 font-extrabold">
                      {doOpenYearlyByLocation.qcTotals.totalDo.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="p-2 text-right border-r border-slate-300 text-amber-900 font-extrabold">
                      {doOpenYearlyByLocation.qcTotals.qty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="p-2 text-right border-r border-slate-300 text-blue-900 font-extrabold">
                      Rp {doOpenYearlyByLocation.qcTotals.nilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="p-2 text-right text-emerald-900 font-extrabold">
                      Rp {doOpenYearlyByLocation.qcTotals.nilaiJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Table 2: Status Lokasi Barang di Area Logistik */}
          <div className="border border-slate-300 rounded-md overflow-hidden bg-white shadow-xs">
            <div className="bg-emerald-600 text-white font-extrabold text-xs p-2 text-center border-b border-emerald-700 shadow-xs uppercase tracking-wide">
              Status Lokasi Barang di Area Logistik
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left data-grid text-[11px] border-collapse">
                <thead>
                  <tr className="bg-emerald-50 text-slate-800 font-bold border-b border-slate-300">
                    <th className="p-2 border-r border-slate-200 font-bold text-slate-900">Tahun DO</th>
                    <th className="p-2 text-right border-r border-slate-200 font-bold text-slate-900">Total DO</th>
                    <th className="p-2 text-right border-r border-slate-200 font-bold text-slate-900">Qty</th>
                    <th className="p-2 text-right border-r border-slate-200 font-bold text-emerald-900">Nilai Beli</th>
                    <th className="p-2 text-right font-bold text-emerald-800">Nilai Jual</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {doOpenYearlyByLocation.logistikRows.map(row => (
                    <tr key={row.year} className="hover:bg-emerald-50/40 transition font-mono">
                      <td className="p-2 font-bold text-slate-800 border-r border-slate-100">{row.year}</td>
                      <td className="p-2 text-right text-slate-700 border-r border-slate-100 font-medium">
                        {row.totalDo > 0 ? row.totalDo.toLocaleString('id-ID', { maximumFractionDigits: 0 }) : '-'}
                      </td>
                      <td className="p-2 text-right font-bold text-emerald-700 border-r border-slate-100">
                        {row.qty > 0 ? row.qty.toLocaleString('id-ID', { maximumFractionDigits: 0 }) : '-'}
                      </td>
                      <td className="p-2 text-right font-bold text-blue-800 border-r border-slate-100">
                        {row.nilaiBeli > 0 ? `Rp ${row.nilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}` : 'Rp 0'}
                      </td>
                      <td className="p-2 text-right font-bold text-emerald-700">
                        {row.nilaiJual > 0 ? `Rp ${row.nilaiJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}` : 'Rp 0'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-emerald-100/90 font-bold text-slate-900 border-t-2 border-emerald-300 font-mono text-xs">
                    <td className="p-2 uppercase text-[10px] border-r border-slate-300 font-extrabold text-slate-900">
                      Grand Total
                    </td>
                    <td className="p-2 text-right border-r border-slate-300 text-slate-900 font-extrabold">
                      {doOpenYearlyByLocation.logistikTotals.totalDo.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="p-2 text-right border-r border-slate-300 text-emerald-900 font-extrabold">
                      {doOpenYearlyByLocation.logistikTotals.qty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="p-2 text-right border-r border-slate-300 text-blue-900 font-extrabold">
                      Rp {doOpenYearlyByLocation.logistikTotals.nilaiBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="p-2 text-right text-emerald-900 font-extrabold">
                      Rp {doOpenYearlyByLocation.logistikTotals.nilaiJual.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

        </div>
      </div>

      {/* DASHBOARD 20 KATEGORI TERBANYAK BERDASARKAN TOTAL SISA STOCK, DO OPEN & QTY */}
      <div className="bg-white rounded border border-slate-200 p-3 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-blue-50 text-blue-600 rounded">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-800">
                Dashboard 20 Kategori Terbanyak Berdasarkan Total Sisa Stock, DO OPEN, & Qty
              </h3>
              <p className="text-[10px] text-slate-500 font-mono">
                Ringkasan Top Kategori: Total Sisa Stock, DO OPEN, Qty Lepasan, beserta Total Qty & Total Nilainya
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-[10px]">
              <span className="text-slate-500 font-medium">Urutkan:</span>
              <select
                value={categorySort}
                onChange={(e) => setCategorySort(e.target.value as any)}
                className="bg-slate-50 border border-slate-200 rounded px-2 py-0.5 text-[10px] font-bold text-slate-700 focus:outline-none"
              >
                <option value="sisa">Total Sisa Stock Qty</option>
                <option value="doOpen">DO OPEN Qty</option>
                <option value="lepasan">Qty Lepasan</option>
                <option value="nilaiBeli">Nilai Harga Beli</option>
              </select>
            </div>

            <div className="flex items-center bg-slate-100 p-0.5 rounded border border-slate-200 text-[10px] font-bold">
              <button
                onClick={() => setCategoryLimit('20')}
                className={`px-2 py-0.5 rounded transition ${categoryLimit === '20' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Top 20
              </button>
              <button
                onClick={() => setCategoryLimit('all')}
                className={`px-2 py-0.5 rounded transition ${categoryLimit === 'all' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Semua ({categoryList.length})
              </button>
            </div>
          </div>
        </div>

        {/* Metric Cards Summary per Displayed Categories */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="p-2 bg-slate-50 border border-slate-200 rounded">
            <span className="text-[10px] text-slate-500 block uppercase font-semibold">Total Sisa Stock</span>
            <span className="text-sm font-bold text-cyan-700 font-mono">
              {displayedTotals.totalSisaQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} <span className="text-[10px] text-slate-500 font-normal">unit</span>
            </span>
          </div>

          <div className="p-2 bg-slate-50 border border-slate-200 rounded">
            <span className="text-[10px] text-slate-500 block uppercase font-semibold">DO OPEN Qty</span>
            <span className="text-sm font-bold text-amber-600 font-mono">
              {displayedTotals.totalDoOpenQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} <span className="text-[10px] text-slate-500 font-normal">unit</span>
            </span>
          </div>

          <div className="p-2 bg-slate-50 border border-slate-200 rounded">
            <span className="text-[10px] text-slate-500 block uppercase font-semibold">Qty Lepasan</span>
            <span className="text-sm font-bold text-purple-700 font-mono">
              {displayedTotals.totalQtyLepasan.toLocaleString('id-ID', { maximumFractionDigits: 0 })} <span className="text-[10px] text-slate-500 font-normal">unit</span>
            </span>
          </div>

          <div className="p-2 bg-blue-50/50 border border-blue-200 rounded">
            <span className="text-[10px] text-blue-800 block uppercase font-semibold">Total Nilai (Harga Beli)</span>
            <span className="text-xs sm:text-sm font-bold text-blue-700 font-mono truncate block">
              {formatCurrency(displayedTotals.totalNilaiBeli)}
            </span>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto pt-1">
          <table className="w-full text-left data-grid text-[11px]">
            <thead>
              <tr className="bg-slate-50 text-slate-700 font-bold">
                <th className="p-2">No</th>
                <th className="p-2">Nama Kategori / Group Name</th>
                <th className="p-2 text-center">Jenis Item</th>
                <th className="p-2 text-right text-cyan-700 font-bold">Total Sisa Stock Qty</th>
                <th className="p-2 text-right text-amber-600 font-bold">DO OPEN Qty</th>
                <th className="p-2 text-right text-purple-700 font-bold">Qty Lepasan</th>
                <th className="p-2 text-right text-blue-700 font-bold">Total Nilai (Harga Beli)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayedCategories.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-slate-400 text-xs">
                    Belum ada data kategori item.
                  </td>
                </tr>
              ) : (
                displayedCategories.map((cat, idx) => (
                  <tr key={cat.groupName} className="hover:bg-slate-50/80 transition">
                    <td className="p-2 font-mono font-bold text-slate-500">{idx + 1}</td>
                    <td className="p-2 font-semibold text-slate-800">
                      <span className="px-1.5 py-0.5 bg-slate-100 text-slate-800 rounded border border-slate-200">
                        {cat.groupName}
                      </span>
                    </td>
                    <td className="p-2 text-center font-mono text-slate-600">{cat.itemCount} item</td>
                    <td className="p-2 text-right font-mono font-bold text-cyan-700 text-xs">
                      {cat.totalSisaQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="p-2 text-right font-mono font-bold text-amber-600 text-xs">
                      {cat.totalDoOpenQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="p-2 text-right font-mono font-bold text-purple-700 text-xs">
                      {cat.totalQtyLepasan.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="p-2 text-right font-mono font-bold text-blue-700">
                      {formatCurrency(cat.totalNilaiBeli)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {displayedCategories.length > 0 && (
              <tfoot>
                <tr className="bg-slate-100 font-bold text-slate-900 border-t-2 border-slate-300">
                  <td colSpan={2} className="p-2 text-right uppercase text-[10px]">
                    Total ({displayedCategories.length} Kategori):
                  </td>
                  <td className="p-2 text-center font-mono text-xs">{displayedTotals.itemCount} item</td>
                  <td className="p-2 text-right font-mono text-cyan-800 text-xs">{displayedTotals.totalSisaQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
                  <td className="p-2 text-right font-mono text-amber-700 text-xs">{displayedTotals.totalDoOpenQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
                  <td className="p-2 text-right font-mono text-purple-800 text-xs">{displayedTotals.totalQtyLepasan.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
                  <td className="p-2 text-right font-mono text-blue-800 text-xs">{formatCurrency(displayedTotals.totalNilaiBeli)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* DASHBOARD DO OPEN BERDASARKAN STATUS DO OPEN (QC VS LOGISTIK) */}
      <div className="bg-white rounded border border-slate-200 p-3 shadow-xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-amber-50 text-amber-600 rounded">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-800">
                Dashboard DO OPEN Berdasarkan Status Group
              </h3>
              <p className="text-[10px] text-slate-500 font-mono">
                Pengelompokan Status DO OPEN: Area QC vs Sudah di Logistik
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigateTab('do_open')}
            className="text-[11px] font-semibold text-blue-600 hover:text-blue-700"
          >
            Buka Menu DO OPEN &rarr;
          </button>
        </div>

        {/* 2 Main Status Group Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Card: BARANG MASIH ADA DI AREA QC */}
          {userRole !== 'OPR' && (
            <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-md flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-amber-800 font-bold text-xs">
                  <ShieldAlert className="w-4 h-4 text-amber-600" />
                  <span>Posisi Barang: BARANG MASIH ADA DI AREA QC</span>
                </div>
                <p className="text-[10px] text-amber-700">
                  Status: BELUM DI RECEIPT LOGISTIK, BELUM SHIPPING KE LOGISTIK
                </p>
                <div className="flex items-center gap-3 pt-1">
                  <span className="text-xs font-bold text-slate-800 font-mono">
                    {countBarangQC} Dokumen DO
                  </span>
                  <span className="text-xs font-bold text-amber-900 font-mono bg-amber-100 px-2 py-0.5 rounded">
                    Total Qty: {qtyBarangQC.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Card: BARANG SUDAH DI LOGISTIK (SIAP KIRIM) */}
          <div className={`p-3 bg-emerald-50/60 border border-emerald-200 rounded-md flex items-center justify-between ${userRole === 'OPR' ? 'md:col-span-2' : ''}`}>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-emerald-800 font-bold text-xs">
                <Truck className="w-4 h-4 text-emerald-600" />
                <span>Posisi Barang: BARANG SUDAH DI LOGISTIK (SIAP KIRIM)</span>
              </div>
              <p className="text-[10px] text-emerald-700">
                Status: DO SUDAH DI LOGISTIK, NOT POSTING SHIPPING
              </p>
              <div className="flex items-center gap-3 pt-1">
                <span className="text-xs font-bold text-slate-800 font-mono">
                  {countBarangLogistik} Dokumen DO
                </span>
                <span className="text-xs font-bold text-emerald-900 font-mono bg-emerald-100 px-2 py-0.5 rounded">
                  Total Qty: {qtyBarangLogistik.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Detailed Breakdown per Status DO OPEN */}
        <div className="pt-2">
          <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1">
            <ListFilter className="w-3.5 h-3.5 text-slate-500" />
            Rincian Per Status DO OPEN (Category)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left data-grid text-[11px]">
              <thead>
                <tr className="bg-slate-50">
                  <th className="p-2">Status DO OPEN (Category)</th>
                  <th className="p-2">Posisi Barang / Logistik Group</th>
                  <th className="p-2 text-center">Jumlah Dokumen DO</th>
                  <th className="p-2 text-right font-bold">Total Qty DO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedDoStatusList.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-4 text-center text-slate-400 text-xs">
                      Tidak ada data DO OPEN saat ini.
                    </td>
                  </tr>
                ) : (
                  sortedDoStatusList.map(st => {
                    const isLogistik = getDoOpenLogistikGroup(st.categoryStatus) === 'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)';
                    return (
                      <tr key={st.categoryStatus} className="hover:bg-slate-50 transition">
                        <td className="p-2 font-semibold text-slate-800">{st.categoryStatus}</td>
                        <td className="p-2">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded border ${
                            isLogistik 
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}>
                            {isLogistik ? <Truck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                            {st.logistikGroup}
                          </span>
                        </td>
                        <td className="p-2 text-center font-mono text-slate-700">{st.docCount} DO</td>
                        <td className="p-2 text-right font-mono font-bold text-slate-900 text-xs">
                          {st.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* Email Stock Report Modal */}
      <EmailStockReportModal
        isOpen={showEmailReportModal}
        onClose={() => setShowEmailReportModal(false)}
        masterItems={masterItems}
        transaksiMasuk={transaksiMasuk}
        transaksiKeluar={transaksiKeluar}
        doOpen={doOpen}
        userRole={userRole}
      />

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
