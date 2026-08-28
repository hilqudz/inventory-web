import React from 'react';
import { Search, Calendar, Filter, X, RefreshCw } from 'lucide-react';
import { DateCategoryFilter } from '../types';

interface FilterBarProps {
  filters: DateCategoryFilter;
  onFilterChange: (newFilters: DateCategoryFilter) => void;
  categories: string[];
  placeholder?: string;
  onReset?: () => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  filters,
  onFilterChange,
  categories,
  placeholder = 'Cari berdasarkan kode, nama, dokumen, remark...',
  onReset
}) => {
  const hasActiveFilters = 
    filters.searchQuery || filters.startDate || filters.endDate || filters.category;

  const handleReset = () => {
    onFilterChange({
      searchQuery: '',
      startDate: '',
      endDate: '',
      category: ''
    });
    if (onReset) onReset();
  };

  return (
    <div className="bg-white p-2.5 rounded border border-slate-200 mb-3 flex flex-wrap items-center justify-between gap-2 text-xs shadow-xs">
      {/* Search Input */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={filters.searchQuery}
          onChange={(e) => onFilterChange({ ...filters, searchQuery: e.target.value })}
          placeholder={placeholder}
          className="w-full pl-8 pr-7 py-1 bg-slate-50 border border-slate-300 rounded text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white transition"
        />
        {filters.searchQuery && (
          <button
            onClick={() => onFilterChange({ ...filters, searchQuery: '' })}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Date Range Start & End */}
        <div className="flex items-center gap-1.5 border-l border-slate-200 pl-2">
          <div className="relative">
            <Calendar className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => onFilterChange({ ...filters, startDate: e.target.value })}
              className="pl-6 pr-2 py-1 bg-slate-50 border border-slate-300 rounded text-[11px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white font-mono"
              title="Tanggal Mulai"
            />
          </div>
          <span className="text-[10px] text-slate-400 font-medium">s/d</span>
          <div className="relative">
            <Calendar className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => onFilterChange({ ...filters, endDate: e.target.value })}
              className="pl-6 pr-2 py-1 bg-slate-50 border border-slate-300 rounded text-[11px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white font-mono"
              title="Tanggal Akhir"
            />
          </div>
        </div>

        {/* Category Dropdown Filter */}
        <div className="relative min-w-[140px]">
          <Filter className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <select
            value={filters.category}
            onChange={(e) => onFilterChange({ ...filters, category: e.target.value })}
            className="w-full pl-7 pr-6 py-1 bg-slate-50 border border-slate-300 rounded text-[11px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white appearance-none cursor-pointer"
          >
            <option value="">Semua Kategori</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {/* Reset Filters Button */}
        {hasActiveFilters && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded border border-red-200 transition"
          >
            <RefreshCw className="w-3 h-3" />
            Reset
          </button>
        )}
      </div>
    </div>
  );
};
