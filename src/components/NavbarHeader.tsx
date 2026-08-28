import React from 'react';
import { Warehouse, LogOut, UserCheck, RefreshCw, Trash2, Menu } from 'lucide-react';
import { UserProfile } from '../types';

interface NavbarHeaderProps {
  user: UserProfile | null;
  onLogout: () => void;
  onClearAllDataPermanent: () => void;
  onRunAutoReconcile: () => void;
  onSyncSupabase?: () => void;
  isSyncingSupabase?: boolean;
  isReconciling?: boolean;
  onToggleMobileMenu?: () => void;
}

export const NavbarHeader: React.FC<NavbarHeaderProps> = ({
  user,
  onLogout,
  onClearAllDataPermanent,
  onRunAutoReconcile,
  onSyncSupabase,
  isSyncingSupabase = false,
  isReconciling = false,
  onToggleMobileMenu
}) => {
  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30 shadow-xs">
      <div className="w-full px-3 sm:px-4 h-12 flex items-center justify-between">
        
        {/* App Title & Logo */}
        <div className="flex items-center gap-2">
          {/* Hamburger Menu Toggle on Mobile */}
          {onToggleMobileMenu && (
            <button
              onClick={onToggleMobileMenu}
              className="md:hidden p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 transition"
              title="Buka Menu Navigation"
            >
              <Menu className="w-4 h-4 text-blue-400" />
            </button>
          )}

          <div className="p-1 bg-blue-600/20 border border-blue-500/30 text-blue-400 rounded">
            <Warehouse className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-xs sm:text-sm font-bold tracking-tight text-white flex items-center gap-2">
              <span className="truncate max-w-[140px] sm:max-w-none">Aplikasi Inventory Gudang</span>
              <span className="hidden sm:inline-block px-1.5 py-0.2 text-[9px] font-mono uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded">
                SQL Server Live
              </span>
            </h1>
          </div>
        </div>


        {/* Header Right Actions */}
        <div className="flex items-center gap-2">
          
          {/* Admin / Audit Tools: Rekonsiliasi DO & Refresh Data — dua-duanya read/cleanup
              yang aman, server juga mengizinkan role Audit (lihat WRITE_ROLES di doOpenRoutes.ts) */}
          {(user?.role === 'Audit' || user?.role === 'Admin') && (
            <>
              {/* Auto Reconcile DO OPEN Trigger Button */}
              <button
                onClick={onRunAutoReconcile}
                disabled={isReconciling}
                className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded border border-slate-700 transition"
                title="Cek & hapus otomatis DO OPEN yang ada di Transaksi Keluar"
              >
                <RefreshCw className={`w-3 h-3 text-blue-400 ${isReconciling ? 'animate-spin' : ''}`} />
                <span className="hidden md:inline text-[11px]">Rekonsiliasi DO</span>
              </button>

              {/* Refresh Data Button — dulu "Sinkron Supabase", sekarang cuma fetch ulang dari SQL Server */}
              {onSyncSupabase && (
                <button
                  onClick={onSyncSupabase}
                  disabled={isSyncingSupabase}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white text-xs font-semibold rounded border border-blue-400/40 transition shadow-xs cursor-pointer"
                  title="Tarik ulang semua data terbaru dari Database SQL Server"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-blue-100 ${isSyncingSupabase ? 'animate-spin' : ''}`} />
                  <span className="text-[11px]">
                    {isSyncingSupabase ? 'Memuat...' : 'Refresh Data'}
                  </span>
                </button>
              )}
            </>
          )}

          {/* Admin Only: Hapus Permanent DB — server (POST /api/admin/clear-table) sudah
              dikunci requireRole("Admin"), jadi tombolnya juga cuma boleh muncul untuk Admin */}
          {user?.role === 'Admin' && (
            <button
              onClick={onClearAllDataPermanent}
              className="flex items-center gap-1 px-2.5 py-1 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 text-xs font-medium rounded border border-rose-800/60 transition"
              title="Hapus Permanent Seluruh Data dari Database SQL Server"
            >
              <Trash2 className="w-3 h-3 text-rose-400" />
              <span className="hidden lg:inline text-[11px]">Hapus Permanent DB</span>
            </button>
          )}

          {/* Active User Info Badge */}
          {user && (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
              <div className="flex flex-col items-end text-[11px]">
                <span className="font-semibold text-slate-200 flex items-center gap-1 leading-none">
                  <UserCheck className="w-3 h-3 text-emerald-400" />
                  <span className="hidden sm:inline">{user.displayName || user.nik}</span>
                  <span className={`px-1.5 py-0.2 text-[9px] font-bold rounded uppercase tracking-wider ${
                    user.role === 'Audit' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' :
                    user.role === 'Team Gudang' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                    user.role === 'BOD' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' :
                    'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                  }`}>
                    {user.role}
                  </span>
                </span>
                <span className="text-[9px] text-slate-400 font-mono mt-0.5 hidden sm:inline">
                  NIK: {user.nik}
                </span>
              </div>
            </div>
          )}

        </div>

      </div>
    </header>
  );
};

