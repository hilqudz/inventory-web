import React, { useState, useMemo } from 'react';
import { 
  X, 
  Mail, 
  Copy, 
  Check, 
  ExternalLink, 
  Table as TableIcon,
  Calendar,
  Sparkles
} from 'lucide-react';
import { MasterItem, TransactionRecord } from '../types';

interface EmailRekapTahunReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  masterItems: MasterItem[];
  transaksiMasuk: TransactionRecord[];
  transaksiKeluar: TransactionRecord[];
}

export const EmailRekapTahunReportModal: React.FC<EmailRekapTahunReportModalProps> = ({
  isOpen,
  onClose,
  masterItems,
  transaksiMasuk,
  transaksiKeluar
}) => {
  const [copiedText, setCopiedText] = useState(false);
  const [copiedHtml, setCopiedHtml] = useState(false);
  const [copiedSubject, setCopiedSubject] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');

  // Report date formatted
  const reportDate = useMemo(() => {
    return new Date().toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }, []);

  // Format numbers to match screenshot style: (123) for negative, 156,000 for numbers
  const formatQty = (qty: number) => {
    if (qty < 0) {
      return `(${Math.abs(qty).toLocaleString('en-US')})`;
    }
    return qty.toLocaleString('en-US');
  };

  const formatCost = (cost: number) => {
    const roundVal = Math.round(cost);
    if (roundVal < 0) {
      return `(${Math.abs(roundVal).toLocaleString('en-US')})`;
    }
    return roundVal.toLocaleString('en-US');
  };

  // Aggregation logic for Yearly Rekapitulasi Qty Stock & Total Cost
  const rekapData = useMemo(() => {
    const masterMap = new Map<string, MasterItem>();
    masterItems.forEach(m => {
      if (m.itemCode) masterMap.set(m.itemCode, m);
    });

    // Map item stock calculation
    const itemStockMap: Record<string, {
      itemCode: string;
      groupName: string;
      hargaBeli: number;
      year: string;
      masuk: number;
      keluar: number;
    }> = {};

    // 1. Populate from MasterItems
    masterItems.forEach(m => {
      if (!m.itemCode) return;
      const dtStr = m.createdDate || m.createdAt || '';
      const match = dtStr.match(/\b(20\d\d|19\d\d)\b/);
      const yr = match ? match[1] : 'Lainnya';

      itemStockMap[m.itemCode] = {
        itemCode: m.itemCode,
        groupName: (m.groupName || 'Umum').trim(),
        hargaBeli: m.hargaBeli || 0,
        year: yr,
        masuk: 0,
        keluar: 0
      };
    });

    // 2. Populate Transaksi Masuk
    transaksiMasuk.forEach(t => {
      if (!t.itemCode) return;
      if (!itemStockMap[t.itemCode]) {
        const m = masterMap.get(t.itemCode);
        const dtStr = m?.createdDate || m?.createdAt || t.postingDate || t.createdAt || '';
        const match = dtStr.match(/\b(20\d\d|19\d\d)\b/);
        const yr = match ? match[1] : 'Lainnya';

        itemStockMap[t.itemCode] = {
          itemCode: t.itemCode,
          groupName: (m?.groupName || t.category || 'Umum').trim(),
          hargaBeli: m?.hargaBeli || 0,
          year: yr,
          masuk: 0,
          keluar: 0
        };
      }
      itemStockMap[t.itemCode].masuk += (t.qty || 0);
    });

    // 3. Populate Transaksi Keluar
    transaksiKeluar.forEach(t => {
      if (!t.itemCode) return;
      if (!itemStockMap[t.itemCode]) {
        const m = masterMap.get(t.itemCode);
        const dtStr = m?.createdDate || m?.createdAt || t.postingDate || t.createdAt || '';
        const match = dtStr.match(/\b(20\d\d|19\d\d)\b/);
        const yr = match ? match[1] : 'Lainnya';

        itemStockMap[t.itemCode] = {
          itemCode: t.itemCode,
          groupName: (m?.groupName || t.category || 'Umum').trim(),
          hargaBeli: m?.hargaBeli || 0,
          year: yr,
          masuk: 0,
          keluar: 0
        };
      }
      itemStockMap[t.itemCode].keluar += (t.qty || 0);
    });

    // Grouping per Year & Group Name
    const yearGroupMap = new Map<string, Map<string, { totalQty: number; totalCost: number }>>();

    Object.values(itemStockMap).forEach(item => {
      const sisaQty = item.masuk - item.keluar;
      const totalCostVal = sisaQty * item.hargaBeli;

      if (!yearGroupMap.has(item.year)) {
        yearGroupMap.set(item.year, new Map());
      }
      const grpMap = yearGroupMap.get(item.year)!;
      const existing = grpMap.get(item.groupName) || { totalQty: 0, totalCost: 0 };
      existing.totalQty += sisaQty;
      existing.totalCost += totalCostVal;
      grpMap.set(item.groupName, existing);
    });

    const yearlySummary: Array<{ year: string; totalQty: number; totalNilaiBeli: number }> = [];
    const yearlyDetails: Array<{
      year: string;
      rows: Array<{ groupName: string; totalQty: number; totalCost: number }>;
      yearQtySum: number;
      yearCostSum: number;
    }> = [];

    // Sort years ascending (2017, 2018, 2019, ..., 2026 - Tahun Terlama ke Tahun Terbaru)
    const sortedYears = Array.from(yearGroupMap.keys()).sort((a, b) => a.localeCompare(b));

    let grandTotalQty = 0;
    let grandTotalCost = 0;

    sortedYears.forEach(year => {
      const grpMap = yearGroupMap.get(year)!;
      const groupRows: Array<{ groupName: string; totalQty: number; totalCost: number }> = [];

      let yQty = 0;
      let yCost = 0;

      grpMap.forEach((val, groupName) => {
        if (val.totalQty !== 0) { // Filter out zero Qty
          groupRows.push({
            groupName,
            totalQty: val.totalQty,
            totalCost: val.totalCost
          });
          yQty += val.totalQty;
          yCost += val.totalCost;
        }
      });

      if (groupRows.length > 0) {
        // Sort group rows by Qty Descending
        groupRows.sort((a, b) => b.totalQty - a.totalQty);

        yearlySummary.push({
          year,
          totalQty: yQty,
          totalNilaiBeli: yCost
        });

        yearlyDetails.push({
          year,
          rows: groupRows,
          yearQtySum: yQty,
          yearCostSum: yCost
        });

        grandTotalQty += yQty;
        grandTotalCost += yCost;
      }
    });

    return {
      yearlySummary,
      yearlyDetails,
      grandTotalQty,
      grandTotalCost
    };
  }, [masterItems, transaksiMasuk, transaksiKeluar]);

  if (!isOpen) return null;

  const emailSubject = `[LAPORAN REKAPITULASI STOCK PER TAHUN] Rekap Qty Stock & Nilai Beli Per Tahun (Created Date) - ${reportDate}`;

  // Plain Text Version
  const plainTextEmail = `Yth. Manajemen & Tim Audit,

Berikut disampaikan Laporan Rekapitulasi Qty Stock & Nilai Beli Per Tahun (Created Date) per tanggal ${reportDate}:

1. TABEL REKAPITULASI TOTAL QTY STOCK & NILAI BELI PER TAHUN
===================================================================================
Tahun (Created Date)           | Total Qty (Pcs)             | Total Nilai Beli (Rp)
===================================================================================
${rekapData.yearlySummary.map(s => 
  `${s.year.padEnd(30)} | ${formatQty(s.totalQty).padStart(27)} | ${formatCost(s.totalNilaiBeli).padStart(25)}`
).join('\n')}
===================================================================================
Total                          | ${formatQty(rekapData.grandTotalQty).padStart(27)} | ${formatCost(rekapData.grandTotalCost).padStart(25)}
===================================================================================

2. RINCIAN GROUP NAME PER TAHUN (SORTED QTY TERBANYAK)
${rekapData.yearlyDetails.map(yd => `
--- TAHUN ${yd.year} ---
-----------------------------------------------------------------------------------
Group Name                                 | Total Qty (Pcs) | Total Cost (Rp)
-----------------------------------------------------------------------------------
${yd.rows.map(r => `${r.groupName.padEnd(42)} | ${formatQty(r.totalQty).padStart(15)} | ${formatCost(r.totalCost).padStart(15)}`).join('\n')}
-----------------------------------------------------------------------------------
Subtotal Tahun ${yd.year.padEnd(27)} | ${formatQty(yd.yearQtySum).padStart(15)} | ${formatCost(yd.yearCostSum).padStart(15)}
-----------------------------------------------------------------------------------
`).join('\n')}

Catatan:
1. Item/Group dengan Total Qty Nol (0) tidak ditampilkan.
2. Data rincian per tahun diurutkan dari Total Qty Terbesar hingga Terkecil.

Demikian laporan ini disampaikan. Terima kasih.
Sistem Inventory Gudang 2026`;

  // HTML Email Version for direct copy-paste to Gmail / Outlook / Thunderbird
  const htmlEmailReport = `<div style="font-family: Calibri, Arial, sans-serif; font-size: 14px; color: #111827; max-width: 800px; margin: 0 auto; padding: 10px;">
  <p style="margin-bottom: 12px; font-size: 14px; color: #1f2937;">Yth. Manajemen & Tim Audit,</p>
  <p style="margin-bottom: 20px; font-size: 14px; color: #1f2937;">Berikut disampaikan <strong>Laporan Rekapitulasi Qty Stock &amp; Nilai Beli Per Tahun (Created Date)</strong> per tanggal <strong>${reportDate}</strong>:</p>

  <!-- SUMMARY TABLE -->
  <div style="margin-bottom: 28px;">
    <h3 style="font-size: 15px; font-weight: bold; color: #0f172a; margin-bottom: 8px; border-bottom: 2px solid #0284c7; padding-bottom: 4px;">
      1. TABEL REKAPITULASI QTY STOCK &amp; NILAI BELI PER TAHUN (CREATED DATE)
    </h3>
    <table style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; font-size: 13px; border: 1px solid #000000;">
      <thead>
        <tr style="background-color: #0f172a; color: #ffffff; font-weight: bold; text-align: left;">
          <th style="border: 1px solid #000000; padding: 8px 12px; font-size: 13px;">Tahun (Created Date)</th>
          <th style="border: 1px solid #000000; padding: 8px 12px; font-size: 13px; text-align: right;">Total Qty (Pcs)</th>
          <th style="border: 1px solid #000000; padding: 8px 12px; font-size: 13px; text-align: right;">Total Nilai Beli (Rp)</th>
        </tr>
      </thead>
      <tbody>
        ${rekapData.yearlySummary.map((sum, idx) => `
          <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
            <td style="border: 1px solid #000000; padding: 7px 12px; font-weight: bold; color: #000000;">${sum.year}</td>
            <td style="border: 1px solid #000000; padding: 7px 12px; text-align: right; font-family: monospace, monospace; color: #000000; font-weight: bold;">${formatQty(sum.totalQty)}</td>
            <td style="border: 1px solid #000000; padding: 7px 12px; text-align: right; font-family: monospace, monospace; color: #000000; font-weight: bold;">${formatCost(sum.totalNilaiBeli)}</td>
          </tr>
        `).join('')}
      </tbody>
      <tfoot>
        <tr style="background-color: #e2e8f0; font-weight: bold; color: #000000;">
          <td style="border: 1px solid #000000; padding: 9px 12px; text-align: center; font-size: 14px;"><strong>Total Seluruh Tahun</strong></td>
          <td style="border: 1px solid #000000; padding: 9px 12px; text-align: right; font-family: monospace, monospace; font-size: 14px;"><strong>${formatQty(rekapData.grandTotalQty)}</strong></td>
          <td style="border: 1px solid #000000; padding: 9px 12px; text-align: right; font-family: monospace, monospace; font-size: 14px;"><strong>${formatCost(rekapData.grandTotalCost)}</strong></td>
        </tr>
      </tfoot>
    </table>
  </div>

  <!-- SEPARATE DETAILED TABLES PER YEAR -->
  <div style="margin-bottom: 20px;">
    <h3 style="font-size: 15px; font-weight: bold; color: #0f172a; margin-bottom: 12px; border-bottom: 2px solid #d97706; padding-bottom: 4px;">
      2. RINCIAN GROUP NAME STOCK PER TAHUN (DIPISAH PER TAHUN &amp; SORTED QTY TERBANYAK)
    </h3>

    ${rekapData.yearlyDetails.map((yd) => `
      <div style="margin-bottom: 24px; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; background-color: #ffffff;">
        <div style="background-color: #1e293b; color: #ffffff; padding: 8px 12px; font-weight: bold; font-size: 14px; display: flex; justify-content: space-between; align-items: center;">
          <span>Rincian Group Name Stock - Tahun ${yd.year}</span>
          <span style="font-size: 12px; font-weight: normal; color: #cbd5e1;">(${yd.rows.length} Group Name)</span>
        </div>
        <table style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; font-size: 13px;">
          <thead>
            <tr style="background-color: #f1f5f9; color: #0f172a; font-weight: bold; text-align: left;">
              <th style="border: 1px solid #cbd5e1; padding: 7px 12px; font-size: 12px;">Group Name</th>
              <th style="border: 1px solid #cbd5e1; padding: 7px 12px; font-size: 12px; text-align: right;">Total Qty (Pcs)</th>
              <th style="border: 1px solid #cbd5e1; padding: 7px 12px; font-size: 12px; text-align: right;">Total Cost (Rp)</th>
            </tr>
          </thead>
          <tbody>
            ${yd.rows.map((row, idx) => `
              <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                <td style="border: 1px solid #cbd5e1; padding: 6px 12px; color: #0f172a;">${row.groupName}</td>
                <td style="border: 1px solid #cbd5e1; padding: 6px 12px; text-align: right; font-family: monospace, monospace; color: #000000; font-weight: 600;">${formatQty(row.totalQty)}</td>
                <td style="border: 1px solid #cbd5e1; padding: 6px 12px; text-align: right; font-family: monospace, monospace; color: #000000;">${formatCost(row.totalCost)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr style="background-color: #f8fafc; font-weight: bold; color: #0f172a; border-top: 2px solid #0f172a;">
              <td style="border: 1px solid #cbd5e1; padding: 7px 12px; text-align: center; font-size: 13px;"><strong>Subtotal Tahun ${yd.year}</strong></td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 12px; text-align: right; font-family: monospace, monospace; font-size: 13px;"><strong>${formatQty(yd.yearQtySum)}</strong></td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 12px; text-align: right; font-family: monospace, monospace; font-size: 13px;"><strong>${formatCost(yd.yearCostSum)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `).join('')}
  </div>

  <div style="background-color: #f3f4f6; border-left: 4px solid #3b82f6; padding: 10px 14px; font-size: 12px; color: #4b5563; margin-top: 15px;">
    <strong>Catatan Laporan:</strong><br/>
    &bull; Qty Nol (0) otomatis tidak ditampilkan di dalam report.<br/>
    &bull; Data rincian per tahun diurutkan dari Qty Terbesar ke Qty Terkecil.<br/>
    &bull; Laporan di-generate otomatis dari Sistem Aplikasi Inventory Gudang GZ 2026.
  </div>
</div>`;

  const handleCopyHtml = async () => {
    try {
      const blobHtml = new Blob([htmlEmailReport], { type: 'text/html' });
      const blobText = new Blob([plainTextEmail], { type: 'text/plain' });
      const data = [new ClipboardItem({
        'text/html': blobHtml,
        'text/plain': blobText
      })];
      await navigator.clipboard.write(data);
      setCopiedHtml(true);
      setTimeout(() => setCopiedHtml(false), 3000);
    } catch {
      await navigator.clipboard.writeText(htmlEmailReport);
      setCopiedHtml(true);
      setTimeout(() => setCopiedHtml(false), 3000);
    }
  };

  const handleCopyText = async () => {
    await navigator.clipboard.writeText(plainTextEmail);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 3000);
  };

  const handleCopySubject = async () => {
    await navigator.clipboard.writeText(emailSubject);
    setCopiedSubject(true);
    setTimeout(() => setCopiedSubject(false), 3000);
  };

  const handleOpenMailClient = () => {
    const encodedSubj = encodeURIComponent(emailSubject);
    const encodedBody = encodeURIComponent(plainTextEmail);
    window.open(`mailto:${recipientEmail}?subject=${encodedSubj}&body=${encodedBody}`, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-xs p-3 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        
        {/* Modal Header */}
        <div className="p-4 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/20 border border-amber-400/40 rounded-xl text-amber-300">
              <Mail className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-extrabold flex items-center gap-2">
                <span>Report Email Rekapitulasi Stock Per Tahun</span>
                <span className="px-2 py-0.5 bg-amber-500/30 text-amber-200 border border-amber-400/30 text-[10px] font-mono rounded-full">
                  Created Date
                </span>
              </h2>
              <p className="text-xs text-slate-300 mt-0.5">
                Rincian Qty Stock & Nilai Beli Per Tahun (Diurutkan Qty Terbesar → Terkecil)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Email Settings Controls Bar */}
        <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex-1 space-y-1">
            <label className="text-[11px] font-bold text-slate-700 block">Subjek Email:</label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                readOnly
                value={emailSubject}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800"
              />
              <button
                onClick={handleCopySubject}
                className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg shrink-0 flex items-center gap-1 transition"
                title="Salin Subjek Email"
              >
                {copiedSubject ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedSubject ? 'Tersalin' : 'Salin'}</span>
              </button>
            </div>
          </div>

          <div className="w-full sm:w-64 space-y-1">
            <label className="text-[11px] font-bold text-slate-700 block">Email Penerima (Opsional):</label>
            <input
              type="email"
              placeholder="management@company.com"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-800"
            />
          </div>
        </div>

        {/* Copy Action Buttons Header */}
        <div className="p-3 bg-amber-50/80 border-b border-amber-200/80 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 text-xs text-amber-900 font-semibold">
            <Sparkles className="w-4 h-4 text-amber-600" />
            <span>Format email langsung siap dipaste ke Gmail, Outlook, atau Mail Client.</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleCopyHtml}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-xs transition cursor-pointer"
            >
              {copiedHtml ? <Check className="w-4 h-4" /> : <TableIcon className="w-4 h-4" />}
              <span>{copiedHtml ? 'Format HTML Tersalin!' : 'Salin Format Email (HTML)'}</span>
            </button>

            <button
              onClick={handleCopyText}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-xs transition cursor-pointer"
            >
              {copiedText ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copiedText ? 'Teks Tersalin!' : 'Salin Teks Plain'}</span>
            </button>

            <button
              onClick={handleOpenMailClient}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-xs transition cursor-pointer"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Buka Mail Client</span>
            </button>
          </div>
        </div>

        {/* Main Content Area - Table Preview */}
        <div className="p-4 overflow-y-auto flex-1 space-y-5 bg-slate-50/50">
          
          {/* 1. Summary Table Card */}
          <div className="bg-white p-4 rounded-xl border border-slate-300 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-sky-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  1. Tabel Rekapitulasi Qty Stock & Nilai Beli Per Tahun (Created Date)
                </h3>
              </div>
              <span className="text-xs font-mono font-semibold text-sky-700 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
                {rekapData.yearlySummary.length} Tahun Data
              </span>
            </div>

            <div className="overflow-x-auto border border-slate-900 rounded">
              <table className="w-full text-left border-collapse font-sans text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-900 text-white font-bold">
                    <th className="p-2.5 border-r border-slate-700 font-extrabold">
                      Tahun (Created Date)
                    </th>
                    <th className="p-2.5 border-r border-slate-700 font-extrabold text-right">
                      Total Qty (Pcs)
                    </th>
                    <th className="p-2.5 font-extrabold text-right">
                      Total Nilai Beli (Rp)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rekapData.yearlySummary.map((sum, idx) => (
                    <tr 
                      key={sum.year}
                      className={`border-b border-slate-300 hover:bg-slate-50 transition ${idx % 2 === 1 ? 'bg-slate-50/60' : 'bg-white'}`}
                    >
                      <td className="p-2.5 border-r border-slate-300 font-bold text-slate-900">
                        {sum.year}
                      </td>
                      <td className="p-2.5 border-r border-slate-300 text-right font-mono font-bold text-slate-900">
                        {formatQty(sum.totalQty)}
                      </td>
                      <td className="p-2.5 text-right font-mono font-bold text-slate-900">
                        {formatCost(sum.totalNilaiBeli)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-200 font-extrabold border-t-2 border-slate-900 text-slate-950">
                    <td className="p-3 text-center border-r border-slate-900 text-sm font-bold">
                      Total Seluruh Tahun
                    </td>
                    <td className="p-3 border-r border-slate-900 text-right font-mono text-sm font-bold">
                      {formatQty(rekapData.grandTotalQty)}
                    </td>
                    <td className="p-3 text-right font-mono text-sm font-bold">
                      {formatCost(rekapData.grandTotalCost)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* 2. Separate Detailed Tables Per Year Card */}
          <div className="bg-white p-4 rounded-xl border border-slate-300 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <TableIcon className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  2. Rincian Group Name Stock Per Tahun (Dipisah Per Tahun & Diurutkan Qty Terbanyak)
                </h3>
              </div>
              <span className="text-xs font-mono font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                Sorted Qty Descending
              </span>
            </div>

            <div className="space-y-4">
              {rekapData.yearlyDetails.map((yd) => (
                <div key={yd.year} className="border border-slate-300 rounded-lg overflow-hidden bg-white shadow-2xs">
                  <div className="bg-slate-800 text-white px-3 py-2 flex items-center justify-between">
                    <span className="font-bold text-xs sm:text-sm">
                      Rincian Group Name Stock — Tahun {yd.year}
                    </span>
                    <span className="text-[11px] font-mono text-slate-300 bg-slate-700 px-2 py-0.5 rounded">
                      {yd.rows.length} Group Name
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse font-sans text-xs sm:text-sm">
                      <thead>
                        <tr className="bg-slate-100 text-slate-800 font-bold border-b border-slate-300">
                          <th className="p-2 border-r border-slate-300 font-bold">Group Name</th>
                          <th className="p-2 border-r border-slate-300 font-bold text-right">Total Qty (Pcs)</th>
                          <th className="p-2 font-bold text-right">Total Cost (Rp)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {yd.rows.map((row, idx) => (
                          <tr 
                            key={`${yd.year}_${row.groupName}_${idx}`}
                            className={`border-b border-slate-200 hover:bg-slate-50 transition ${idx % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'}`}
                          >
                            <td className="p-2 border-r border-slate-200 font-medium text-slate-800">
                              {row.groupName}
                            </td>
                            <td className="p-2 border-r border-slate-200 text-right font-mono font-semibold text-slate-900">
                              {formatQty(row.totalQty)}
                            </td>
                            <td className="p-2 text-right font-mono text-slate-900">
                              {formatCost(row.totalCost)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-100 font-bold text-slate-900 border-t-2 border-slate-800">
                          <td className="p-2 border-r border-slate-300 text-center font-bold">
                            Subtotal Tahun {yd.year}
                          </td>
                          <td className="p-2 border-r border-slate-300 text-right font-mono font-bold">
                            {formatQty(yd.yearQtySum)}
                          </td>
                          <td className="p-2 text-right font-mono font-bold">
                            {formatCost(yd.yearCostSum)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1">
              <p className="font-bold">Informasi Ketentuan Format Report:</p>
              <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-amber-800">
                <li>Angka Qty yang sudah Nol (0) otomatis disaring/diabaikan.</li>
                <li>Rincian per tahun dipisahkan ke dalam tabel masing-masing dan diurutkan dari <strong>Total Qty Terbesar ke Terkecil</strong>.</li>
                <li>Format angka negatif menggunakan kurung seperti <code>(2)</code> dan <code>(47,894)</code> sesuai standar laporan akuntansi.</li>
              </ul>
            </div>

          </div>

        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-slate-100 border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
          <div className="text-[11px] text-slate-500 font-medium">
            Gunakan tombol <strong>&quot;Salin Format Email (HTML)&quot;</strong> untuk hasil terbaik di email client.
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-300 hover:bg-slate-400 text-slate-800 font-bold text-xs rounded-lg transition cursor-pointer"
          >
            Tutup
          </button>
        </div>

      </div>
    </div>
  );
};
