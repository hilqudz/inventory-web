import React, { useState } from 'react';
import { Upload, FileSpreadsheet, Download, X, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { 
  parseExcelFile, 
  downloadExcelTemplate, 
  mapExcelToMasterItems, 
  mapExcelToTransactions, 
  mapExcelToDoOpen 
} from '../utils/excel';
import {
  bulkAddMasterItems,
  bulkAddTransaksiMasuk,
  bulkAddTransaksiKeluar,
  bulkAddOrUpdateDoOpen
} from '../api';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'master' | 'transaksi_masuk' | 'transaksi_keluar' | 'do_open';
  collectionName: string;
  onSuccess: (count: number, info?: { updatedCount?: number; insertedCount?: number; isDoOpen?: boolean }) => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  type,
  collectionName,
  onSuccess
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [mappedData, setMappedData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ processed: number; total: number }>({ processed: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const getTitle = () => {
    switch (type) {
      case 'master': return 'Import Daftar Master Item';
      case 'transaksi_masuk': return 'Import Transaksi Masuk';
      case 'transaksi_keluar': return 'Import Transaksi Keluar';
      case 'do_open': return 'Import DO OPEN (Update Status / Tambah Data)';
    }
  };

  const getHeadersDescription = () => {
    if (type === 'master') {
      return 'Header Wajib: Item Code, Item Name, Group Name, Harga Jual, Harga Beli. Header Opsional: CreateDate (Tanggal Dibuat)';
    }
    if (type === 'do_open') {
      return 'Header Wajib: DocumentNo (No DO), Status DO OPEN. Header Opsional: PostingDate, Area RM OPR, No DOSL, ItemCode, Item Name, Group Name, Qty, Nilai Jual (Rp), Nilai Beli (Rp), From, To, Area SPV OPR, Keterangan.';
    }
    return 'Header Wajib: PostingDate, EntryName, DocumentNo, ItemCode, Category, Remark, Qty, From, To';
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setError(null);
    setLoading(true);

    try {
      const rawRows = await parseExcelFile<any>(selectedFile);
      setParsedRows(rawRows);

      if (!rawRows || rawRows.length === 0) {
        setError('File Excel kosong atau format tidak sesuai.');
        setMappedData([]);
        return;
      }

      let mapped: any[] = [];
      if (type === 'master') {
        mapped = mapExcelToMasterItems(rawRows);
      } else if (type === 'do_open') {
        mapped = mapExcelToDoOpen(rawRows);
      } else {
        mapped = mapExcelToTransactions(rawRows);
      }

      if (mapped.length === 0) {
        setError('Tidak ada baris data valid yang ditemukan. Pastikan nama header di file Excel sesuai.');
      }
      setMappedData(mapped);
    } catch (err: any) {
      console.error(err);
      setError(`Gagal membaca file: ${err.message || 'Format tidak valid'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!mappedData.length) return;
    setUploading(true);
    setUploadProgress({ processed: 0, total: mappedData.length });
    setError(null);

    const updateProgress = (processed: number, total: number) => {
      setUploadProgress(prev => ({
        processed: Math.max(prev.processed, processed),
        total
      }));
    };

    try {
      if (type === 'do_open') {
        const { updatedCount, insertedCount } = await bulkAddOrUpdateDoOpen(mappedData, updateProgress);
        onSuccess(mappedData.length, { updatedCount, insertedCount, isDoOpen: true });
      } else {
        if (type === 'master') {
          await bulkAddMasterItems(mappedData as any, updateProgress);
        } else if (type === 'transaksi_masuk') {
          await bulkAddTransaksiMasuk(mappedData as any, updateProgress);
        } else if (type === 'transaksi_keluar') {
          await bulkAddTransaksiKeluar(mappedData as any, updateProgress);
        }

        onSuccess(mappedData.length);
      }

      onClose();
      // Reset state
      setFile(null);
      setParsedRows([]);
      setMappedData([]);
    } catch (err: any) {
      console.error(err);
      setError(`Gagal menyimpan data: ${err.message || 'Terjadi kesalahan'}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 border border-slate-100 animate-in fade-in zoom-in duration-200">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-50 rounded-xl text-emerald-600">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800">{getTitle()}</h3>
              <p className="text-xs text-slate-500">Upload file Excel (.xlsx / .xls)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Header Requirements & Template Download */}
        <div className="mt-4 p-3.5 bg-blue-50/70 border border-blue-100 rounded-xl flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-blue-800 block">Format Header Excel</span>
            <span className="text-xs text-blue-600 font-mono mt-0.5 block">{getHeadersDescription()}</span>
          </div>
          <button
            type="button"
            onClick={() => downloadExcelTemplate(type === 'master' ? 'master' : type === 'do_open' ? 'do_open' : 'transaksi')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 shadow-sm transition whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Download Template
          </button>
        </div>

        {/* Upload Drop Area */}
        <div className="mt-4">
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 hover:border-emerald-500 bg-slate-50 hover:bg-emerald-50/20 rounded-xl p-6 cursor-pointer transition">
            <Upload className="w-8 h-8 text-slate-400 mb-2" />
            <span className="text-sm font-medium text-slate-700">
              {file ? file.name : 'Klik untuk memilih file Excel / CSV'}
            </span>
            <span className="text-xs text-slate-400 mt-1">Ekstensi .xlsx, .xls, atau .csv</span>
            <input
              type="file"
              accept=".xlsx, .xls, .csv"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>
        </div>

        {/* Errors / Loading */}
        {loading && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-600 py-4">
            <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
            Membaca data file Excel...
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
            {error}
          </div>
        )}

        {/* Upload Progress Bar */}
        {uploading && (
          <div className="mt-4 p-4 bg-emerald-50/80 border border-emerald-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-emerald-900">
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                Menyimpan data ke database...
              </span>
              <span className="font-mono text-emerald-700">
                {uploadProgress.processed.toLocaleString()} / {uploadProgress.total.toLocaleString()} ({Math.round((uploadProgress.processed / (uploadProgress.total || 1)) * 100)}%)
              </span>
            </div>
            <div className="w-full bg-emerald-200 rounded-full h-2.5 overflow-hidden">
              <div 
                className="bg-emerald-600 h-2.5 rounded-full transition-all duration-300 ease-out" 
                style={{ width: `${Math.min(100, Math.round((uploadProgress.processed / (uploadProgress.total || 1)) * 100))}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Mapped Data Preview */}
        {!loading && !uploading && mappedData.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                Terdeteksi {mappedData.length} baris data valid
              </span>
              <span className="text-xs text-slate-400">Pratinjau 3 data pertama:</span>
            </div>
            
            <div className="max-h-40 overflow-x-auto border border-slate-200 rounded-lg bg-slate-50 p-2 text-xs font-mono">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    {Object.keys(mappedData[0]).slice(0, 5).map(k => (
                      <th key={k} className="p-1.5 font-semibold">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mappedData.slice(0, 3).map((row, idx) => (
                    <tr key={idx} className="border-b border-slate-100 text-slate-700">
                      {Object.values(row).slice(0, 5).map((val: any, vIdx) => (
                        <td key={vIdx} className="p-1.5 truncate max-w-[120px]">{String(val)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Actions Footer */}
        <div className="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={mappedData.length === 0 || uploading}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 rounded-xl transition shadow-sm"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Menyimpan...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Import {mappedData.length} Data Ke Database
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
