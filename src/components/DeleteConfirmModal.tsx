import React from 'react';
import { AlertTriangle, Trash2, X, Loader2 } from 'lucide-react';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  isBulkAll?: boolean;
  count?: number;
  loading?: boolean;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  isBulkAll = false,
  count,
  loading = false
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-slate-100 animate-in fade-in zoom-in duration-200">
        
        <div className="flex items-start justify-between">
          <div className={`p-3 rounded-2xl ${isBulkAll ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}>
            <AlertTriangle className="w-6 h-6" />
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4">
          <h3 className="text-lg font-bold text-slate-800">{title}</h3>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            {message}
          </p>
          {count !== undefined && count > 0 && (
            <div className="mt-3 inline-block px-3 py-1 bg-slate-100 rounded-lg text-xs font-semibold text-slate-700">
              Jumlah data terdampak: <span className="text-rose-600">{count} item</span>
            </div>
          )}
          {isBulkAll && (
            <p className="text-xs font-semibold text-rose-600 mt-2">
              ⚠️ Tindakan ini tidak dapat dibatalkan dan akan menghapus seluruh data dari database Firebase.
            </p>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition shadow-sm disabled:bg-slate-300"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Menghapus...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                Ya, Hapus Data
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
