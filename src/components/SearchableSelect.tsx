import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, X, Search } from 'lucide-react';

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string; // contoh: "-- Semua Area RM OPR --"
  className?: string;
}

// Dropdown filter yang bisa diketik untuk cari opsinya, dipakai di panel
// Filter DO OPEN (Area RM/SPV, Status, Group Name, Tujuan) — sebelumnya
// <select> polos yang susah dicari kalau opsinya banyak.
// Perkiraan tinggi popup (search box + list) buat keputusan buka atas/bawah —
// gak perlu presisi, cuma buat threshold "cukup ruang apa enggak".
const ESTIMATED_POPUP_HEIGHT = 260;

export const SearchableSelect: React.FC<SearchableSelectProps> = ({ value, onChange, options, placeholder, className }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter(opt => opt.toLowerCase().includes(q));
  }, [options, query]);

  const handleSelect = (opt: string) => {
    onChange(opt);
    setIsOpen(false);
    setQuery('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setQuery('');
  };

  return (
    <div ref={rootRef} className={`relative ${className || ''}`}>
      <button
        type="button"
        onClick={() => {
          setIsOpen(prev => {
            const next = !prev;
            if (next && rootRef.current) {
              // Kalau ruang di bawah gak cukup buat popup tapi di atas cukup,
              // buka ke atas — supaya gak kepotong tepi layar/scroll area
              // (bug yang dilaporkan Pak Irvan: dropdown selalu buka ke bawah
              // padahal kadang posisinya udah dekat bawah layar).
              const rect = rootRef.current.getBoundingClientRect();
              const spaceBelow = window.innerHeight - rect.bottom;
              const spaceAbove = rect.top;
              setDropUp(spaceBelow < ESTIMATED_POPUP_HEIGHT && spaceAbove > spaceBelow);
            }
            return next;
          });
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 text-left"
      >
        <span className={`flex-1 truncate ${value ? 'text-slate-100' : 'text-slate-400'}`}>
          {value || placeholder}
        </span>
        {value ? (
          <X className="w-3.5 h-3.5 text-slate-400 hover:text-white shrink-0" onClick={handleClear} />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        )}
      </button>

      {isOpen && (
        <div
          className={`absolute z-20 w-full bg-slate-800 border border-slate-600 rounded shadow-lg overflow-hidden ${
            dropUp ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          <div className="relative border-b border-slate-700">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ketik untuk cari..."
              className="w-full pl-8 pr-2 py-1.5 bg-slate-800 text-slate-100 text-xs focus:outline-none"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            <button
              type="button"
              onClick={() => handleSelect('')}
              className="w-full text-left px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 border-b border-slate-700/60"
            >
              {placeholder}
            </button>
            {filteredOptions.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-slate-500 italic">Tidak ada hasil.</div>
            ) : (
              filteredOptions.map(opt => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => handleSelect(opt)}
                  className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-slate-700 truncate ${
                    opt === value ? 'text-blue-400 font-semibold bg-slate-700/60' : 'text-slate-200'
                  }`}
                >
                  {opt}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
