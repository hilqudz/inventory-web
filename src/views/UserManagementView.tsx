import React, { useState, useMemo } from 'react';
import { 
  Users, 
  UserCheck, 
  UserX, 
  Clock, 
  ShieldCheck, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  Search,
  UserPlus,
  X,
  Key
} from 'lucide-react';
import { AppUser, UserProfile, UserRole } from '../types';
import { approveUserSupabase, deleteUserSupabase, addUserSupabase, resetUserPassword } from '../api';
import { SortableHeader } from '../components/SortableHeader';
import { sortData, SortConfig, SortDirection } from '../utils/sorting';

interface UserManagementViewProps {
  currentUser: UserProfile | null;
  usersList: AppUser[];
  onRefreshUsers: () => void;
}

export const UserManagementView: React.FC<UserManagementViewProps> = ({
  currentUser,
  usersList,
  onRefreshUsers
}) => {
  // Permintaan Pak Irvan 2026-08-18: Audit HANYA boleh approve/reject
  // pengajuan baru — tidak boleh reset password, tidak boleh lihat/kelola
  // user yang sudah disetujui. Server (userRoutes.ts) sudah membatasi data
  // yang dikirim (GET /api/users cuma balikin pending untuk Audit); ini
  // lapisan UI-nya supaya tidak ada tombol yang membingungkan/menyesatkan.
  const isAuditOnly = currentUser?.role === 'Audit';

  const [activeSubTab, setActiveSubTab] = useState<'pending' | 'approved'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Modal State for Direct Add User by Audit
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newNik, setNewNik] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('OPR');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Modal State for Reset Password
  const [resetTarget, setResetTarget] = useState<AppUser | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // Counts
  const pendingUsers = usersList.filter(u => !u.isApproved);
  const approvedUsers = usersList.filter(u => u.isApproved);

  const auditCount = approvedUsers.filter(u => u.role === 'Audit').length;
  const gudangCount = approvedUsers.filter(u => u.role === 'Team Gudang').length;
  const oprCount = approvedUsers.filter(u => u.role === 'OPR').length;
  const bodCount = approvedUsers.filter(u => u.role === 'BOD').length;

  // Sorting
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: null, direction: null });

  const handleSort = (key: string) => {
    let direction: SortDirection = 'asc';
    if (sortConfig.key === key) {
      if (sortConfig.direction === 'asc') direction = 'desc';
      else if (sortConfig.direction === 'desc') direction = null;
    }
    setSortConfig({ key: direction ? key : null, direction });
  };

  // Filtered List
  const displayList = (activeSubTab === 'pending' ? pendingUsers : approvedUsers).filter(u => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (u.nik || '').toLowerCase().includes(q) ||
      (u.displayName || '').toLowerCase().includes(q) ||
      (u.role || '').toLowerCase().includes(q)
    );
  });

  const sortedDisplayList = useMemo(() => {
    return sortData(displayList, sortConfig);
  }, [displayList, sortConfig]);

  const handleApprove = async (user: AppUser) => {
    setProcessingId(user.id || user.nik);
    setNotice(null);

    try {
      const ok = await approveUserSupabase(user.nik, true);
      if (!ok) throw new Error('Server menolak permintaan approve.');

      setNotice({ text: `Berhasil menyetujui user NIK: ${user.nik} (${user.displayName}) dengan Role: ${user.role}!`, type: 'success' });
      onRefreshUsers();
    } catch (err: any) {
      console.error(err);
      setNotice({ text: `Gagal menyetujui user: ${err.message || 'Error'}`, type: 'error' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleRejectOrDelete = async (user: AppUser) => {
    const confirmMsg = user.isApproved 
      ? `Apakah Anda yakin ingin menghapus user NIK: ${user.nik} (${user.displayName})?`
      : `Apakah Anda yakin ingin MENOLAK pengajuan user NIK: ${user.nik} (${user.displayName})?`;

    if (!window.confirm(confirmMsg)) return;

    setProcessingId(user.id || user.nik);
    setNotice(null);

    try {
      const ok = await deleteUserSupabase(user.nik);
      if (!ok) throw new Error('Server menolak permintaan hapus.');

      setNotice({
        text: user.isApproved 
          ? `User NIK: ${user.nik} telah dihapus.` 
          : `Pengajuan user NIK: ${user.nik} berhasil ditolak & dihapus.`, 
        type: 'success' 
      });
      onRefreshUsers();
    } catch (err: any) {
      console.error(err);
      setNotice({ text: `Gagal menghapus user: ${err.message || 'Error'}`, type: 'error' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    if (!resetPasswordValue.trim() || resetPasswordValue.trim().length < 6) {
      setResetError('Password baru wajib diisi, minimal 6 karakter.');
      return;
    }

    setIsResetting(true);
    setResetError(null);

    try {
      const ok = await resetUserPassword(resetTarget.nik, resetPasswordValue.trim());
      if (!ok) throw new Error('Gagal reset password.');

      setNotice({ text: `Password user NIK: ${resetTarget.nik} (${resetTarget.displayName}) berhasil direset.`, type: 'success' });
      setResetTarget(null);
      setResetPasswordValue('');
    } catch (err: any) {
      console.error(err);
      setResetError(`Gagal reset password: ${err.message || 'Error'}`);
    } finally {
      setIsResetting(false);
    }
  };

  const handleDirectAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNik.trim() || !newName.trim() || !newPassword.trim()) {
      setModalError('Seluruh field NIK, Nama, dan Password wajib diisi.');
      return;
    }

    setIsSubmitting(true);
    setModalError(null);

    try {
      const cleanNik = newNik.trim().toLowerCase();

      const ok = await addUserSupabase({
        nik: cleanNik,
        displayName: newName.trim(),
        password: newPassword.trim(),
        role: newRole,
        isApproved: true
      });

      if (!ok) {
        setModalError(`Gagal membuat user — NIK "${cleanNik}" mungkin sudah terdaftar, atau server sedang bermasalah.`);
        setIsSubmitting(false);
        return;
      }

      setIsAddModalOpen(false);
      setNewNik('');
      setNewName('');
      setNewPassword('');
      setNotice({ text: `Berhasil menambahkan user baru (NIK: ${cleanNik}) yang langsung aktif!`, type: 'success' });
      onRefreshUsers();
    } catch (err: any) {
      console.error(err);
      setModalError(`Gagal membuat user: ${err.message || 'Error'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-indigo-600" />
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              {isAuditOnly ? 'Otorisasi Pengajuan User' : 'Otorisasi & Manajemen User'}
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {isAuditOnly
              ? 'Setujui atau tolak pengajuan akun baru. Reset password dan pengelolaan user aktif hanya bisa dilakukan Admin.'
              : 'Kelola pengajuan akun baru, persetujuan otorisasi User Role Audit, dan hak akses pengguna sistem.'}
          </p>
        </div>

        {!isAuditOnly && (
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center justify-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-sm transition"
          >
            <UserPlus className="w-4 h-4" />
            <span>Tambah User Disetujui</span>
          </button>
        )}
      </div>

      {/* Notice Banner */}
      {notice && (
        <div className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
          notice.type === 'success' 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          <div className="flex items-center gap-2">
            {notice.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />}
            <span className="font-medium">{notice.text}</span>
          </div>
          <button onClick={() => setNotice(null)} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Summary KPI Cards — breakdown per role user aktif disembunyikan dari
          Audit (mereka cuma boleh lihat antrian pending, bukan komposisi user
          yang sudah disetujui). */}
      <div className={`grid grid-cols-2 ${isAuditOnly ? '' : 'md:grid-cols-5'} gap-3`}>

        <div className="bg-amber-50/70 border border-amber-200 p-4 rounded-2xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Menunggu Otorisasi</span>
            <Clock className="w-5 h-5 text-amber-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-amber-900 font-mono">
            {pendingUsers.length} <span className="text-xs font-normal text-amber-700">Pengajuan</span>
          </div>
        </div>

        {!isAuditOnly && (
          <>
            <div className="bg-indigo-50/70 border border-indigo-200 p-4 rounded-2xl">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">Role Audit</span>
                <ShieldCheck className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="mt-2 text-2xl font-black text-indigo-900 font-mono">
                {auditCount} <span className="text-xs font-normal text-indigo-700">User</span>
              </div>
            </div>

            <div className="bg-blue-50/70 border border-blue-200 p-4 rounded-2xl">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700">Role Team Gudang</span>
                <Users className="w-5 h-5 text-blue-600" />
              </div>
              <div className="mt-2 text-2xl font-black text-blue-900 font-mono">
                {gudangCount} <span className="text-xs font-normal text-blue-700">User</span>
              </div>
            </div>

            <div className="bg-teal-50/70 border border-teal-200 p-4 rounded-2xl">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-teal-700">Role OPR</span>
                <UserCheck className="w-5 h-5 text-teal-600" />
              </div>
              <div className="mt-2 text-2xl font-black text-teal-900 font-mono">
                {oprCount} <span className="text-xs font-normal text-teal-700">User</span>
              </div>
            </div>

            <div className="bg-purple-50/70 border border-purple-200 p-4 rounded-2xl">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-purple-700">Role BOD</span>
                <ShieldCheck className="w-5 h-5 text-purple-600" />
              </div>
              <div className="mt-2 text-2xl font-black text-purple-900 font-mono">
                {bodCount} <span className="text-xs font-normal text-purple-700">User</span>
              </div>
            </div>
          </>
        )}

      </div>

      {/* Tabs & Search Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-50 p-2 rounded-2xl border border-slate-200">
        
        <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200">
          <button
            onClick={() => setActiveSubTab('pending')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1.5 ${
              activeSubTab === 'pending'
                ? 'bg-amber-500 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Pengajuan Baru ({pendingUsers.length})</span>
          </button>

          {!isAuditOnly && (
            <button
              onClick={() => setActiveSubTab('approved')}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1.5 ${
                activeSubTab === 'approved'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>User Disetujui ({approvedUsers.length})</span>
            </button>
          )}
        </div>

        {/* Search Field */}
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari NIK, Nama, atau Role..."
            className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

      </div>

      {/* Users Data Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[10px]">
                <SortableHeader
                  label="NIK (Username)"
                  field="nik"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Nama Lengkap"
                  field="displayName"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Role Yang Diminta"
                  field="role"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Status Otorisasi"
                  field="isApproved"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Tanggal Pengajuan / Disetujui"
                  field="createdAt"
                  currentSortKey={sortConfig.key}
                  currentDirection={sortConfig.direction}
                  onSort={handleSort}
                />
                <th className="p-3 text-center">Aksi Otorisasi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedDisplayList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400 text-xs">
                    {activeSubTab === 'pending'
                      ? 'Tidak ada pengajuan user baru yang menunggu otorisasi.'
                      : 'Tidak ada data user terdaftar.'}
                  </td>
                </tr>
              ) : (
                sortedDisplayList.map((u) => {
                  const isPending = !u.isApproved;
                  const userKey = u.id || u.nik;
                  let roleBadgeClass = 'bg-slate-100 text-slate-700 border-slate-200';
                  if (u.role === 'Audit') roleBadgeClass = 'bg-indigo-50 text-indigo-700 border-indigo-200';
                  if (u.role === 'Team Gudang') roleBadgeClass = 'bg-blue-50 text-blue-700 border-blue-200';
                  if (u.role === 'OPR') roleBadgeClass = 'bg-teal-50 text-teal-700 border-teal-200';
                  if (u.role === 'BOD') roleBadgeClass = 'bg-purple-50 text-purple-700 border-purple-200';

                  return (
                    <tr key={userKey} className="hover:bg-slate-50/80 transition">
                      
                      {/* NIK */}
                      <td className="p-3 font-mono font-bold text-slate-900">
                        {u.nik}
                      </td>

                      {/* Display Name */}
                      <td className="p-3 font-medium text-slate-800">
                        {u.displayName}
                      </td>

                      {/* Role */}
                      <td className="p-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${roleBadgeClass}`}>
                          {u.role}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="p-3">
                        {isPending ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded text-[10px] font-semibold">
                            <Clock className="w-3 h-3 text-amber-600" />
                            Menunggu Otorisasi Audit
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded text-[10px] font-semibold">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Aktif & Disetujui
                          </span>
                        )}
                      </td>

                      {/* Dates */}
                      <td className="p-3 text-slate-500 text-[11px] font-mono">
                        {isPending ? (
                          <span>Created: {u.createdAt ? new Date(u.createdAt).toLocaleDateString('id-ID') : '-'}</span>
                        ) : (
                          <div>
                            <div>Appr: {u.approvedAt ? new Date(u.approvedAt).toLocaleDateString('id-ID') : '-'}</div>
                            <div className="text-[10px] text-slate-400">By: {u.approvedBy || 'Audit'}</div>
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {isPending && (
                            <button
                              onClick={() => handleApprove(u)}
                              disabled={processingId === u.id}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded text-[11px] shadow-2xs transition flex items-center gap-1"
                              title="Setujui Pengajuan User Ini"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Setujui</span>
                            </button>
                          )}

                          {!isPending && !isAuditOnly && (
                            <button
                              onClick={() => { setResetTarget(u); setResetPasswordValue(''); setResetError(null); }}
                              disabled={processingId === u.id}
                              className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 font-semibold rounded text-[11px] transition flex items-center gap-1"
                              title="Reset Password User Ini"
                            >
                              <Key className="w-3.5 h-3.5" />
                              <span>Reset Pass</span>
                            </button>
                          )}

                          <button
                            onClick={() => handleRejectOrDelete(u)}
                            disabled={processingId === u.id}
                            className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold rounded text-[11px] transition flex items-center gap-1"
                            title={isPending ? "Tolak Pengajuan" : "Hapus User"}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{isPending ? 'Tolak' : 'Hapus'}</span>
                          </button>
                        </div>
                      </td>

                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Direct Add User by Audit */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-slate-100 animate-in fade-in zoom-in duration-200">
            
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-indigo-600" />
                Tambah User Disetujui (Direct)
              </h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                {modalError}
              </div>
            )}

            <form onSubmit={handleDirectAddUser} className="mt-4 space-y-3.5 text-xs">
              
              <div>
                <label className="block font-semibold text-slate-700 mb-1">NIK / Username *</label>
                <input
                  type="text"
                  required
                  value={newNik}
                  onChange={(e) => setNewNik(e.target.value)}
                  placeholder="Contoh: 100201"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nama Lengkap *</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Contoh: Budi Santoso"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Password *</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Role User *</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="Audit">Audit</option>
                  <option value="Team Gudang">Team Gudang</option>
                  <option value="OPR">OPR</option>
                  <option value="BOD">BOD</option>
                </select>
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
                  disabled={isSubmitting}
                  className="px-5 py-2 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-sm flex items-center gap-1.5"
                >
                  <UserPlus className="w-4 h-4" />
                  {isSubmitting ? 'Menyimpan...' : 'Simpan User'}
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

      {/* Modal Reset Password */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-slate-100 animate-in fade-in zoom-in duration-200">

            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Key className="w-5 h-5 text-amber-600" />
                Reset Password
              </h3>
              <button onClick={() => setResetTarget(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="mt-4 text-xs text-slate-600">
              Reset password untuk <span className="font-semibold text-slate-800">{resetTarget.displayName}</span>{' '}
              (NIK: <span className="font-mono">{resetTarget.nik}</span>). Password lama akan langsung tidak berlaku.
            </p>

            {resetError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                {resetError}
              </div>
            )}

            <form onSubmit={handleResetPassword} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Password Baru *</label>
                <input
                  type="text"
                  required
                  value={resetPasswordValue}
                  onChange={(e) => setResetPasswordValue(e.target.value)}
                  placeholder="Minimal 6 karakter"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="px-4 py-2 font-medium text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isResetting}
                  className="px-5 py-2 font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition shadow-sm flex items-center gap-1.5"
                >
                  <Key className="w-4 h-4" />
                  {isResetting ? 'Menyimpan...' : 'Reset Password'}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
};
