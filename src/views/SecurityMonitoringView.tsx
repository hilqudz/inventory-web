import React, { useEffect, useState } from 'react';
import { ShieldAlert, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { fetchLoginAttempts, LoginAttempt, SuspiciousIp } from '../api';

const FAIL_REASON_LABEL: Record<string, string> = {
  user_not_found: 'NIK tidak terdaftar',
  wrong_password: 'Password salah',
  not_approved: 'Akun belum di-approve',
};

export const SecurityMonitoringView: React.FC = () => {
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recentAttempts, setRecentAttempts] = useState<LoginAttempt[]>([]);
  const [suspiciousIps, setSuspiciousIps] = useState<SuspiciousIp[]>([]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLoginAttempts(hours);
      setRecentAttempts(data.recentAttempts);
      setSuspiciousIps(data.suspiciousIps);
    } catch (err: any) {
      setError(err.message || 'Gagal memuat data keamanan.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours]);

  const failedCount = recentAttempts.filter(a => !a.success).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-rose-600" />
            Keamanan — Percobaan Login
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Jejak percobaan login ke aplikasi (sukses & gagal), untuk deteksi pola brute-force / akses tidak sah.
            Khusus Admin.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl font-semibold text-slate-700"
          >
            <option value={1}>1 jam terakhir</option>
            <option value={24}>24 jam terakhir</option>
            <option value={168}>7 hari terakhir</option>
            <option value={720}>30 hari terakhir</option>
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 text-slate-600 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading && !error ? (
        <div className="flex items-center justify-center gap-2 text-sm text-slate-500 py-12">
          <Loader2 className="w-5 h-5 animate-spin" />
          Memuat data...
        </div>
      ) : (
        <>
          {/* IP Mencurigakan */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 mb-3">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              IP Mencurigakan (≥5 percobaan gagal dalam periode ini)
            </h3>
            {suspiciousIps.length === 0 ? (
              <div className="text-xs text-slate-400 flex items-center gap-1.5 py-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                Tidak ada pola mencurigakan terdeteksi di periode ini.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="p-2 font-semibold">IP Address</th>
                      <th className="p-2 font-semibold">Jumlah Gagal</th>
                      <th className="p-2 font-semibold">NIK Berbeda Dicoba</th>
                      <th className="p-2 font-semibold">Terakhir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suspiciousIps.map((ip, idx) => (
                      <tr key={idx} className="border-b border-slate-100">
                        <td className="p-2 font-mono font-semibold text-rose-700">{ip.ipAddress || '(tidak diketahui)'}</td>
                        <td className="p-2 font-bold text-rose-700">{ip.failCount}</td>
                        <td className="p-2">{ip.distinctNikTried}</td>
                        <td className="p-2 text-slate-500">{new Date(ip.lastAttempt).toLocaleString('id-ID')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Riwayat Percobaan */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <h3 className="text-sm font-bold text-slate-800 mb-3">
              Riwayat Percobaan Login Terbaru (maks 200) — {failedCount} gagal dari {recentAttempts.length} total
            </h3>
            {recentAttempts.length === 0 ? (
              <div className="text-xs text-slate-400 py-2">Belum ada data di periode ini.</div>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-xs text-left">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="p-2 font-semibold">Waktu</th>
                      <th className="p-2 font-semibold">NIK</th>
                      <th className="p-2 font-semibold">IP Address</th>
                      <th className="p-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentAttempts.map((a, idx) => (
                      <tr key={idx} className="border-b border-slate-100">
                        <td className="p-2 text-slate-500">{new Date(a.attemptedAt).toLocaleString('id-ID')}</td>
                        <td className="p-2 font-mono">{a.nik || '-'}</td>
                        <td className="p-2 font-mono">{a.ipAddress || '-'}</td>
                        <td className="p-2">
                          {a.success ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Sukses
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-rose-700 font-semibold">
                              <XCircle className="w-3.5 h-3.5" /> {FAIL_REASON_LABEL[a.failReason || ''] || 'Gagal'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
