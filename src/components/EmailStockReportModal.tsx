import React, { useState, useMemo } from 'react';
import { 
  X, 
  Mail, 
  Copy, 
  Check, 
  ExternalLink, 
  FileText,
  Table as TableIcon,
  Sparkles
} from 'lucide-react';
import { MasterItem, TransactionRecord, DoOpenRecord, getDoOpenLogistikGroup } from '../types';

interface EmailStockReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  masterItems: MasterItem[];
  transaksiMasuk: TransactionRecord[];
  transaksiKeluar: TransactionRecord[];
  doOpen: DoOpenRecord[];
  userRole?: string;
}

export const EmailStockReportModal: React.FC<EmailStockReportModalProps> = ({
  isOpen,
  onClose,
  masterItems,
  transaksiMasuk,
  transaksiKeluar,
  doOpen,
  userRole
}) => {
  const [copiedText, setCopiedText] = useState(false);
  const [copiedHtml, setCopiedHtml] = useState(false);
  const [copiedSubject, setCopiedSubject] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [activeTab, setActiveTab] = useState<'preview' | 'text'>('preview');

  const formatCurrency = (val: number) => 'Rp ' + Math.round(val).toLocaleString('id-ID', { maximumFractionDigits: 0 });

  // Today Date formatted
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

  // Calculate All Metrics
  const reportData = useMemo(() => {
    const masterMap = new Map<string, MasterItem>();
    masterItems.forEach(m => {
      if (m.itemCode) masterMap.set(m.itemCode, m);
    });

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
    }> = {};

    // Populate from Master
    masterItems.forEach(m => {
      if (!m.itemCode) return;
      itemStockMap[m.itemCode] = {
        itemCode: m.itemCode,
        itemName: m.itemName,
        groupName: m.groupName || 'Umum',
        hargaJual: m.hargaJual || 0,
        hargaBeli: m.hargaBeli || 0,
        masuk: 0,
        keluar: 0,
        sisa: 0,
        doOpenQty: 0,
        qtyLepasan: 0
      };
    });

    // Populate Transaksi Masuk
    transaksiMasuk.forEach(t => {
      if (!t.itemCode) return;
      if (!itemStockMap[t.itemCode]) {
        const m = masterMap.get(t.itemCode);
        itemStockMap[t.itemCode] = {
          itemCode: t.itemCode,
          itemName: m?.itemName || t.itemCode,
          groupName: m?.groupName || 'Umum',
          hargaJual: m?.hargaJual || 0,
          hargaBeli: m?.hargaBeli || 0,
          masuk: 0,
          keluar: 0,
          sisa: 0,
          doOpenQty: 0,
          qtyLepasan: 0
        };
      }
      itemStockMap[t.itemCode].masuk += (t.qty || 0);
    });

    // Populate Transaksi Keluar
    transaksiKeluar.forEach(t => {
      if (!t.itemCode) return;
      if (!itemStockMap[t.itemCode]) {
        const m = masterMap.get(t.itemCode);
        itemStockMap[t.itemCode] = {
          itemCode: t.itemCode,
          itemName: m?.itemName || t.itemCode,
          groupName: m?.groupName || 'Umum',
          hargaJual: m?.hargaJual || 0,
          hargaBeli: m?.hargaBeli || 0,
          masuk: 0,
          keluar: 0,
          sisa: 0,
          doOpenQty: 0,
          qtyLepasan: 0
        };
      }
      itemStockMap[t.itemCode].keluar += (t.qty || 0);
    });

    // Populate DO OPEN per Item
    doOpen.forEach(d => {
      if (!d.itemCode) return;
      if (!itemStockMap[d.itemCode]) {
        const m = masterMap.get(d.itemCode);
        itemStockMap[d.itemCode] = {
          itemCode: d.itemCode,
          itemName: m?.itemName || d.itemCode,
          groupName: m?.groupName || d.category || 'Umum',
          hargaJual: m?.hargaJual || 0,
          hargaBeli: m?.hargaBeli || 0,
          masuk: 0,
          keluar: 0,
          sisa: 0,
          doOpenQty: 0,
          qtyLepasan: 0
        };
      }
      itemStockMap[d.itemCode].doOpenQty += (d.qty || 0);
    });

    // Totals Point 1: Total Sisa Stock
    let totalSisaStockQty = 0;
    let totalNilaiHargaJual = 0;
    let totalNilaiHargaBeli = 0;

    Object.values(itemStockMap).forEach(item => {
      item.sisa = item.masuk - item.keluar;
      item.qtyLepasan = Math.max(0, item.sisa - item.doOpenQty);

      totalSisaStockQty += item.sisa;
      totalNilaiHargaJual += item.sisa * item.hargaJual;
      totalNilaiHargaBeli += item.sisa * item.hargaBeli;
    });

    // Totals Point 2: Total DO OPEN & Status Breakdown
    const uniqueDoOpenDocSet = new Set<string>();
    let totalDoOpenQty = 0;
    let totalNilaiJualDoOpen = 0;
    let totalNilaiBeliDoOpen = 0;

    type PosisiKey = 'BARANG MASIH ADA DI AREA QC' | 'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)';

    const doPosisiMap: Record<PosisiKey, {
      posisiName: PosisiKey;
      docSet: Set<string>;
      totalQty: number;
      totalNilaiJual: number;
      totalNilaiBeli: number;
      statusMap: Record<string, {
        statusName: string;
        docSet: Set<string>;
        totalQty: number;
        totalNilaiJual: number;
        totalNilaiBeli: number;
      }>;
    }> = {
      'BARANG MASIH ADA DI AREA QC': {
        posisiName: 'BARANG MASIH ADA DI AREA QC',
        docSet: new Set<string>(),
        totalQty: 0,
        totalNilaiJual: 0,
        totalNilaiBeli: 0,
        statusMap: {}
      },
      'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)': {
        posisiName: 'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)',
        docSet: new Set<string>(),
        totalQty: 0,
        totalNilaiJual: 0,
        totalNilaiBeli: 0,
        statusMap: {}
      }
    };

    const doStatusMap: Record<string, {
      statusName: string;
      docSet: Set<string>;
      totalQty: number;
      totalNilaiJual: number;
      totalNilaiBeli: number;
    }> = {};

    // Totals Point 3: DO OPEN Breakdown per Area RM & Status DO OPEN
    const doAreaRmMap: Record<string, {
      areaRmName: string;
      docSet: Set<string>;
      totalQty: number;
      totalNilaiJual: number;
      totalNilaiBeli: number;
      statusMap: Record<string, {
        statusName: string;
        docSet: Set<string>;
        totalQty: number;
        totalNilaiJual: number;
        totalNilaiBeli: number;
      }>;
    }> = {};

    // Filter for OPR role
    const targetDoOpen = userRole === 'OPR'
      ? doOpen.filter(d => getDoOpenLogistikGroup(d.category) === 'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)')
      : doOpen;

    targetDoOpen.forEach(d => {
      const q = d.qty || 0;
      const docNo = (d.documentNo || '').trim().toUpperCase();
      const m = masterMap.get(d.itemCode);
      const hj = m?.hargaJual || 0;
      const hb = m?.hargaBeli || 0;
      const nj = q * hj;
      const nb = q * hb;

      if (docNo) uniqueDoOpenDocSet.add(docNo);
      totalDoOpenQty += q;
      totalNilaiJualDoOpen += nj;
      totalNilaiBeliDoOpen += nb;

      // Posisi Barang breakdown
      const st = (d.category || 'BELUM SHIPPING KE LOGISTIK').trim() || 'BELUM SHIPPING KE LOGISTIK';
      const posKey = getDoOpenLogistikGroup(st);
      const pos = doPosisiMap[posKey];

      if (docNo) pos.docSet.add(docNo);
      pos.totalQty += q;
      pos.totalNilaiJual += nj;
      pos.totalNilaiBeli += nb;

      if (!pos.statusMap[st]) {
        pos.statusMap[st] = {
          statusName: st,
          docSet: new Set<string>(),
          totalQty: 0,
          totalNilaiJual: 0,
          totalNilaiBeli: 0
        };
      }
      if (docNo) pos.statusMap[st].docSet.add(docNo);
      pos.statusMap[st].totalQty += q;
      pos.statusMap[st].totalNilaiJual += nj;
      pos.statusMap[st].totalNilaiBeli += nb;

      // Status breakdown
      if (!doStatusMap[st]) {
        doStatusMap[st] = {
          statusName: st,
          docSet: new Set<string>(),
          totalQty: 0,
          totalNilaiJual: 0,
          totalNilaiBeli: 0
        };
      }
      if (docNo) doStatusMap[st].docSet.add(docNo);
      doStatusMap[st].totalQty += q;
      doStatusMap[st].totalNilaiJual += nj;
      doStatusMap[st].totalNilaiBeli += nb;

      // Area RM breakdown
      const arm = (d.entryName || 'Tanpa Area RM').trim() || 'Tanpa Area RM';
      if (!doAreaRmMap[arm]) {
        doAreaRmMap[arm] = {
          areaRmName: arm,
          docSet: new Set<string>(),
          totalQty: 0,
          totalNilaiJual: 0,
          totalNilaiBeli: 0,
          statusMap: {}
        };
      }
      if (docNo) doAreaRmMap[arm].docSet.add(docNo);
      doAreaRmMap[arm].totalQty += q;
      doAreaRmMap[arm].totalNilaiJual += nj;
      doAreaRmMap[arm].totalNilaiBeli += nb;

      // Nested Status in Area RM
      if (!doAreaRmMap[arm].statusMap[st]) {
        doAreaRmMap[arm].statusMap[st] = {
          statusName: st,
          docSet: new Set<string>(),
          totalQty: 0,
          totalNilaiJual: 0,
          totalNilaiBeli: 0
        };
      }
      if (docNo) doAreaRmMap[arm].statusMap[st].docSet.add(docNo);
      doAreaRmMap[arm].statusMap[st].totalQty += q;
      doAreaRmMap[arm].statusMap[st].totalNilaiJual += nj;
      doAreaRmMap[arm].statusMap[st].totalNilaiBeli += nb;
    });

    const doPosisiList = (Object.values(doPosisiMap) as Array<typeof doPosisiMap[PosisiKey]>)
      .filter(p => userRole !== 'OPR' || p.posisiName === 'BARANG SUDAH DI LOGISTIK (SIAP KIRIM)')
      .map(p => ({
        posisiName: p.posisiName,
        docCount: p.docSet.size,
        totalQty: p.totalQty,
        totalNilaiJual: p.totalNilaiJual,
        totalNilaiBeli: p.totalNilaiBeli,
        statusList: Object.values(p.statusMap).map(s => ({
          statusName: s.statusName,
          docCount: s.docSet.size,
          totalQty: s.totalQty,
          totalNilaiJual: s.totalNilaiJual,
          totalNilaiBeli: s.totalNilaiBeli
        })).sort((a, b) => b.totalQty - a.totalQty)
      }));

    const doStatusList = Object.values(doStatusMap).map(s => ({
      statusName: s.statusName,
      docCount: s.docSet.size,
      totalQty: s.totalQty,
      totalNilaiJual: s.totalNilaiJual,
      totalNilaiBeli: s.totalNilaiBeli
    })).sort((a, b) => b.totalQty - a.totalQty);

    const doAreaRmList = Object.values(doAreaRmMap).map(a => {
      const statusList = Object.values(a.statusMap).map(s => ({
        statusName: s.statusName,
        docCount: s.docSet.size,
        totalQty: s.totalQty,
        totalNilaiJual: s.totalNilaiJual,
        totalNilaiBeli: s.totalNilaiBeli
      })).sort((s1, s2) => s2.totalQty - s1.totalQty);

      return {
        areaRmName: a.areaRmName,
        docCount: a.docSet.size,
        totalQty: a.totalQty,
        totalNilaiJual: a.totalNilaiJual,
        totalNilaiBeli: a.totalNilaiBeli,
        statusList
      };
    }).sort((a, b) => b.totalQty - a.totalQty);

    // Totals Point 4: Sisa Stock Lepasan
    const totalQtyLepasan = Math.max(0, totalSisaStockQty - totalDoOpenQty);
    const totalNilaiJualLepasan = Math.max(0, totalNilaiHargaJual - totalNilaiJualDoOpen);
    const totalNilaiBeliLepasan = Math.max(0, totalNilaiHargaBeli - totalNilaiBeliDoOpen);

    // Totals Point 5: Top 20 Categories
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
      const grp = item.groupName || 'Tanpa Group';
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
      groupCategoryMap[grp].totalNilaiJual += item.sisa * item.hargaJual;
      groupCategoryMap[grp].totalNilaiBeli += item.sisa * item.hargaBeli;
    });

    const top20Categories = Object.values(groupCategoryMap)
      .sort((a, b) => b.totalSisaQty - a.totalSisaQty)
      .slice(0, 20);

    // Summary totals for top 20
    const top20Totals = top20Categories.reduce((acc, c) => ({
      itemCount: acc.itemCount + c.itemCount,
      totalSisaQty: acc.totalSisaQty + c.totalSisaQty,
      totalDoOpenQty: acc.totalDoOpenQty + c.totalDoOpenQty,
      totalQtyLepasan: acc.totalQtyLepasan + c.totalQtyLepasan,
      totalNilaiJual: acc.totalNilaiJual + c.totalNilaiJual,
      totalNilaiBeli: acc.totalNilaiBeli + c.totalNilaiBeli
    }), { itemCount: 0, totalSisaQty: 0, totalDoOpenQty: 0, totalQtyLepasan: 0, totalNilaiJual: 0, totalNilaiBeli: 0 });

    return {
      totalSisaStockQty,
      totalNilaiHargaJual,
      totalNilaiHargaBeli,
      
      uniqueDoOpenDocCount: uniqueDoOpenDocSet.size,
      totalDoOpenQty,
      totalNilaiJualDoOpen,
      totalNilaiBeliDoOpen,
      doPosisiList,
      doStatusList,

      doAreaRmList,

      totalQtyLepasan,
      totalNilaiJualLepasan,
      totalNilaiBeliLepasan,

      top20Categories,
      top20Totals
    };
  }, [masterItems, transaksiMasuk, transaksiKeluar, doOpen]);

  if (!isOpen) return null;

  const emailSubject = `[LAPORAN STOCK GUDANG] Keadaan Stock, DO OPEN, & Sisa Lepasan - ${reportDate}`;

  // Structured Plain Text Email Version with ASCII Tables
  const plainTextEmail = `Yth. Manajemen & Tim Audit,

Berikut adalah LAPORAN RESMI KEADAAN STOCK GUDANG per tanggal ${reportDate}:

==============================================================================================================
1. TABEL RINGKASAN TOTAL SISA STOCK GUDANG (FISIK)
==============================================================================================================
+------------------------------------------+---------------------+-----------------------+
| Keterangan Stock                         | Total Qty (Fisik)   | Total Nilai Beli      |
+------------------------------------------+---------------------+-----------------------+
| Total Sisa Stock Fisik Gudang            | ${reportData.totalSisaStockQty.toLocaleString('id-ID', { maximumFractionDigits: 0 }).padEnd(12)} unit | ${formatCurrency(reportData.totalNilaiHargaBeli).padEnd(21)} |
+------------------------------------------+---------------------+-----------------------+

==============================================================================================================
2. TABEL STATUS DO OPEN BERDASARKAN POSISI BARANG
==============================================================================================================
+----+------------------------------------+------------------------------------+----------------+--------------------+-----------------------+
| No | Posisi Barang / Status DO OPEN     | Sub-status DO OPEN                 | Jumlah No DO   | Total Qty          | Total Nilai Beli      |
+----+------------------------------------+------------------------------------+----------------+--------------------+-----------------------+
${reportData.doPosisiList.length === 0 ? '| -  | Tidak ada DO OPEN                  | -                                  | 0 DO           | 0 unit             | Rp 0                  |' : reportData.doPosisiList.map((pos, i) => {
  const subRows = pos.statusList.map(st => 
    `|    |                                    | ↳ ${st.statusName.padEnd(32)} | ${st.docCount.toString().padEnd(3)} DO        | ${st.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 }).padEnd(11)} unit | ${formatCurrency(st.totalNilaiBeli).padEnd(21)} |`
  ).join('\n');
  const posRow = `| ${(i + 1).toString().padEnd(2)} | POSISI: ${pos.posisiName.padEnd(26)} | [SUBTOTAL POSISI BARANG]           | ${pos.docCount.toString().padEnd(3)} DO        | ${pos.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 }).padEnd(11)} unit | ${formatCurrency(pos.totalNilaiBeli).padEnd(21)} |`;
  return `${posRow}\n${subRows}`;
}).join('\n+----+------------------------------------+------------------------------------+----------------+--------------------+-----------------------+\n')}
+----+------------------------------------+------------------------------------+----------------+--------------------+-----------------------+
| TOTAL ALL POSISI DO OPEN                | ALL SUB-STATUS COMBINED            | ${reportData.uniqueDoOpenDocCount.toString().padEnd(3)} DO        | ${reportData.totalDoOpenQty.toLocaleString('id-ID', { maximumFractionDigits: 0 }).padEnd(11)} unit | ${formatCurrency(reportData.totalNilaiBeliDoOpen).padEnd(21)} |
+----+------------------------------------+------------------------------------+----------------+--------------------+-----------------------+

==============================================================================================================
3. TABEL RINCIAN DO OPEN BERDASARKAN AREA RM (OPR) & STATUS DO OPEN
==============================================================================================================
+----+---------------------------+------------------------------------+----------------+--------------------+-----------------------+
| No | Area RM (OPR)             | Status DO OPEN                     | Jumlah No DO   | Total Qty          | Total Nilai Beli      |
+----+---------------------------+------------------------------------+----------------+--------------------+-----------------------+
${reportData.doAreaRmList.length === 0 ? '| -  | Tidak ada data Area RM    | -                                  | 0 DO           | 0 unit             | Rp 0                  |' : reportData.doAreaRmList.map((arm, i) => {
  const statusRows = arm.statusList.map(st => 
    `|    |                           | ↳ ${st.statusName.padEnd(32)} | ${st.docCount.toString().padEnd(3)} DO        | ${st.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 }).padEnd(11)} unit | ${formatCurrency(st.totalNilaiBeli).padEnd(21)} |`
  ).join('\n');
  const subtotalRow = `| ${(i + 1).toString().padEnd(2)} | AREA RM: ${arm.areaRmName.padEnd(17)} | [SUBTOTAL AREA RM]                 | ${arm.docCount.toString().padEnd(3)} DO        | ${arm.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 }).padEnd(11)} unit | ${formatCurrency(arm.totalNilaiBeli).padEnd(21)} |`;
  return `${subtotalRow}\n${statusRows}`;
}).join('\n+----+---------------------------+------------------------------------+----------------+--------------------+-----------------------+\n')}
+----+---------------------------+------------------------------------+----------------+--------------------+-----------------------+
| TOTAL ALL AREA RM              | ALL STATUS COMBINED                | ${reportData.uniqueDoOpenDocCount.toString().padEnd(3)} DO        | ${reportData.totalDoOpenQty.toLocaleString('id-ID', { maximumFractionDigits: 0 }).padEnd(11)} unit | ${formatCurrency(reportData.totalNilaiBeliDoOpen).padEnd(21)} |
+----+---------------------------+------------------------------------+----------------+--------------------+-----------------------+

==============================================================================================================
4. TABEL TOTAL SISA STOCK LEPASAN (READY STOCK NON-DO)
==============================================================================================================
+------------------------------------------+---------------------+-----------------------+
| Keterangan Stock                         | Total Qty Lepasan   | Total Nilai Beli      |
+------------------------------------------+---------------------+-----------------------+
| Total Sisa Stock Lepasan (Ready Non-DO)  | ${reportData.totalQtyLepasan.toLocaleString('id-ID', { maximumFractionDigits: 0 }).padEnd(12)} unit | ${formatCurrency(reportData.totalNilaiBeliLepasan).padEnd(21)} |
+------------------------------------------+---------------------+-----------------------+

==============================================================================================================
5. TABEL DASHBOARD 20 KATEGORI TERBANYAK
==============================================================================================================
+----+---------------------------+-----------+----------------+---------------+---------------+-----------------------+
| No | Nama Kategori / Group     | Items     | Sisa Stock Qty | DO OPEN Qty   | Qty Lepasan   | Nilai Harga Beli      |
+----+---------------------------+-----------+----------------+---------------+---------------+-----------------------+
${reportData.top20Categories.map((cat, i) => 
  `| ${(i + 1).toString().padEnd(2)} | ${cat.groupName.padEnd(25)} | ${cat.itemCount.toString().padEnd(4)} item | ${cat.totalSisaQty.toLocaleString('id-ID', { maximumFractionDigits: 0 }).padEnd(14)} | ${cat.totalDoOpenQty.toLocaleString('id-ID', { maximumFractionDigits: 0 }).padEnd(13)} | ${cat.totalQtyLepasan.toLocaleString('id-ID', { maximumFractionDigits: 0 }).padEnd(13)} | ${formatCurrency(cat.totalNilaiBeli).padEnd(21)} |`
).join('\n')}
+----+---------------------------+-----------+----------------+---------------+---------------+-----------------------+
| TOTAL TOP 20 KATEGORI          | ${reportData.top20Totals.itemCount.toString().padEnd(4)} item | ${reportData.top20Totals.totalSisaQty.toLocaleString('id-ID', { maximumFractionDigits: 0 }).padEnd(14)} | ${reportData.top20Totals.totalDoOpenQty.toLocaleString('id-ID', { maximumFractionDigits: 0 }).padEnd(13)} | ${reportData.top20Totals.totalQtyLepasan.toLocaleString('id-ID', { maximumFractionDigits: 0 }).padEnd(13)} | ${formatCurrency(reportData.top20Totals.totalNilaiBeli).padEnd(21)} |
+----+---------------------------+-----------+----------------+---------------+---------------+-----------------------+

Laporan ini dihasilkan secara otomatis oleh Sistem Aplikasi Inventory Gudang.
Terima Kasih.`;

  // HTML Raw table format for clipboard copy to Gmail/Outlook
  const generateRichHtmlEmail = () => {
    return `
<div style="font-family: Arial, sans-serif; font-size: 13px; color: #1e293b; max-width: 900px; margin: 0 auto; line-height: 1.5;">
  
  <div style="background-color: #0f172a; color: #ffffff; padding: 16px 20px; border-radius: 8px; margin-bottom: 20px;">
    <div style="font-size: 10px; font-weight: bold; color: #f59e0b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">
      OFFICIAL WAREHOUSE STOCK REPORT
    </div>
    <h2 style="margin: 0 0 6px 0; font-size: 18px; color: #ffffff;">LAPORAN KEADAAN STOCK GUDANG REAL-TIME</h2>
    <div style="font-size: 11px; color: #cbd5e1;">${reportDate}</div>
  </div>

  <p style="margin-bottom: 16px;">Yth. Manajemen & Tim Audit,</p>
  <p style="margin-bottom: 20px;">Berikut adalah rincian lengkap laporan keadaan stock gudang, status DO OPEN, area RM, sisa stock lepasan, serta dashboard top 20 kategori:</p>

  <!-- Point 1 -->
  <h3 style="font-size: 14px; color: #0f172a; border-bottom: 2px solid #0284c7; padding-bottom: 6px; margin-top: 24px; margin-bottom: 10px;">
    1. TOTAL SISA STOCK GUDANG (FISIK)
  </h3>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; border: 1px solid #cbd5e1;">
    <thead>
      <tr style="background-color: #e0f2fe; color: #0369a1; text-align: left;">
        <th style="padding: 10px; border: 1px solid #cbd5e1;">Keterangan</th>
        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: right;">Total Sisa Stock Qty</th>
        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: right;">Total Nilai Harga Beli</th>
      </tr>
    </thead>
    <tbody>
      <tr style="background-color: #ffffff;">
        <td style="padding: 10px; border: 1px solid #cbd5e1; font-weight: bold;">Total Stock Fisik Gudang</td>
        <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #0284c7;">${reportData.totalSisaStockQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit</td>
        <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #1d4ed8;">${formatCurrency(reportData.totalNilaiHargaBeli)}</td>
      </tr>
    </tbody>
  </table>

  <!-- Point 2 -->
  <h3 style="font-size: 14px; color: #0f172a; border-bottom: 2px solid #d97706; padding-bottom: 6px; margin-top: 24px; margin-bottom: 10px;">
    2. TOTAL BARANG DIBUAT DO OPEN BERDASARKAN POSISI BARANG
  </h3>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; border: 1px solid #cbd5e1;">
    <thead>
      <tr style="background-color: #fef3c7; color: #78350f; text-align: left;">
        <th style="padding: 8px; border: 1px solid #cbd5e1; width: 40px; text-align: center;">No</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1;">Posisi Barang / Sub-Status DO OPEN</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: center;">Jumlah No DO</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Total Qty</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Nilai Harga Beli</th>
      </tr>
    </thead>
    <tbody>
      ${reportData.doPosisiList.map((pos, i) => `
      <tr style="background-color: #fde68a; color: #78350f; font-weight: bold; border-top: 2px solid #f59e0b; border-bottom: 2px solid #f59e0b;">
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; color: #78350f;">${i + 1}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; color: #78350f;">📍 POSISI BARANG: ${pos.posisiName}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; color: #92400e; font-weight: bold;">${pos.docCount} DO</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; color: #0f172a; font-weight: bold;">${pos.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; color: #1d4ed8; font-weight: bold;">${formatCurrency(pos.totalNilaiBeli)}</td>
      </tr>
      ${pos.statusList.map(st => `
      <tr style="background-color: #ffffff;">
        <td style="padding: 6px 8px; border: 1px solid #cbd5e1;"></td>
        <td style="padding: 6px 8px 6px 20px; border: 1px solid #cbd5e1; font-weight: 600; color: #334155;">↳ Sub-status: ${st.statusName}</td>
        <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: center; color: #b45309; font-weight: bold;">${st.docCount} DO</td>
        <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold;">${st.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit</td>
        <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: right; color: #1d4ed8; font-weight: bold;">${formatCurrency(st.totalNilaiBeli)}</td>
      </tr>
      `).join('')}
      `).join('')}
    </tbody>
    <tfoot>
      <tr style="background-color: #fef3c7; font-weight: bold; color: #78350f;">
        <td colspan="2" style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">TOTAL ALL POSISI DO OPEN:</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center;">${reportData.uniqueDoOpenDocCount} DO</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">${reportData.totalDoOpenQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; color: #1d4ed8;">${formatCurrency(reportData.totalNilaiBeliDoOpen)}</td>
      </tr>
    </tfoot>
  </table>

  <!-- Point 3 -->
  <h3 style="font-size: 14px; color: #0f172a; border-bottom: 2px solid #4f46e5; padding-bottom: 6px; margin-top: 24px; margin-bottom: 10px;">
    3. RINCIAN DO OPEN BERDASARKAN AREA RM (OPR) & STATUS DO OPEN
  </h3>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; border: 1px solid #cbd5e1;">
    <thead>
      <tr style="background-color: #e0e7ff; color: #3730a3; text-align: left;">
        <th style="padding: 8px; border: 1px solid #cbd5e1;">No</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1;">Area RM (OPR)</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1;">Status DO OPEN</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: center;">Jumlah No DO</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Total Qty</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Nilai Harga Beli</th>
      </tr>
    </thead>
    <tbody>
      ${reportData.doAreaRmList.map((arm, i) => `
      <tr style="background-color: #3730a3; color: #ffffff; font-weight: bold;">
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center;">${i + 1}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1;">AREA RM: ${arm.areaRmName}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; font-style: italic; font-size: 11px; opacity: 0.9;">[SUBTOTAL AREA RM]</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center;">${arm.docCount} DO</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">${arm.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; color: #93c5fd;">${formatCurrency(arm.totalNilaiBeli)}</td>
      </tr>
      ${arm.statusList.map(st => `
      <tr style="background-color: #ffffff;">
        <td style="padding: 6px 8px; border: 1px solid #cbd5e1;"></td>
        <td style="padding: 6px 8px; border: 1px solid #cbd5e1; color: #64748b; font-size: 11px;">↳ Sub-status:</td>
        <td style="padding: 6px 8px; border: 1px solid #cbd5e1; font-weight: 600; color: #1e1b4b;">${st.statusName}</td>
        <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: center; color: #4338ca; font-weight: bold;">${st.docCount} DO</td>
        <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold;">${st.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit</td>
        <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: right; color: #1d4ed8; font-weight: bold;">${formatCurrency(st.totalNilaiBeli)}</td>
      </tr>
      `).join('')}
      `).join('')}
    </tbody>
    <tfoot>
      <tr style="background-color: #e0e7ff; font-weight: bold; color: #3730a3;">
        <td colspan="3" style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">TOTAL ALL AREA RM:</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center;">${reportData.uniqueDoOpenDocCount} DO</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">${reportData.totalDoOpenQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; color: #1d4ed8;">${formatCurrency(reportData.totalNilaiBeliDoOpen)}</td>
      </tr>
    </tfoot>
  </table>

  <!-- Point 4 -->
  <h3 style="font-size: 14px; color: #0f172a; border-bottom: 2px solid #9333ea; padding-bottom: 6px; margin-top: 24px; margin-bottom: 10px;">
    4. TOTAL SISA STOCK LEPASAN (READY STOCK NON-DO)
  </h3>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; border: 1px solid #cbd5e1;">
    <thead>
      <tr style="background-color: #f3e8ff; color: #6b21a8; text-align: left;">
        <th style="padding: 10px; border: 1px solid #cbd5e1;">Keterangan</th>
        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: right;">Total Qty Lepasan</th>
        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: right;">Nilai Harga Beli</th>
      </tr>
    </thead>
    <tbody>
      <tr style="background-color: #ffffff;">
        <td style="padding: 10px; border: 1px solid #cbd5e1; font-weight: bold;">Sisa Stock Lepasan (Ready Stock)</td>
        <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #7e22ce;">${reportData.totalQtyLepasan.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit</td>
        <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #1d4ed8;">${formatCurrency(reportData.totalNilaiBeliLepasan)}</td>
      </tr>
    </tbody>
  </table>

  <!-- Point 5 -->
  <h3 style="font-size: 14px; color: #0f172a; border-bottom: 2px solid #2563eb; padding-bottom: 6px; margin-top: 24px; margin-bottom: 10px;">
    5. DASHBOARD 20 KATEGORI TERBANYAK
  </h3>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; border: 1px solid #cbd5e1;">
    <thead>
      <tr style="background-color: #f1f5f9; color: #0f172a; text-align: left;">
        <th style="padding: 8px; border: 1px solid #cbd5e1;">No</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1;">Nama Kategori / Group</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: center;">Items</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; color: #0369a1;">Sisa Stock Qty</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; color: #b45309;">DO OPEN Qty</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; color: #7e22ce;">Qty Lepasan</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; color: #1d4ed8;">Nilai Harga Beli</th>
      </tr>
    </thead>
    <tbody>
      ${reportData.top20Categories.map((cat, i) => `
      <tr style="background-color: ${i % 2 === 0 ? '#ffffff' : '#f8fafc'};">
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center;">${i + 1}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; font-weight: bold;">${cat.groupName}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center;">${cat.itemCount} item</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #0284c7;">${cat.totalSisaQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #d97706;">${cat.totalDoOpenQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #7e22ce;">${cat.totalQtyLepasan.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #1d4ed8;">${formatCurrency(cat.totalNilaiBeli)}</td>
      </tr>
      `).join('')}
    </tbody>
    <tfoot>
      <tr style="background-color: #e2e8f0; font-weight: bold; color: #0f172a;">
        <td colspan="2" style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">TOTAL TOP 20 KATEGORI:</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center;">${reportData.top20Totals.itemCount} item</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; color: #0369a1;">${reportData.top20Totals.totalSisaQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; color: #b45309;">${reportData.top20Totals.totalDoOpenQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; color: #7e22ce;">${reportData.top20Totals.totalQtyLepasan.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; color: #1d4ed8;">${formatCurrency(reportData.top20Totals.totalNilaiBeli)}</td>
      </tr>
    </tfoot>
  </table>

  <div style="margin-top: 24px; padding-top: 12px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #64748b;">
    Laporan ini di-generate secara otomatis oleh Sistem Aplikasi Inventory Gudang.
  </div>
</div>
    `;
  };

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
            <div className="p-2 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Report Email Keadaan Stock Gudang (Tabel Rapi)</h2>
              <p className="text-xs text-slate-400 font-mono">
                Generator Laporan Email Resmi (Tabel Sisa Stock, DO OPEN, Area RM, Stock Lepasan & Top 20 Kategori)
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <div>
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
                  className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded flex items-center gap-1 shrink-0 transition"
                  title="Salin Subject"
                >
                  {copiedSubject ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSubject ? 'Tersalin' : 'Salin Subject'}</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-0.5">Kirim Ke (Optional Email Tujuan):</label>
              <input
                type="email"
                placeholder="misal: audit@perusahaan.com, manajer@perusahaan.com"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-slate-800 text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-500"
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
                <TableIcon className="w-3.5 h-3.5 text-amber-600" />
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
                {copiedText ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-amber-400" />}
                <span>{copiedText ? 'Teks Tersalin!' : 'Salin Teks (ASCII Table)'}</span>
              </button>

              <button
                onClick={handleOpenMailClient}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-lg shadow-2xs flex items-center gap-1.5 transition"
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
                className="w-full p-3 bg-slate-900 text-emerald-400 font-mono text-[11px] rounded-lg border border-slate-800 focus:outline-none leading-relaxed shadow-inner"
              />
            </div>
          ) : (
            <div className="bg-white border border-slate-300 rounded-xl p-5 shadow-sm space-y-6 text-xs">
              
              {/* Header Email Banner */}
              <div className="bg-slate-900 text-white p-4 rounded-lg border border-slate-800 space-y-1">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-mono text-amber-400 uppercase tracking-wider font-bold">
                    OFFICIAL WAREHOUSE STOCK REPORT
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">{reportDate}</span>
                </div>
                <h1 className="text-base font-extrabold text-white">LAPORAN KEADAAN STOCK GUDANG REAL-TIME</h1>
                <p className="text-[11px] text-slate-300">
                  Rekapitulasi Fisik Gudang, Status DO OPEN, Rincian Area RM, Sisa Stock Lepasan, & Top 20 Kategori
                </p>
              </div>

              {/* Point 1: Total Sisa Stock Qty & Nilai Table */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-1.5">
                  <span className="px-2 py-0.5 bg-cyan-600 text-white font-mono font-bold rounded text-[10px]">1</span>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                    TOTAL SISA STOCK GUDANG (FISIK)
                  </h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border border-slate-200 rounded-lg text-[11px]">
                    <thead>
                      <tr className="bg-cyan-100/70 text-cyan-950 font-bold">
                        <th className="p-2.5 border-b border-cyan-200">Keterangan</th>
                        <th className="p-2.5 text-right border-b border-cyan-200">Total Sisa Stock Qty</th>
                        <th className="p-2.5 text-right border-b border-cyan-200 text-blue-800">Total Nilai Harga Beli</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="bg-white font-semibold">
                        <td className="p-2.5 border-b border-slate-200 text-slate-800">
                          Total Sisa Stock Fisik di Gudang
                        </td>
                        <td className="p-2.5 text-right border-b border-slate-200 font-mono font-bold text-cyan-700 text-xs">
                          {reportData.totalSisaStockQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit
                        </td>
                        <td className="p-2.5 text-right border-b border-slate-200 font-mono font-bold text-blue-700 text-xs">
                          {formatCurrency(reportData.totalNilaiHargaBeli)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Point 2: Total DO OPEN & Status Breakdown Table */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-1.5">
                  <span className="px-2 py-0.5 bg-amber-600 text-white font-mono font-bold rounded text-[10px]">2</span>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                    TOTAL BARANG DIBUAT DO OPEN BERDASARKAN POSISI BARANG
                  </h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border border-slate-200 rounded-lg text-[11px]">
                    <thead>
                      <tr className="bg-amber-100/70 text-amber-950 font-bold">
                        <th className="p-2 border-b border-amber-200 w-10 text-center">No</th>
                        <th className="p-2 border-b border-amber-200">Posisi Barang / Sub-Status DO OPEN</th>
                        <th className="p-2 text-center border-b border-amber-200">Jumlah No DO</th>
                        <th className="p-2 text-right border-b border-amber-200">Total Qty</th>
                        <th className="p-2 text-right border-b border-amber-200 text-blue-800">Total Nilai Beli</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reportData.doPosisiList.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-3 text-center text-slate-400">
                            Tidak ada data DO OPEN
                          </td>
                        </tr>
                      ) : (
                        reportData.doPosisiList.map((pos, i) => (
                          <React.Fragment key={pos.posisiName}>
                            {/* Posisi Header Row */}
                            <tr className="bg-amber-200/90 text-amber-950 font-bold text-xs border-y border-amber-300">
                              <td className="p-2 text-center font-mono text-amber-900">{i + 1}</td>
                              <td className="p-2 uppercase tracking-wide font-extrabold text-amber-950">📍 POSISI BARANG: {pos.posisiName}</td>
                              <td className="p-2 text-center font-mono text-amber-900 font-bold">{pos.docCount} DO</td>
                              <td className="p-2 text-right font-mono text-slate-900 font-bold">{pos.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit</td>
                              <td className="p-2 text-right font-mono text-blue-800 font-bold">{formatCurrency(pos.totalNilaiBeli)}</td>
                            </tr>
                            {/* Sub-status Rows */}
                            {pos.statusList.map(st => (
                              <tr key={st.statusName} className="bg-white hover:bg-amber-50/50 transition border-b border-slate-100">
                                <td className="p-2"></td>
                                <td className="p-2 font-semibold text-slate-800 pl-4">↳ Sub-status: {st.statusName}</td>
                                <td className="p-2 text-center font-mono font-bold text-amber-800">{st.docCount} DO</td>
                                <td className="p-2 text-right font-mono font-bold text-slate-800">{st.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit</td>
                                <td className="p-2 text-right font-mono font-bold text-blue-700">{formatCurrency(st.totalNilaiBeli)}</td>
                              </tr>
                            ))}
                          </React.Fragment>
                        ))
                      )}
                    </tbody>
                    {reportData.doPosisiList.length > 0 && (
                      <tfoot>
                        <tr className="bg-amber-100/90 font-bold text-amber-950 border-t-2 border-amber-200">
                          <td colSpan={2} className="p-2 text-right uppercase text-[10px]">
                            TOTAL ALL POSISI DO OPEN:
                          </td>
                          <td className="p-2 text-center font-mono">{reportData.uniqueDoOpenDocCount} DO</td>
                          <td className="p-2 text-right font-mono">{reportData.totalDoOpenQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit</td>
                          <td className="p-2 text-right font-mono text-blue-800">{formatCurrency(reportData.totalNilaiBeliDoOpen)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              {/* Point 3: Rincikan Total DO OPEN berdasarkan Area RM & Status Table */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-1.5">
                  <span className="px-2 py-0.5 bg-indigo-600 text-white font-mono font-bold rounded text-[10px]">3</span>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                    RINCIAN DO OPEN BERDASARKAN AREA RM (OPR) & STATUS DO OPEN
                  </h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border border-slate-200 rounded-lg text-[11px]">
                    <thead>
                      <tr className="bg-indigo-100/70 text-indigo-950 font-bold">
                        <th className="p-2 border-b border-indigo-200">No</th>
                        <th className="p-2 border-b border-indigo-200">Area RM (OPR)</th>
                        <th className="p-2 border-b border-indigo-200">Status DO OPEN</th>
                        <th className="p-2 text-center border-b border-indigo-200">Jumlah No DO</th>
                        <th className="p-2 text-right border-b border-indigo-200">Total Qty</th>
                        <th className="p-2 text-right border-b border-indigo-200 text-blue-800">Total Nilai Beli</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reportData.doAreaRmList.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-3 text-center text-slate-400">
                            Tidak ada data Area RM
                          </td>
                        </tr>
                      ) : (
                        reportData.doAreaRmList.map((arm, i) => (
                          <React.Fragment key={arm.areaRmName}>
                            {/* Area RM Group Subtotal Header */}
                            <tr className="bg-indigo-900 text-white font-bold text-xs">
                              <td className="p-2 text-center font-mono">{i + 1}</td>
                              <td className="p-2 uppercase tracking-wide font-extrabold">AREA RM: {arm.areaRmName}</td>
                              <td className="p-2 italic text-indigo-200 font-normal text-[11px]">[SUBTOTAL AREA RM]</td>
                              <td className="p-2 text-center font-mono text-indigo-200">{arm.docCount} DO</td>
                              <td className="p-2 text-right font-mono text-white">{arm.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit</td>
                              <td className="p-2 text-right font-mono text-blue-200">{formatCurrency(arm.totalNilaiBeli)}</td>
                            </tr>
                            {/* Status DO OPEN Sub-rows */}
                            {arm.statusList.map(st => (
                              <tr key={st.statusName} className="bg-white hover:bg-indigo-50/50 transition border-b border-slate-100">
                                <td className="p-2"></td>
                                <td className="p-2 text-slate-400 text-[10px] pl-4">↳ Sub-status:</td>
                                <td className="p-2 font-semibold text-slate-800">{st.statusName}</td>
                                <td className="p-2 text-center font-mono font-bold text-indigo-700">{st.docCount} DO</td>
                                <td className="p-2 text-right font-mono font-bold text-slate-800">{st.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit</td>
                                <td className="p-2 text-right font-mono font-bold text-blue-700">{formatCurrency(st.totalNilaiBeli)}</td>
                              </tr>
                            ))}
                          </React.Fragment>
                        ))
                      )}
                    </tbody>
                    {reportData.doAreaRmList.length > 0 && (
                      <tfoot>
                        <tr className="bg-indigo-100/90 font-bold text-indigo-950 border-t-2 border-indigo-200">
                          <td colSpan={3} className="p-2 text-right uppercase text-[10px]">
                            TOTAL ALL AREA RM:
                          </td>
                          <td className="p-2 text-center font-mono">{reportData.uniqueDoOpenDocCount} DO</td>
                          <td className="p-2 text-right font-mono">{reportData.totalDoOpenQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit</td>
                          <td className="p-2 text-right font-mono text-blue-800">{formatCurrency(reportData.totalNilaiBeliDoOpen)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              {/* Point 4: Total Sisa Stock Lepasan Table */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-1.5">
                  <span className="px-2 py-0.5 bg-purple-600 text-white font-mono font-bold rounded text-[10px]">4</span>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                    TOTAL SISA STOCK LEPASAN (READY STOCK NON-DO)
                  </h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border border-slate-200 rounded-lg text-[11px]">
                    <thead>
                      <tr className="bg-purple-100/70 text-purple-950 font-bold">
                        <th className="p-2.5 border-b border-purple-200">Keterangan</th>
                        <th className="p-2.5 text-right border-b border-purple-200">Total Qty Lepasan</th>
                        <th className="p-2.5 text-right border-b border-purple-200 text-blue-800">Total Nilai Harga Beli</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="bg-white font-semibold">
                        <td className="p-2.5 border-b border-slate-200 text-slate-800">
                          Sisa Stock Ready (Stock Fisik dikurangi DO OPEN)
                        </td>
                        <td className="p-2.5 text-right border-b border-slate-200 font-mono font-bold text-purple-800 text-xs">
                          {reportData.totalQtyLepasan.toLocaleString('id-ID', { maximumFractionDigits: 0 })} unit
                        </td>
                        <td className="p-2.5 text-right border-b border-slate-200 font-mono font-bold text-blue-700 text-xs">
                          {formatCurrency(reportData.totalNilaiBeliLepasan)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Point 5: Dashboard 20 Kategori Terbanyak Table */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-1.5">
                  <span className="px-2 py-0.5 bg-blue-600 text-white font-mono font-bold rounded text-[10px]">5</span>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                    DASHBOARD 20 KATEGORI TERBANYAK BERDASARKAN TOTAL SISA STOCK, DO OPEN, & QTY
                  </h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border border-slate-200 rounded-lg text-[11px]">
                    <thead>
                      <tr className="bg-slate-100 text-slate-800 font-bold">
                        <th className="p-2 border-b border-slate-200">No</th>
                        <th className="p-2 border-b border-slate-200">Nama Kategori / Group Name</th>
                        <th className="p-2 text-center border-b border-slate-200">Items</th>
                        <th className="p-2 text-right border-b border-slate-200 text-cyan-800 font-bold">Sisa Stock Qty</th>
                        <th className="p-2 text-right border-b border-slate-200 text-amber-800 font-bold">DO OPEN Qty</th>
                        <th className="p-2 text-right border-b border-slate-200 text-purple-800 font-bold">Qty Lepasan</th>
                        <th className="p-2 text-right border-b border-slate-200 text-blue-800 font-bold">Nilai Harga Beli</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reportData.top20Categories.map((cat, i) => (
                        <tr key={cat.groupName} className="hover:bg-slate-50 transition">
                          <td className="p-2 font-mono font-bold text-slate-500">{i + 1}</td>
                          <td className="p-2 font-semibold text-slate-800">{cat.groupName}</td>
                          <td className="p-2 text-center font-mono text-slate-600">{cat.itemCount} item</td>
                          <td className="p-2 text-right font-mono font-bold text-cyan-700">{cat.totalSisaQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
                          <td className="p-2 text-right font-mono font-bold text-amber-600">{cat.totalDoOpenQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
                          <td className="p-2 text-right font-mono font-bold text-purple-700">{cat.totalQtyLepasan.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
                          <td className="p-2 text-right font-mono font-bold text-blue-700">{formatCurrency(cat.totalNilaiBeli)}</td>
                        </tr>
                      ))}
                    </tbody>
                    {reportData.top20Categories.length > 0 && (
                      <tfoot>
                        <tr className="bg-slate-100 font-bold text-slate-900 border-t-2 border-slate-300">
                          <td colSpan={2} className="p-2 text-right uppercase text-[10px]">
                            TOTAL TOP 20 KATEGORI:
                          </td>
                          <td className="p-2 text-center font-mono">{reportData.top20Totals.itemCount} item</td>
                          <td className="p-2 text-right font-mono text-cyan-800">{reportData.top20Totals.totalSisaQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
                          <td className="p-2 text-right font-mono text-amber-700">{reportData.top20Totals.totalDoOpenQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
                          <td className="p-2 text-right font-mono text-purple-800">{reportData.top20Totals.totalQtyLepasan.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
                          <td className="p-2 text-right font-mono text-blue-800">{formatCurrency(reportData.top20Totals.totalNilaiBeli)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              {/* Footer text */}
              <div className="pt-3 border-t border-slate-200 text-center text-[10px] text-slate-400 font-mono">
                Laporan ini di-generate secara otomatis oleh Sistem Aplikasi Inventory Gudang &bull; {reportDate}
              </div>

            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-slate-100 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="text-[11px] text-slate-500 font-medium">
            Saran: Gunakan <strong>&quot;Salin Tabel HTML (Gmail/Outlook)&quot;</strong> agar tampilan tabel berwarna langsung tertempel rapi di email.
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-300 hover:bg-slate-400 text-slate-800 font-bold text-xs rounded-lg transition"
          >
            Tutup
          </button>
        </div>

      </div>
    </div>
  );
};
