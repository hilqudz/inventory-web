import React, { useState, useMemo } from 'react';
import { 
  X, 
  Mail, 
  Copy, 
  Check, 
  ExternalLink, 
  FileText,
  Table as TableIcon,
  Sparkles,
  Building2,
  MapPin,
  CheckCircle2,
  Layers,
  BarChart3
} from 'lucide-react';

interface SpvBreakdownItem {
  areaSpv: string;
  docCount: number;
  recordCount: number;
  totalQty: number;
  totalNilaiJual: number;
  totalNilaiBeli: number;
}

interface LocationBreakdownItem {
  locationName: string;
  docCount: number;
  recordCount: number;
  totalQty: number;
  totalNilaiJual: number;
  totalNilaiBeli: number;
}

interface EmailDoOpenReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  spvBreakdown: SpvBreakdownItem[];
  locationBreakdown: LocationBreakdownItem[];
  grandTotals: {
    totalDoc: number;
    totalRecords: number;
    totalQty: number;
    totalNilaiJual: number;
    totalNilaiBeli: number;
  };
}

export const EmailDoOpenReportModal: React.FC<EmailDoOpenReportModalProps> = ({
  isOpen,
  onClose,
  spvBreakdown,
  locationBreakdown,
  grandTotals
}) => {
  const [copiedText, setCopiedText] = useState(false);
  const [copiedHtml, setCopiedHtml] = useState(false);
  const [copiedSubject, setCopiedSubject] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [activeTab, setActiveTab] = useState<'preview' | 'text'>('preview');

  const formatCurrency = (val: number) => 'Rp ' + Math.round(val).toLocaleString('id-ID', { maximumFractionDigits: 0 });

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

  if (!isOpen) return null;

  const emailSubject = `[LAPORAN DO OPEN LOGISTIK] Laporan Barang Logistik Siap Kirim - ${reportDate}`;

  // Plain Text Version
  const plainTextEmail = `Yth. Manajemen, Audit, & Tim Logistik,

Berikut adalah LAPORAN DO OPEN BARANG DI LOGISTIK (SIAP KIRIM) per tanggal ${reportDate}:

==============================================================================================================
1. RINGKASAN TOTAL DO OPEN LOGISTIK
==============================================================================================================
- Total No DO OPEN Logistik : ${grandTotals.totalDoc.toLocaleString('id-ID', { maximumFractionDigits: 0 })} DO
- Total Line Item          : ${grandTotals.totalRecords.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Baris
- Total Qty Barang         : ${grandTotals.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs
- Total Nilai Harga Beli   : ${formatCurrency(grandTotals.totalNilaiBeli)}

==============================================================================================================
2. BREAKDOWN DO OPEN LOGISTIK PER AREA SPV
==============================================================================================================
+----+-----------------------------------+-----------+-------------+---------------+-----------------------+
| No | Area SPV (Remark)                 | Total DO  | Line Item   | Qty (Pcs)     | Nilai Harga Beli      |
+----+-----------------------------------+-----------+-------------+---------------+-----------------------+
${spvBreakdown.map((spv, i) => 
  `| ${(i + 1).toString().padEnd(2)} | ${spv.areaSpv.padEnd(33)} | ${spv.docCount.toString().padEnd(6)} DO | ${spv.recordCount.toString().padEnd(8)} | ${spv.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 }).padEnd(13)} | ${formatCurrency(spv.totalNilaiBeli).padEnd(21)} |`
).join('\n')}
+----+-----------------------------------+-----------+-------------+---------------+-----------------------+
| GRAND TOTAL AREA SPV                   | ${grandTotals.totalDoc.toString().padEnd(6)} DO | ${grandTotals.totalRecords.toString().padEnd(8)} | ${grandTotals.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 }).padEnd(13)} | ${formatCurrency(grandTotals.totalNilaiBeli).padEnd(21)} |
+----+-----------------------------------+-----------+-------------+---------------+-----------------------+

==============================================================================================================
3. BREAKDOWN DO OPEN LOGISTIK PER LOKASI / TUJUAN
==============================================================================================================
+----+-----------------------------------+-----------+-------------+---------------+-----------------------+
| No | Lokasi / Tujuan                   | Total DO  | Line Item   | Qty (Pcs)     | Nilai Harga Beli      |
+----+-----------------------------------+-----------+-------------+---------------+-----------------------+
${locationBreakdown.map((loc, i) => 
  `| ${(i + 1).toString().padEnd(2)} | ${loc.locationName.padEnd(33)} | ${loc.docCount.toString().padEnd(6)} DO | ${loc.recordCount.toString().padEnd(8)} | ${loc.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 }).padEnd(13)} | ${formatCurrency(loc.totalNilaiBeli).padEnd(21)} |`
).join('\n')}
+----+-----------------------------------+-----------+-------------+---------------+-----------------------+
| GRAND TOTAL PER LOKASI                 | ${grandTotals.totalDoc.toString().padEnd(6)} DO | ${grandTotals.totalRecords.toString().padEnd(8)} | ${grandTotals.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 }).padEnd(13)} | ${formatCurrency(grandTotals.totalNilaiBeli).padEnd(21)} |
+----+-----------------------------------+-----------+-------------+---------------+-----------------------+

Laporan ini dihasilkan secara otomatis oleh Sistem Aplikasi Inventory Gudang.
Terima Kasih.`;

  // HTML Rich Email Format
  const generateRichHtmlEmail = () => {
    return `
<div style="font-family: Arial, sans-serif; font-size: 13px; color: #1e293b; max-width: 920px; margin: 0 auto; line-height: 1.5;">
  
  <div style="background-color: #0f172a; color: #ffffff; padding: 18px 24px; border-radius: 10px; margin-bottom: 20px; border-left: 6px solid #f59e0b;">
    <div style="font-size: 11px; font-weight: bold; color: #f59e0b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">
      OFFICIAL LOGISTICS REPORT
    </div>
    <h2 style="margin: 0 0 6px 0; font-size: 18px; color: #ffffff;">LAPORAN DO OPEN (BARANG DI LOGISTIK / SIAP KIRIM)</h2>
    <div style="font-size: 11px; color: #cbd5e1;">Tanggal Laporan: ${reportDate}</div>
  </div>

  <p style="margin-bottom: 16px; color: #334155;">Yth. Manajemen, Audit, & Tim Logistik,</p>
  <p style="margin-bottom: 20px; color: #334155;">Berikut adalah rincian laporan status <strong>DO OPEN</strong> yang posisinya sudah berada di Logistik (Siap Kirim), dikelompokkan berdasarkan Area SPV dan Lokasi Tujuan:</p>

  <!-- Point 1: Global Summary Cards -->
  <h3 style="font-size: 14px; color: #0f172a; border-bottom: 2px solid #f59e0b; padding-bottom: 6px; margin-top: 24px; margin-bottom: 12px; text-transform: uppercase;">
    1. RINGKASAN TOTAL DO OPEN LOGISTIK
  </h3>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 12px; border: 1px solid #cbd5e1;">
    <thead>
      <tr style="background-color: #fef3c7; color: #92400e; text-align: left;">
        <th style="padding: 10px; border: 1px solid #cbd5e1;">Keterangan Metric</th>
        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center;">Jumlah No DO</th>
        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center;">Total Line Item</th>
        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: right;">Total Qty (Pcs)</th>
        <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: right; color: #0891b2;">Total Nilai Harga Beli</th>
      </tr>
    </thead>
    <tbody>
      <tr style="background-color: #ffffff; font-weight: bold;">
        <td style="padding: 12px 10px; border: 1px solid #cbd5e1; color: #0f172a;">Grand Total Barang di Logistik</td>
        <td style="padding: 12px 10px; border: 1px solid #cbd5e1; text-align: center; color: #d97706; font-size: 13px;">${grandTotals.totalDoc.toLocaleString('id-ID', { maximumFractionDigits: 0 })} DO</td>
        <td style="padding: 12px 10px; border: 1px solid #cbd5e1; text-align: center; color: #475569;">${grandTotals.totalRecords.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Baris</td>
        <td style="padding: 12px 10px; border: 1px solid #cbd5e1; text-align: right; color: #b45309; font-size: 13px;">${grandTotals.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })} Pcs</td>
        <td style="padding: 12px 10px; border: 1px solid #cbd5e1; text-align: right; color: #0891b2; font-size: 13px;">${formatCurrency(grandTotals.totalNilaiBeli)}</td>
      </tr>
    </tbody>
  </table>

  <!-- Point 2: Area SPV Breakdown -->
  <h3 style="font-size: 14px; color: #0f172a; border-bottom: 2px solid #0284c7; padding-bottom: 6px; margin-top: 24px; margin-bottom: 12px; text-transform: uppercase;">
    2. BREAKDOWN DO OPEN LOGISTIK PER AREA SPV
  </h3>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 12px; border: 1px solid #cbd5e1;">
    <thead>
      <tr style="background-color: #e0f2fe; color: #0369a1; text-align: left;">
        <th style="padding: 8px 10px; border: 1px solid #cbd5e1; width: 40px; text-align: center;">No</th>
        <th style="padding: 8px 10px; border: 1px solid #cbd5e1;">Area SPV (Remark)</th>
        <th style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center;">Total DO</th>
        <th style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center;">Line Item</th>
        <th style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: right;">Total Qty (Pcs)</th>
        <th style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: right; color: #0891b2;">Total Nilai Harga Beli</th>
      </tr>
    </thead>
    <tbody>
      ${spvBreakdown.map((spv, i) => `
      <tr style="background-color: ${i % 2 === 0 ? '#ffffff' : '#f8fafc'};">
        <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center; color: #64748b;">${i + 1}</td>
        <td style="padding: 8px 10px; border: 1px solid #cbd5e1; font-weight: bold; color: #0f172a;">${spv.areaSpv}</td>
        <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; color: #d97706;">${spv.docCount} DO</td>
        <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center; color: #64748b;">${spv.recordCount}</td>
        <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #b45309;">${spv.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
        <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #0891b2;">${formatCurrency(spv.totalNilaiBeli)}</td>
      </tr>
      `).join('')}
    </tbody>
    <tfoot>
      <tr style="background-color: #e2e8f0; font-weight: bold; color: #0f172a;">
        <td colspan="2" style="padding: 10px; border: 1px solid #cbd5e1; text-align: right; text-transform: uppercase;">Grand Total Area SPV:</td>
        <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; color: #d97706;">${grandTotals.totalDoc} DO</td>
        <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: center;">${grandTotals.totalRecords}</td>
        <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: right; color: #b45309;">${grandTotals.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
        <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: right; color: #0891b2;">${formatCurrency(grandTotals.totalNilaiBeli)}</td>
      </tr>
    </tfoot>
  </table>

  <!-- Point 3: Location Breakdown -->
  <h3 style="font-size: 14px; color: #0f172a; border-bottom: 2px solid #059669; padding-bottom: 6px; margin-top: 24px; margin-bottom: 12px; text-transform: uppercase;">
    3. BREAKDOWN DO OPEN LOGISTIK PER LOKASI / TUJUAN
  </h3>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 12px; border: 1px solid #cbd5e1;">
    <thead>
      <tr style="background-color: #d1fae5; color: #065f46; text-align: left;">
        <th style="padding: 8px 10px; border: 1px solid #cbd5e1; width: 40px; text-align: center;">No</th>
        <th style="padding: 8px 10px; border: 1px solid #cbd5e1;">Lokasi / Tujuan</th>
        <th style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center;">Total DO</th>
        <th style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center;">Line Item</th>
        <th style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: right;">Total Qty (Pcs)</th>
        <th style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: right; color: #0891b2;">Total Nilai Harga Beli</th>
      </tr>
    </thead>
    <tbody>
      ${locationBreakdown.map((loc, i) => `
      <tr style="background-color: ${i % 2 === 0 ? '#ffffff' : '#f8fafc'};">
        <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center; color: #64748b;">${i + 1}</td>
        <td style="padding: 8px 10px; border: 1px solid #cbd5e1; font-weight: bold; color: #0f172a;">${loc.locationName}</td>
        <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; color: #d97706;">${loc.docCount} DO</td>
        <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center; color: #64748b;">${loc.recordCount}</td>
        <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #b45309;">${loc.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
        <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold; color: #0891b2;">${formatCurrency(loc.totalNilaiBeli)}</td>
      </tr>
      `).join('')}
    </tbody>
    <tfoot>
      <tr style="background-color: #e2e8f0; font-weight: bold; color: #0f172a;">
        <td colspan="2" style="padding: 10px; border: 1px solid #cbd5e1; text-align: right; text-transform: uppercase;">Grand Total Per Lokasi:</td>
        <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; color: #d97706;">${grandTotals.totalDoc} DO</td>
        <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: center;">${grandTotals.totalRecords}</td>
        <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: right; color: #b45309;">${grandTotals.totalQty.toLocaleString('id-ID', { maximumFractionDigits: 0 })}</td>
        <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: right; color: #0891b2;">${formatCurrency(grandTotals.totalNilaiBeli)}</td>
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
    <div className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center bg-slate-950/85 backdrop-blur-xs p-1.5 sm:p-3 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-5xl rounded-xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto flex flex-col h-[96dvh] sm:h-auto sm:max-h-[92vh]">
        
        {/* Modal Header */}
        <div className="bg-slate-900 text-white p-3 sm:p-4 flex items-center justify-between border-b border-slate-800 shrink-0 sticky top-0 z-20">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 sm:p-2.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl shrink-0">
              <Mail className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs sm:text-base font-bold text-white flex items-center gap-1.5 flex-wrap">
                <span className="truncate">Report Email DO OPEN (Logistik)</span>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                  {grandTotals.totalDoc} DO OPEN
                </span>
              </h2>
              <p className="text-[10px] sm:text-xs text-slate-400 hidden sm:block">
                Generator Laporan Email Resmi (Ringkasan Total, Area SPV & Lokasi dengan Total Harga Beli)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition shrink-0 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Copy Control Toolbar */}
        <div className="bg-slate-50 border-b border-slate-200 p-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
          
          <div className="flex flex-wrap items-center gap-2">
            
            {/* Salin Subject */}
            <button
              onClick={handleCopySubject}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition border shadow-xs ${
                copiedSubject 
                  ? 'bg-emerald-600 text-white border-emerald-600' 
                  : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
              }`}
            >
              {copiedSubject ? <Check className="w-4 h-4 text-white" /> : <Copy className="w-4 h-4 text-amber-600" />}
              <span>{copiedSubject ? 'Subject Tersalin!' : 'Salin Subject Email'}</span>
            </button>

            {/* Salin HTML Email (Rapi) */}
            <button
              onClick={handleCopyHtml}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition border shadow-xs ${
                copiedHtml 
                  ? 'bg-emerald-600 text-white border-emerald-600' 
                  : 'bg-amber-600 hover:bg-amber-500 text-white border-amber-600'
              }`}
            >
              {copiedHtml ? <Check className="w-4 h-4 text-white" /> : <Sparkles className="w-4 h-4 text-amber-200" />}
              <span>{copiedHtml ? 'Isi HTML Email Tersalin!' : 'Salin Isi Email HTML (Tabel Rapi)'}</span>
            </button>

            {/* Salin Text Plain */}
            <button
              onClick={handleCopyText}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition border shadow-xs ${
                copiedText 
                  ? 'bg-emerald-600 text-white border-emerald-600' 
                  : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
              }`}
            >
              {copiedText ? <Check className="w-4 h-4 text-white" /> : <FileText className="w-4 h-4 text-slate-500" />}
              <span>{copiedText ? 'Text Plain Tersalin!' : 'Salin Text Plain'}</span>
            </button>

          </div>

          {/* Mailto section */}
          <div className="flex items-center gap-2">
            <input
              type="email"
              placeholder="Email penerima (opsional)..."
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-amber-500 w-48 text-slate-800"
            />
            <button
              onClick={handleOpenMailClient}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg transition shadow-xs"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Buka Email App</span>
            </button>
          </div>

        </div>

        {/* View Tabs */}
        <div className="bg-slate-100 border-b border-slate-200 px-4 pt-2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('preview')}
              className={`px-3 py-1.5 text-xs font-bold rounded-t-lg transition flex items-center gap-1.5 border-t border-x ${
                activeTab === 'preview'
                  ? 'bg-white text-amber-600 border-slate-300 border-b-transparent shadow-2xs'
                  : 'bg-transparent text-slate-500 hover:text-slate-800 border-transparent'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>Preview Email (Tabel HTML)</span>
            </button>
            <button
              onClick={() => setActiveTab('text')}
              className={`px-3 py-1.5 text-xs font-bold rounded-t-lg transition flex items-center gap-1.5 border-t border-x ${
                activeTab === 'text'
                  ? 'bg-white text-amber-600 border-slate-300 border-b-transparent shadow-2xs'
                  : 'bg-transparent text-slate-500 hover:text-slate-800 border-transparent'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Preview Text Plain</span>
            </button>
          </div>

          <div className="text-[11px] text-slate-500 font-mono pr-2 pb-1">
            Subject: <span className="font-bold text-slate-800">{emailSubject}</span>
          </div>
        </div>

        {/* Preview Content Area */}
        <div className="p-5 overflow-y-auto flex-1 bg-slate-100/50">
          {activeTab === 'preview' ? (
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm max-w-4xl mx-auto">
              <div 
                dangerouslySetInnerHTML={{ __html: generateRichHtmlEmail() }} 
              />
            </div>
          ) : (
            <div className="bg-slate-900 text-slate-100 p-4 rounded-xl font-mono text-xs overflow-x-auto whitespace-pre leading-relaxed border border-slate-800 max-w-4xl mx-auto shadow-inner">
              {plainTextEmail}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 text-slate-500 text-xs flex items-center justify-between shrink-0">
          <span className="flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            Klik <strong>Salin Isi Email HTML</strong> lalu paste (Ctrl+V) langsung ke Gmail / Outlook untuk hasil tabel warna yang rapi.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-lg text-xs transition"
          >
            Tutup
          </button>
        </div>

      </div>
    </div>
  );
};
