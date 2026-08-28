import React from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { SortDirection } from '../utils/sorting';

interface SortableHeaderProps {
  label: string;
  field: string;
  currentSortKey: string | null;
  currentDirection: SortDirection;
  onSort: (field: string) => void;
  align?: 'left' | 'center' | 'right';
  className?: string;
}

export const SortableHeader: React.FC<SortableHeaderProps> = ({
  label,
  field,
  currentSortKey,
  currentDirection,
  onSort,
  align = 'left',
  className = ''
}) => {
  const isActive = currentSortKey === field;
  const alignClass = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';

  return (
    <th className={`p-2 select-none ${className}`}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`flex items-center gap-1 hover:text-blue-600 transition font-semibold text-slate-700 w-full ${alignClass}`}
        title={`Klik untuk mengurutkan ${label}`}
      >
        <span>{label}</span>
        {isActive ? (
          currentDirection === 'asc' ? (
            <ArrowUp className="w-3 h-3 text-blue-600 shrink-0" />
          ) : (
            <ArrowDown className="w-3 h-3 text-blue-600 shrink-0" />
          )
        ) : (
          <ArrowUpDown className="w-3 h-3 text-slate-400 opacity-50 hover:opacity-100 shrink-0" />
        )}
      </button>
    </th>
  );
};
