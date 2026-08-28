import React, { useState } from 'react';
import { 
  Warehouse, 
  Lock, 
  UserCheck, 
  ArrowRight, 
  ShieldCheck, 
  AlertCircle, 
  KeyRound, 
  Sparkles,
  Users,
  Clock,
  CheckCircle2,
  UserPlus,
  BadgeCheck
} from 'lucide-react';
import { fetchUsersSupabase, verifyLoginSupabase, addUserSupabase, loadLocalCache, saveLocalCache, supabase } from '../api';
import { UserProfile, UserRole, AppUser } from '../types';

interface LoginViewProps {
  onLoginSuccess: (user: UserProfile) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  // Mode Switch
  const [isRegistering, setIsRegistering] = useState(false);

  // Login Form State
  const [nik, setNik] = useState('');
  const [password, setPassword] = useState('');

  // Register Form State
  const [regNik, setRegNik] = useState('');
  const [regName, setRegName] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regRole, setRegRole] = useState<UserRole>('Team Gudang');

  // Async States
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Handle Login
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    const cleanNik = nik.trim().toLowerCase();

    try {
      // Verifikasi NIK/password + status approval sepenuhnya dilakukan server
      // (bcrypt + cek IsApproved) — pesan error server sudah jelas per kasus
      // ("NIK atau password salah." vs "Akun belum di-approve Admin."), jadi
      // ditampilkan apa adanya, bukan pesan generik yang menutupi bedanya.
      const { data: rpcData, error: rpcErr } = await supabase.rpc('verify_login', {
        p_nik: cleanNik,
        p_password: password
      });

      if (rpcErr || !rpcData) {
        setError(rpcErr?.message || `NIK / User Name "${nik}" belum terdaftar atau Password salah.`);
        return;
      }

      const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      onLoginSuccess({
        uid: `sb-${row.id || row.nik || cleanNik}`,
        nik: row.nik || cleanNik,
        displayName: row.nama_lengkap || row.nik || cleanNik,
        role: row.role || 'Team Gudang',
        isApproved: true,
        email: `${row.nik || cleanNik}@gudang.id`
      });

    } catch (err: any) {
      console.error('Login error:', err);
      setError(`Gagal terhubung ke database: ${err.message || 'Error'}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle Register
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!regNik.trim() || !regName.trim() || !regPassword.trim()) {
      setError('Seluruh field NIK, Nama Lengkap, dan Password wajib diisi.');
      return;
    }

    setLoading(true);
    const cleanNik = regNik.trim().toLowerCase();

    try {
      // Simpan user baru (isApproved: false, wajib approval Admin). Cek NIK
      // duplikat dilakukan server-side (409) — tidak perlu cek terpisah di sini.
      const ok = await addUserSupabase({
        nik: cleanNik,
        displayName: regName.trim(),
        password: regPassword.trim(),
        role: regRole,
        isApproved: false
      });

      if (!ok) {
        setError(`Gagal mendaftar — NIK "${regNik.trim()}" mungkin sudah terdaftar, atau server sedang bermasalah. Coba NIK lain atau hubungi Admin.`);
        setLoading(false);
        return;
      }

      // Update local cache so Audit Role sees it immediately
      try {
        const newPendingUser: AppUser = {
          id: `pending_${cleanNik}`,
          nik: cleanNik,
          displayName: regName.trim(),
          password: regPassword.trim(),
          role: regRole,
          isApproved: false,
          createdAt: new Date().toISOString()
        };
        const currentCache = loadLocalCache<AppUser>('users_list');
        const updatedCache = [newPendingUser, ...currentCache.filter(u => u.nik?.toLowerCase() !== cleanNik)];
        saveLocalCache('users_list', updatedCache, true);
      } catch (cacheErr) {
        console.warn('Cache user save notice:', cacheErr);
      }

      // Show Success Notice
      setSuccessMsg(`Pendaftaran Berhasil! Pengajuan user baru NIK "${cleanNik}" (${regName.trim()}) telah dikirim. Menunggu otorisasi/persetujuan dari User Role Audit.`);
      setNik(cleanNik);
      setPassword(regPassword.trim());
      setIsRegistering(false);

      // Reset register form
      setRegNik('');
      setRegName('');
      setRegPassword('');

    } catch (err: any) {
      console.error('Registration error:', err);
      setError(`Gagal mendaftar user baru: ${err.message || 'Error'}`);
    } finally {
      setLoading(false);
    }
  };

  // Fast Demo Login Handler
  const handleDemoAccess = (role: UserRole) => {
    let demoNik = 'audit123';
    let demoName = 'Irvan Audit Admin (Demo)';
    if (role === 'Team Gudang') {
      demoNik = 'gudang123';
      demoName = 'Budi Team Gudang (Demo)';
    } else if (role === 'OPR') {
      demoNik = 'opr123';
      demoName = 'Siti Operator (Demo)';
    } else if (role === 'BOD') {
      demoNik = 'bod';
      demoName = 'BOD Executive (Demo)';
    }

    onLoginSuccess({
      uid: `demo-${role.toLowerCase().replace(' ', '-')}`,
      nik: demoNik,
      displayName: demoName,
      role: role,
      isApproved: true,
      email: `${demoNik}@gudang.id`
    });
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Glow */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none"></div>

      <div className="max-w-md w-full bg-slate-800/95 border border-slate-700/80 backdrop-blur-xl rounded-3xl shadow-2xl p-6 sm:p-8 relative z-10 text-white animate-in fade-in zoom-in duration-300">
        
        {/* App Title */}
        <div className="text-center mb-6">
          <div className="inline-flex p-3.5 bg-blue-600/20 border border-blue-500/30 text-blue-400 rounded-2xl mb-3 shadow-inner">
            <Warehouse className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Aplikasi Inventory Gudang
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Sistem Kelola Stok, Otorisasi User Role & Rekonsiliasi DO OPEN
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="flex bg-slate-900/90 p-1 rounded-xl border border-slate-700/60 mb-5">
          <button
            type="button"
            onClick={() => { setIsRegistering(false); setError(null); }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${
              !isRegistering ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            Masuk User
          </button>
          <button
            type="button"
            onClick={() => { setIsRegistering(true); setError(null); }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${
              isRegistering ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            Daftar User Baru
          </button>
        </div>

        {/* Success Alert */}
        {successMsg && (
          <div className="mb-4 p-3.5 bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 rounded-xl text-xs flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
            <span className="leading-relaxed">{successMsg}</span>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="mb-4 p-3.5 bg-rose-500/15 border border-rose-500/40 text-rose-300 rounded-xl text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        {/* LOGIN FORM */}
        {!isRegistering ? (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                User Name (NIK)
              </label>
              <div className="relative">
                <Users className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  required
                  value={nik}
                  onChange={(e) => setNik(e.target.value)}
                  placeholder="Masukkan NIK / User Name"
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-600/30 transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                'Memeriksa Database...'
              ) : (
                <>
                  <span>Masuk Ke Sistem</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        ) : (
          /* REGISTER FORM */
          <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                User Name (NIK) *
              </label>
              <div className="relative">
                <Users className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  required
                  value={regNik}
                  onChange={(e) => setRegNik(e.target.value)}
                  placeholder="Contoh: 100201"
                  className="w-full pl-9 pr-4 py-2 bg-slate-900/90 border border-slate-700 rounded-xl text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Nama Lengkap *
              </label>
              <input
                type="text"
                required
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="Contoh: Irvan Permana"
                className="w-full px-3 py-2 bg-slate-900/90 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Password *
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  required
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-4 py-2 bg-slate-900/90 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Pilih User Role *
              </label>
              <select
                value={regRole}
                onChange={(e) => setRegRole(e.target.value as UserRole)}
                className="w-full px-3 py-2 bg-slate-900/90 border border-slate-700 rounded-xl text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              >
                <option value="Audit">Audit</option>
                <option value="Team Gudang">Team Gudang</option>
                <option value="OPR">OPR</option>
                <option value="BOD">BOD</option>
              </select>
            </div>

            <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-[11px] text-amber-300 flex items-center gap-2">
              <Clock className="w-4 h-4 shrink-0 text-amber-400" />
              <span>Pengajuan user baru memerlukan otorisasi/persetujuan dari User Role Audit.</span>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-600/30 transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                'Mengirim Pengajuan...'
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>Kirim Pengajuan User Baru</span>
                </>
              )}
            </button>
          </form>
        )}



      </div>
    </div>
  );
};
