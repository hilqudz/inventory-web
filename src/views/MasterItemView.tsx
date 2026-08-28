import React, { useState, useMemo } from 'react';
import {
  Package,
  Plus,
  FileSpreadsheet,
  Download,
  Trash2,
  Edit3,
  X,
  CheckSquare,
  Square,
  AlertCircle,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { MasterItem, DateCategoryFilter, UserProfile } from '../types';
import { FilterBar } from '../components/FilterBar';
import { SortableHeader } from '../components/SortableHeader';
import { sortData, SortConfig } from '../utils/sorting';
import { exportToExcel } from '../utils/excel';
import { bulkDeleteDocs, clearCollectionDocs, COLLECTIONS, db, isFirestoreQuotaExceeded } from '../api';
import { addDoc, collection, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { deleteSupabaseRows, clearSupabaseTable, upsertMasterItem } from '../api';

interface MasterItemViewProps {
  items: MasterItem[];
  currentUser?: UserProfile | null;
  onOpenImport: () => void;
  onRequestDeleteConfirm: (title: string, message: string, onConfirm: () => Promise<void>, isAll?: boolean, count?: number) => void;
}

export const MasterItemView: React.FC<MasterItemViewProps> = ({
  items,
  currentUser,
  onOpenImport,
  onRequestDeleteConfirm
}) => {
  const canDelete = currentUser?.role === 'Audit';
  const [filters, setFilters] = useState<DateCategoryFilter>({
    searchQuery: '',
    startDate: '',
    endDate: '',
    category: ''
  });

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'itemCode', direction: 'asc' });
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MasterItem | null>(null);

  const handleSort = (field: string) => {
    setSortConfig(prev => {
      if (prev.key === field) {
        if (prev.direction === 'asc') return { key: field, direction: 'desc' };
        if (prev.direction === 'desc') return { key: null, direction: null };
      }
      return { key: field, direction: 'asc' };
    });
  };

  // Form State
  const [itemCode, setItemCode] = useState('');
  const [itemName, setItemName] = useState('');
  const [groupName, setGroupName] = useState('Bahan Bangunan');
  const [hargaJual, setHargaJual] = useState<number | ''>(0);
  const [hargaBeli, setHargaBeli] = useState<number | ''>(0);
  const [createdDate, setCreatedDate] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Categories list derived from Group Names
  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => { if (i.groupName) set.add(i.groupName); });
    return Array.from(set);
  }, [items]);

  // Filtered Items
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      // Search
      const query = filters.searchQuery.toLowerCase();
      const matchSearch = !query || 
        item.itemCode.toLowerCase().includes(query) || 
        item.itemName.toLowerCase().includes(query) ||
        (item.groupName && item.groupName.toLowerCase().includes(query));

      // Category / Group
      const matchCategory = !filters.category || item.groupName === filters.category;

      return matchSearch && matchCategory;
    });
  }, [items, filters]);

  // Sorted Items
  const sortedItems = useMemo(() => {
    return sortData(filteredItems, sortConfig);
  }, [filteredItems, sortConfig]);

  // Pagination — render cuma sebagian baris ke DOM (13rb+ baris tanpa ini bikin
  // UI lag berat tiap kali tab ini dibuka, lihat catatan performa Fase 8)
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedItems = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return sortedItems.slice(start, start + PAGE_SIZE);
  }, [sortedItems, safePage]);
  // Balik ke halaman 1 setiap kali filter/urutan berubah
  React.useEffect(() => {
    setPage(1);
  }, [filters.searchQuery, filters.category, sortConfig]);

  // Select / Deselect All
  const handleSelectAll = () => {
    if (selectedIds.length === filteredItems.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredItems.map(i => i.id!).filter(Boolean));
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  // Open Edit Modal
  const handleOpenEdit = (item: MasterItem) => {
    setEditingItem(item);
    setItemCode(item.itemCode);
    setItemName(item.itemName);
    setGroupName(item.groupName || 'Umum');
    setHargaJual(item.hargaJual || 0);
    setHargaBeli(item.hargaBeli || 0);
    setCreatedDate(item.createdDate || item.createdAt?.slice(0, 10) || '');
    setFormError(null);
    setIsAddModalOpen(true);
  };

  // Open Add Modal
  const handleOpenAdd = () => {
    setEditingItem(null);
    setItemCode(`ITM-${Math.floor(100 + Math.random() * 900)}`);
    setItemName('');
    setGroupName('Umum');
    setHargaJual(0);
    setHargaBeli(0);
    setCreatedDate('');
    setFormError(null);
    setIsAddModalOpen(true);
  };

  // Save Item (Add or Update)
  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemCode.trim() || !itemName.trim()) {
      setFormError('Kode Item dan Nama Item wajib diisi.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    const cleanCode = itemCode.trim().toUpperCase();
    const cleanName = itemName.trim();
    const cleanGroup = groupName.trim() || 'Umum';
    const cleanHargaJual = Number(hargaJual) || 0;
    const cleanHargaBeli = Number(hargaBeli) || 0;
    const cleanCreatedDate = createdDate.trim() || undefined;

    try {
      // 1. Save to Supabase database first
      await upsertMasterItem({
        itemCode: cleanCode,
        itemName: cleanName,
        groupName: cleanGroup,
        hargaJual: cleanHargaJual,
        hargaBeli: cleanHargaBeli,
        createdDate: cleanCreatedDate
      });

      // 2. Save / Update to Firestore database using setDoc with merge: true
      if (!isFirestoreQuotaExceeded) {
        const itemDocId = (editingItem && editingItem.id) ? editingItem.id : cleanCode;
        const docRef = doc(db, COLLECTIONS.MASTER_ITEMS, itemDocId);
        await setDoc(docRef, {
          itemCode: cleanCode,
          itemName: cleanName,
          groupName: cleanGroup,
          hargaJual: cleanHargaJual,
          hargaBeli: cleanHargaBeli,
          createdDate: cleanCreatedDate || null,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
      setIsAddModalOpen(false);
    } catch (err: any) {
      console.error(err);
      setFormError(`Gagal menyimpan data: ${err.message || 'Error'}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Export Excel
  const handleExport = () => {
    const exportData = filteredItems.map(item => ({
      'Item Code': item.itemCode,
      'Item Name': item.itemName,
      'Group Name': item.groupName,
      'Harga Jual': item.hargaJual,
      'Harga Beli': item.hargaBeli,
      'Created Date': item.createdDate || item.createdAt?.slice(0, 10) || ''
    }));
    exportToExcel(exportData, 'Daftar_Master_Item', 'Master Items');
  };

  // Delete Selected
  const handleDeleteSelected = () => {
    if (!selectedIds.length) return;
    onRequestDeleteConfirm(
      'Hapus Master Item Terpilih',
      `Apakah Anda yakin ingin menghapus ${selectedIds.length} item tercentang?`,
      async () => {
        await deleteSupabaseRows('master_item', selectedIds);
        try { await bulkDeleteDocs(COLLECTIONS.MASTER_ITEMS, selectedIds); } catch {}
        setSelectedIds([]);
      },
      false,
      selectedIds.length
    );
  };

  // Delete All
  const handleDeleteAll = () => {
    onRequestDeleteConfirm(
      'Hapus Seluruh Master Item',
      'Apakah Anda yakin ingin menghapus SELURUH data Master Item?',
      async () => {
        await clearSupabaseTable('master_item');
        try { await clearCollectionDocs(COLLECTIONS.MASTER_ITEMS); } catch {}
        setSelectedIds([]);
      },
      true,
      items.length
    );
  };

  // Delete Single
  const handleDeleteSingle = (item: MasterItem) => {
    if (!item.id && !item.itemCode) return;
    onRequestDeleteConfirm(
      'Hapus Master Item',
      `Apakah Anda yakin ingin menghapus item ${item.itemCode} - ${item.itemName}?`,
      async () => {
        if (item.id) await deleteSupabaseRows('master_item', [item.id!]);
        if (item.itemCode) await deleteSupabaseRows('master_item', [item.itemCode], 'kode');
        if (!isFirestoreQuotaExceeded) {
          try { if (item.id) await deleteDoc(doc(db, COLLECTIONS.MASTER_ITEMS, item.id!)); } catch {}
        }
      },
      false,
      1
    );
  };

  return (
    <div className="space-y-6">
      
      {/* Header View & Action Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded border border-slate-200 shadow-xs mb-3">
        <div>
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Package className="w-4 h-4 text-indigo-600" />
            Daftar Master Item
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Katalog barang gudang lengkap dengan kelompok dan harga jual/beli. Total {items.length} item.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded shadow-xs transition"
          >
            <Plus className="w-3.5 h-3.5" />
            Tambah Item
          </button>

          <button
            onClick={onOpenImport}
            className="flex items-center gap-1 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded shadow-xs transition"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Import Excel
          </button>

          <button
            onClick={handleExport}
            className="flex items-center gap-1 px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded transition border border-slate-300"
          >
            <Download className="w-3.5 h-3.5" />
            Export Excel
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <FilterBar
        filters={filters}
        onFilterChange={setFilters}
        categories={categories}
        placeholder="Cari berdasarkan Item Code, Item Name, Group Name..."
      />

      {/* Bulk Action Controls */}
      {canDelete && selectedIds.length > 0 && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded flex items-center justify-between mb-3 text-xs">
          <span className="font-semibold text-amber-800">
            Terpilih {selectedIds.length} item dari tabel
          </span>
          <button
            onClick={handleDeleteSelected}
            className="flex items-center gap-1 px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Hapus Data Terpilih
          </button>
        </div>
      )}

      {/* Table Card */}
      <div className="bg-white rounded border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between bg-slate-100/70">
          <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
            Data Master Barang ({filteredItems.length})
          </span>

          {canDelete && (
            <button
              onClick={handleDeleteAll}
              disabled={items.length === 0}
              className="flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-40"
            >
              <Trash2 className="w-3 h-3" />
              Hapus Semua Data
            </button>
          )}
        </div>

        <div className="overflow-x-auto max-h-[calc(100vh-280px)]">
          <table className="w-full text-left data-grid text-[11px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="p-2 text-center w-8">
                  <button onClick={handleSelectAll} className="text-slate-400 hover:text-slate-600">
                    {selectedIds.length === sortedItems.length && sortedItems.length > 0 ? (
                      <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
                    ) : (
                      <Square className="w-3.5 h-3.5" />
                    )}
                  </button>
                </th>
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
                  label="Harga Beli (Rp)"
                  field="hargaBeli"
                  align="right"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Created Date"
                  field="createdDate"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <th className="p-2 text-center w-16">Aksi</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400 text-xs">
                    Tidak ada data Master Item yang ditemukan.
                  </td>
                </tr>
              ) : (
                paginatedItems.map((item) => {
                  const isSelected = selectedIds.includes(item.id!);
                  return (
                    <tr 
                      key={item.id || item.itemCode} 
                      className={`hover:bg-slate-50 transition ${isSelected ? 'bg-indigo-50/40' : ''}`}
                    >
                      <td className="p-2 text-center">
                        <button 
                          onClick={() => handleToggleSelect(item.id || item.itemCode)}
                          className="text-slate-400 hover:text-indigo-600"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
                          ) : (
                            <Square className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </td>
                      <td className="p-2 font-mono font-bold text-indigo-600">{item.itemCode}</td>
                      <td className="p-2 font-medium text-slate-800">{item.itemName}</td>
                      <td className="p-2">
                        <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-700 rounded">
                          {item.groupName || 'Umum'}
                        </span>
                      </td>
                      <td className="p-2 text-right font-mono text-slate-600">
                        {item.hargaBeli ? `Rp ${item.hargaBeli.toLocaleString('id-ID', { maximumFractionDigits: 0 })}` : '-'}
                      </td>
                      <td className="p-2 font-mono text-xs text-slate-600">
                        {item.createdDate || item.createdAt?.slice(0, 10) || '-'}
                      </td>
                      <td className="p-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleOpenEdit(item)}
                            className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition"
                            title="Edit Item"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {canDelete && (
                            <button
                              onClick={() => handleDeleteSingle(item)}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                              title="Hapus Item"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 p-2 pt-3 text-xs text-slate-600 font-mono border-t border-slate-100 mt-1">
          <div>
            Menampilkan {sortedItems.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1} - {Math.min(safePage * PAGE_SIZE, sortedItems.length)} dari {sortedItems.length.toLocaleString('id-ID', { maximumFractionDigits: 0 })} item
          </div>
          <div className="flex items-center gap-1">
            <button
              disabled={safePage <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Prev</span>
            </button>
            <span className="px-3 py-1 bg-slate-50 border border-slate-200 rounded font-bold">
              {safePage} / {totalPages}
            </span>
            <button
              disabled={safePage >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-slate-100 animate-in fade-in zoom-in duration-200">
            
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800">
                {editingItem ? 'Edit Master Item' : 'Tambah Master Item'}
              </h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveItem} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Item Code *</label>
                <input
                  type="text"
                  required
                  value={itemCode}
                  onChange={(e) => setItemCode(e.target.value)}
                  placeholder="Contoh: ITM-001"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Item Name *</label>
                <input
                  type="text"
                  required
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  placeholder="Nama Barang Gudang"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Group Name / Kategori</label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Bahan Bangunan, Cat, Perkakas..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Harga Jual (Rp)</label>
                  <input
                    type="number"
                    value={hargaJual}
                    onChange={(e) => setHargaJual(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Harga Beli (Rp)</label>
                  <input
                    type="number"
                    value={hargaBeli}
                    onChange={(e) => setHargaBeli(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Created Date</label>
                <input
                  type="text"
                  value={createdDate}
                  onChange={(e) => setCreatedDate(e.target.value)}
                  placeholder="Contoh: 8-Jun-26"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                />
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 font-medium text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-sm"
                >
                  {submitting ? 'Menyimpan...' : 'Simpan Data'}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
};
