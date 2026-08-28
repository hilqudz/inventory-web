import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  Package, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Boxes, 
  Clock, 
  GitCompare,
  Send,
  Ship,
  Boxes as WarehouseIcon,
  X,
  ShieldCheck,
  LogOut,
  UserCheck,
  FileCheck,
  Bot,
  PanelLeftClose,
  PanelLeftOpen,
  Camera,
  ShieldAlert
} from 'lucide-react';
import { ActiveTab, UserRole, UserProfile } from '../types';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  userRole?: UserRole;
  currentUser?: UserProfile | null;
  onLogout?: () => void;
  pendingUserCount?: number;
  counts: {
    masterItemCount: number;
    catalogPhotoCount?: number;
    masukCount?: number;
    keluarCount?: number;
    doOpenCount: number;
    requestDoOpenCount?: number;
    containerCount?: number;
  };
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  userRole = 'Audit',
  currentUser,
  onLogout,
  pendingUserCount = 0,
  counts,
  isMobileOpen = false,
  onCloseMobile
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapse = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  const isBod = userRole === 'BOD';
  const isOpr = userRole === 'OPR';
  const isAudit = userRole === 'Audit';
  const isTeamGudang = userRole === 'Team Gudang';
  // Kelola user (approve/hapus) sengaja Admin-only di backend (userRoutes.ts) —
  // jangan dilonggarkan ke Audit di sini, itu privilege escalation yang tidak disengaja.
  const isAdmin = userRole === 'Admin';

  const mainNavItems = [
    { 
      id: 'dashboard' as ActiveTab, 
      label: 'Dashboard', 
      icon: LayoutDashboard,
    },
    { 
      id: 'master_item' as ActiveTab, 
      label: 'Daftar Master Item', 
      icon: Package,
      badge: counts.masterItemCount,
    },
    { 
      id: 'katalog_foto' as ActiveTab, 
      label: 'Upload Katalog Foto', 
      icon: Camera,
      badge: counts.catalogPhotoCount,
    },
    {
      id: 'chat_bot' as ActiveTab,
      label: 'Chat Bot Meta AI',
      icon: Bot,
    },
  ];

  const transactionNavItems = [
    { 
      id: 'transaksi_masuk' as ActiveTab, 
      label: 'Transaksi Masuk', 
      icon: ArrowDownLeft,
    },
    { 
      id: 'transaksi_keluar' as ActiveTab, 
      label: 'Transaksi Keluar', 
      icon: ArrowUpRight,
    },
    { 
      id: 'do_open' as ActiveTab, 
      label: 'DO OPEN', 
      icon: Clock,
      badge: counts.doOpenCount,
    },
    { 
      id: 'request_do_open' as ActiveTab, 
      label: 'Request DO OPEN', 
      icon: Send,
      badge: counts.requestDoOpenCount,
    },
  ];

  const reportNavItems = [
    { 
      id: 'sisa_stock' as ActiveTab, 
      label: 'Sisa Stock', 
      icon: Boxes,
    },
    { 
      id: 'report_request_do' as ActiveTab, 
      label: 'Report DO OPEN Kirim', 
      icon: FileCheck,
    },
    {
      id: 'rekonsiliasi_stock' as ActiveTab,
      label: 'Rekonsiliasi Stock',
      icon: GitCompare,
    },
    {
      id: 'container_status' as ActiveTab,
      label: 'Status Container',
      icon: Ship,
    },
    // 'cif_bap_container' disembunyikan sementara — datanya baru tersimpan di
    // localStorage browser (belum ada endpoint SQL Server), jadi tidak sinkron
    // antar device/user. Munculkan lagi setelah backend-nya beneran dibangun.
  ];

  // 'Otorisasi User' — Admin & Audit (Audit cuma boleh approve/reject
  // pengajuan baru, lihat UserManagementView.tsx untuk pembatasannya).
  // 'Keamanan' — Admin only, tidak diminta untuk Audit.
  const adminNavItems = [
    {
      id: 'user_management' as ActiveTab,
      label: 'Otorisasi User',
      icon: ShieldCheck,
      badge: pendingUserCount,
    },
  ];

  const adminOnlyNavItems = [
    {
      id: 'security_monitoring' as ActiveTab,
      label: 'Keamanan',
      icon: ShieldAlert,
    }
  ];

  const handleTabClick = (tab: ActiveTab) => {
    onSelectTab(tab);
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  const renderNavItem = (item: { id: ActiveTab; label: string; icon: React.FC<{ className?: string }>; badge?: number }) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;

    return (
      <button
        key={item.id}
        onClick={() => handleTabClick(item.id)}
        title={isCollapsed ? item.label : undefined}
        translate="no"
        className={`w-full flex items-center ${isCollapsed ? 'justify-center px-2 py-2.5' : 'justify-between px-3.5 py-2'} rounded-md text-xs font-medium sidebar-item text-slate-300 transition-all notranslate ${
          isActive ? 'sidebar-active text-white bg-blue-600/30 border border-blue-500/30' : 'hover:bg-slate-800 hover:text-white'
        }`}
      >
        <div className={`flex items-center gap-2.5 min-w-0 ${isCollapsed ? 'justify-center relative' : ''}`}>
          <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-400' : 'text-slate-400'}`} />
          {!isCollapsed && <span className="truncate notranslate" translate="no">{item.label}</span>}

          {isCollapsed && item.badge !== undefined && item.badge > 0 && (
            <span className="absolute -top-1.5 -right-2 px-1 py-0.2 text-[9px] font-mono font-bold rounded-full bg-blue-600 text-white border border-slate-900 shadow-xs">
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          )}
        </div>

        {!isCollapsed && item.badge !== undefined && item.badge > 0 && (
          <span className={`px-1.5 py-0.2 text-[10px] font-mono rounded ${
            isActive ? 'bg-blue-600/40 text-blue-200 border border-blue-400/40' : 'bg-slate-800 text-slate-400'
          }`}>
            {item.badge}
          </span>
        )}
      </button>
    );
  };

  const renderSectionHeader = (title: string, colorClass: string = 'text-slate-500') => {
    if (isCollapsed) {
      return <div className="my-2 border-t border-slate-800/80" />;
    }
    return (
      <div className={`px-3 py-1 text-[10px] font-bold ${colorClass} uppercase tracking-wider`}>
        {title}
      </div>
    );
  };

  const navContent = (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto scrollbar-thin">
      {/* Brand Header */}
      <div className={`p-3 border-b border-slate-800 bg-slate-950/80 flex items-center ${isCollapsed ? 'justify-center flex-col gap-2' : 'justify-between'} shrink-0 sticky top-0 z-10 transition-all`}>
        {!isCollapsed ? (
          <>
            <div>
              <div className="text-white font-bold text-sm flex items-center gap-2 tracking-wide">
                <WarehouseIcon className="w-4 h-4 text-blue-400" />
                <span>📦 WEB GUDANG</span>
              </div>
              <div className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5 font-semibold">
                INVENTORY MANAGEMENT
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={toggleCollapse}
                className="hidden md:flex p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                title="Minimize Sidebar (Kecilkan Sidebar)"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
              {onCloseMobile && (
                <button 
                  onClick={onCloseMobile}
                  className="md:hidden p-1.5 text-slate-400 hover:text-white rounded bg-slate-800 hover:bg-slate-700 transition"
                  title="Tutup Menu"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 w-full py-0.5">
            <button
              onClick={toggleCollapse}
              className="p-1.5 text-blue-400 hover:text-white hover:bg-slate-800 rounded-lg transition w-full flex justify-center"
              title="Expand Sidebar (Buka Sidebar)"
            >
              <PanelLeftOpen className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      {/* Scrollable Navigation Area */}
      <div className="flex-1 overflow-y-auto min-h-0 p-2 space-y-3 scrollbar-thin">
        <nav className="space-y-3">
          {isBod ? (
            <div>
              {renderSectionHeader('BOD Menu', 'text-purple-400')}
              <div className="space-y-0.5 mt-0.5">
                {renderNavItem({
                  id: 'dashboard' as ActiveTab,
                  label: 'Dashboard Stock & Rekap',
                  icon: LayoutDashboard
                })}
                {renderNavItem({
                  id: 'katalog_foto' as ActiveTab,
                  label: 'Upload Katalog Foto',
                  icon: Camera,
                  badge: counts.catalogPhotoCount
                })}
                {renderNavItem({
                  id: 'chat_bot' as ActiveTab,
                  label: 'Chat Bot Meta AI',
                  icon: Bot
                })}
              </div>
            </div>
          ) : isOpr ? (
            <div>
              {renderSectionHeader('OPR Menu', 'text-slate-500')}
              <div className="space-y-0.5 mt-0.5">
                {renderNavItem({
                  id: 'do_open' as ActiveTab,
                  label: 'DO OPEN (Logistik)',
                  icon: Clock,
                  badge: counts.doOpenCount
                })}
              </div>
            </div>
          ) : isTeamGudang ? (
            <div>
              {/* Permintaan Pak Irvan 2026-08-18: Team Gudang cuma boleh lihat
                  DO OPEN, Request DO OPEN, dan Report DO OPEN Kirim — menu
                  lain (Master Item, Transaksi, Sisa Stock, dst) disembunyikan. */}
              {renderSectionHeader('Team Gudang Menu', 'text-blue-400')}
              <div className="space-y-0.5 mt-0.5">
                {renderNavItem({
                  id: 'do_open' as ActiveTab,
                  label: 'DO OPEN',
                  icon: Clock,
                  badge: counts.doOpenCount
                })}
                {renderNavItem({
                  id: 'request_do_open' as ActiveTab,
                  label: 'Request DO OPEN',
                  icon: Send,
                  badge: counts.requestDoOpenCount
                })}
                {renderNavItem({
                  id: 'report_request_do' as ActiveTab,
                  label: 'Report DO OPEN Kirim',
                  icon: FileCheck
                })}
              </div>
            </div>
          ) : (
            <>
              <div>
                {renderSectionHeader('Main Navigation', 'text-slate-500')}
                <div className="space-y-0.5 mt-0.5">
                  {mainNavItems.map(renderNavItem)}
                </div>
              </div>

              <div>
                {renderSectionHeader('Transactions', 'text-slate-500')}
                <div className="space-y-0.5 mt-0.5">
                  {transactionNavItems.map(renderNavItem)}
                </div>
              </div>

              <div>
                {renderSectionHeader('Reports & Analysis', 'text-slate-500')}
                <div className="space-y-0.5 mt-0.5">
                  {reportNavItems.map(renderNavItem)}
                </div>
              </div>

              {(isAdmin || isAudit) && (
                <div>
                  {renderSectionHeader('Otorisasi Admin', 'text-indigo-400')}
                  <div className="space-y-0.5 mt-0.5">
                    {adminNavItems.map(renderNavItem)}
                    {isAdmin && adminOnlyNavItems.map(renderNavItem)}
                  </div>
                </div>
              )}
            </>
          )}
        </nav>
      </div>

      {/* Footer User Info & Sign Out Box - Always Pinned at Bottom */}
      <div className={`p-2.5 bg-slate-950/90 border-t border-slate-800 text-[11px] text-slate-400 space-y-2 shrink-0 mt-auto ${isCollapsed ? 'flex flex-col items-center' : ''}`}>
        {currentUser && (
          <div className={`bg-slate-900/90 rounded-lg border border-slate-800 ${isCollapsed ? 'p-1.5 flex justify-center w-full' : 'p-2 flex items-center justify-between'}`}>
            <div className={`flex items-center gap-2 min-w-0 ${isCollapsed ? 'justify-center' : ''}`}>
              <div 
                className="p-1.5 rounded-full bg-slate-800 text-emerald-400 border border-slate-700 shrink-0"
                title={isCollapsed ? `${currentUser.displayName || currentUser.nik} (${currentUser.role})` : undefined}
              >
                <UserCheck className="w-3.5 h-3.5" />
              </div>
              {!isCollapsed && (
                <div className="min-w-0">
                  <div className="font-semibold text-slate-200 truncate text-xs">
                    {currentUser.displayName || currentUser.nik}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                    <span>{currentUser.role}</span>
                    <span>•</span>
                    <span>{currentUser.nik}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sign Out (Keluar) Button */}
        {onLogout && (
          <button
            onClick={onLogout}
            className={`flex items-center justify-center gap-2 ${isCollapsed ? 'w-full p-2' : 'w-full px-3 py-2'} bg-rose-500/10 hover:bg-rose-500/20 active:bg-rose-500/30 text-rose-300 hover:text-rose-200 border border-rose-500/30 text-xs font-semibold rounded-lg transition shadow-xs cursor-pointer active:scale-98`}
            title="Keluar dari akun (Sign Out)"
          >
            <LogOut className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            {!isCollapsed && <span>Keluar (Sign Out)</span>}
          </button>
        )}

        {!isCollapsed && (
          <div className="pt-1 border-t border-slate-800/80 flex justify-between items-center text-[10px] text-slate-500 font-mono">
            <span>System: <strong className="text-emerald-400 font-normal">SQL Server</strong></span>
            <span>Reconcile: <strong className="text-blue-400 font-normal">Active</strong></span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Permanent Sidebar */}
      <aside className={`hidden md:flex ${isCollapsed ? 'w-16' : 'w-56'} bg-slate-900 text-slate-300 shrink-0 flex-col border-r border-slate-800 select-none h-full min-h-0 overflow-y-auto transition-all duration-300 ease-in-out`}>
        {navContent}
      </aside>

      {/* Mobile Backdrop & Slide-over Drawer */}
      {isMobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop Overlay */}
          <div 
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
            onClick={onCloseMobile}
          />

          {/* Mobile Drawer Panel */}
          <aside className="relative w-64 max-w-[80vw] bg-slate-900 text-slate-300 h-full min-h-0 flex flex-col border-r border-slate-800 shadow-2xl z-10 animate-in slide-in-from-left duration-200 overflow-y-auto">
            {navContent}
          </aside>
        </div>
      )}
    </>
  );
};

