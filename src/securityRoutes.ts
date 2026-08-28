import type { Express, Response } from "express";
import { getPool, sql } from "./db";
import { authRequired, requireRole, type AuthedRequest } from "./auth";

/* Routes Keamanan — Admin only. Ringkasan LoginAttempts (lihat sql/008) untuk
   deteksi pola brute-force / percobaan akses tidak sah, ditampilkan di menu
   "Keamanan" pada UI. Bukan pengganti monitoring infrastruktur (fail2ban,
   vnstat, dll di VPS) — ini murni visibilitas percobaan login ke aplikasi. */

const dbError = (res: Response, label: string, err: any) => {
  console.error(`Error ${label}:`, err?.message || err);
  res.status(500).json({ error: "Operasi database gagal." });
};

export function registerSecurityRoutes(app: Express) {
  // GET /api/security/login-attempts?hours=24 — daftar percobaan login gagal
  // terbaru + ringkasan IP dengan kegagalan berulang (indikasi brute-force).
  app.get(
    "/api/security/login-attempts",
    authRequired,
    requireRole("Admin"),
    async (req: AuthedRequest, res) => {
      try {
        const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 720);
        const pool = await getPool();

        const recent = await pool
          .request()
          .input("Hours", sql.Int, hours)
          .query(`
            SELECT TOP 200 Nik, IpAddress, Success, FailReason, AttemptedAt
            FROM dbo.LoginAttempts
            WHERE AttemptedAt >= DATEADD(HOUR, -@Hours, SYSUTCDATETIME())
            ORDER BY AttemptedAt DESC
          `);

        const suspiciousIps = await pool
          .request()
          .input("Hours", sql.Int, hours)
          .query(`
            SELECT IpAddress, COUNT(*) AS FailCount, MAX(AttemptedAt) AS LastAttempt,
                   COUNT(DISTINCT Nik) AS DistinctNikTried
            FROM dbo.LoginAttempts
            WHERE Success = 0 AND AttemptedAt >= DATEADD(HOUR, -@Hours, SYSUTCDATETIME())
            GROUP BY IpAddress
            HAVING COUNT(*) >= 5
            ORDER BY COUNT(*) DESC
          `);

        res.json({
          windowHours: hours,
          recentAttempts: recent.recordset.map((r: any) => ({
            nik: r.Nik,
            ipAddress: r.IpAddress,
            success: Boolean(r.Success),
            failReason: r.FailReason,
            attemptedAt: r.AttemptedAt,
          })),
          suspiciousIps: suspiciousIps.recordset.map((r: any) => ({
            ipAddress: r.IpAddress,
            failCount: Number(r.FailCount),
            distinctNikTried: Number(r.DistinctNikTried),
            lastAttempt: r.LastAttempt,
          })),
        });
      } catch (err) {
        dbError(res, "GET /api/security/login-attempts", err);
      }
    }
  );
}
