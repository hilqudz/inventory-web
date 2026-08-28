import type { Express, Response } from "express";
import bcrypt from "bcrypt";
import { getPool, sql } from "./db";
import { authRequired, requireRole, loginRateLimit, type AuthedRequest } from "./auth";

/* Routes Users — pengganti fetchUsersSupabase/addUserSupabase/approveUserSupabase/
   deleteUserSupabase. Bentuk response = AppUser (src/types.ts) TANPA kolom
   password — hash sekalipun tidak pernah dikirim (docs/API-ENDPOINTS.md).

   - GET/POST/PATCH/DELETE /api/users : Admin only
   - POST /api/auth/register          : publik (self-register dari LoginView),
     selalu IsApproved=0, role Admin TIDAK bisa didaftarkan sendiri. */

const VALID_ROLES = ["Admin", "Audit", "Team Gudang", "OPR", "BOD"];
const SELF_REGISTER_ROLES = VALID_ROLES.filter((r) => r !== "Admin");

const mapRow = (row: any) => ({
  id: row.Nik,
  nik: row.Nik,
  displayName: row.NamaLengkap,
  role: row.Role,
  isApproved: Boolean(row.IsApproved),
  createdAt: row.CreatedAt,
  approvedBy: row.ApprovedBy ?? undefined,
  approvedAt: row.ApprovedAt ?? undefined,
});

const dbError = (res: Response, label: string, err: any) => {
  console.error(`Error ${label}:`, err?.message || err);
  res.status(500).json({ error: "Operasi database gagal. Cek tunnel SSH masih terbuka." });
};

function validateNewUser(b: any, allowedRoles: string[]): string | null {
  if (!b || typeof b.nik !== "string" || !b.nik.trim()) return "nik wajib diisi.";
  if (typeof b.displayName !== "string" || !b.displayName.trim()) return "displayName wajib diisi.";
  if (typeof b.password !== "string" || b.password.length < 6) return "password wajib diisi, minimal 6 karakter.";
  if (!allowedRoles.includes(b.role)) return `role harus salah satu dari: ${allowedRoles.join(", ")}.`;
  return null;
}

async function insertUser(b: any, isApproved: boolean): Promise<"created" | "exists"> {
  const pool = await getPool();
  const hash = await bcrypt.hash(b.password, 10);
  try {
    await pool
      .request()
      .input("Nik", sql.NVarChar(50), b.nik.trim().toLowerCase())
      .input("NamaLengkap", sql.NVarChar(200), b.displayName.trim())
      .input("PasswordHash", sql.NVarChar(255), hash)
      .input("Role", sql.NVarChar(50), b.role)
      .input("IsApproved", sql.Bit, isApproved ? 1 : 0)
      .query(`
        INSERT INTO dbo.Users (Nik, NamaLengkap, PasswordHash, Role, IsApproved)
        VALUES (@Nik, @NamaLengkap, @PasswordHash, @Role, @IsApproved)
      `);
    return "created";
  } catch (err: any) {
    if (err?.number === 2627 || err?.number === 2601) return "exists";
    throw err;
  }
}

export function registerUserRoutes(app: Express) {
  // POST /api/auth/register — publik, self-register menunggu approval Admin
  app.post("/api/auth/register", loginRateLimit, async (req, res) => {
    const invalid = validateNewUser(req.body, SELF_REGISTER_ROLES);
    if (invalid) return res.status(400).json({ error: invalid });
    try {
      const result = await insertUser(req.body, false);
      if (result === "exists") return res.status(409).json({ error: "NIK sudah terdaftar. Silakan login." });
      res.status(201).json({ success: true, message: "Pendaftaran berhasil, menunggu approval Admin." });
    } catch (err) {
      dbError(res, "POST /api/auth/register", err);
    }
  });

  // GET /api/users — Admin only, TANPA kolom password
  // Admin lihat semua user; Audit HANYA lihat pengajuan yang masih pending
  // (permintaan Pak Irvan 2026-08-18: Audit boleh approve/reject pengajuan
  // baru, tapi tidak boleh lihat/kelola daftar user yang sudah disetujui).
  app.get("/api/users", authRequired, requireRole("Admin", "Audit"), async (req: AuthedRequest, res) => {
    try {
      const pool = await getPool();
      const isAudit = req.user!.role === "Audit";
      const query = isAudit
        ? "SELECT Nik, NamaLengkap, Role, IsApproved, CreatedAt, ApprovedBy, ApprovedAt FROM dbo.Users WHERE IsApproved = 0 ORDER BY CreatedAt"
        : "SELECT Nik, NamaLengkap, Role, IsApproved, CreatedAt, ApprovedBy, ApprovedAt FROM dbo.Users ORDER BY CreatedAt";
      const result = await pool.request().query(query);
      res.json(result.recordset.map(mapRow));
    } catch (err) {
      dbError(res, "GET /api/users", err);
    }
  });

  // POST /api/users — Admin only; boleh langsung approved
  app.post("/api/users", authRequired, requireRole("Admin"), async (req: AuthedRequest, res) => {
    const invalid = validateNewUser(req.body, VALID_ROLES);
    if (invalid) return res.status(400).json({ error: invalid });
    try {
      const result = await insertUser(req.body, req.body.isApproved !== false);
      if (result === "exists") return res.status(409).json({ error: "NIK sudah terdaftar." });
      res.status(201).json({ success: true });
    } catch (err) {
      dbError(res, "POST /api/users", err);
    }
  });

  // PATCH /api/users/:nik/approve — Admin & Audit; body { isApproved: boolean }.
  // Audit HANYA boleh approve (isApproved:true) pengajuan yang masih pending —
  // tidak boleh un-approve user yang sudah aktif (permintaan Pak Irvan 2026-08-18).
  app.patch("/api/users/:nik/approve", authRequired, requireRole("Admin", "Audit"), async (req: AuthedRequest, res) => {
    const isApproved = req.body?.isApproved;
    if (typeof isApproved !== "boolean") {
      return res.status(400).json({ error: "Body harus { isApproved: true/false }." });
    }
    const isAudit = req.user!.role === "Audit";
    if (isAudit && isApproved !== true) {
      return res.status(403).json({ error: "Audit hanya boleh menyetujui pengajuan, tidak bisa membatalkan approval user aktif." });
    }
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input("Nik", sql.NVarChar(50), req.params.nik.trim().toLowerCase())
        .input("IsApproved", sql.Bit, isApproved ? 1 : 0)
        .input("ApprovedBy", sql.NVarChar(50), req.user!.nik)
        .query(`
          UPDATE dbo.Users SET
            IsApproved = @IsApproved,
            ApprovedBy = CASE WHEN @IsApproved = 1 THEN @ApprovedBy ELSE ApprovedBy END,
            ApprovedAt = CASE WHEN @IsApproved = 1 THEN SYSUTCDATETIME() ELSE ApprovedAt END
          WHERE Nik = @Nik ${isAudit ? "AND IsApproved = 0" : ""}
        `);
      if (!result.rowsAffected[0]) return res.status(404).json({ error: "User tidak ditemukan." });
      res.json({ success: true });
    } catch (err) {
      dbError(res, "PATCH /api/users/:nik/approve", err);
    }
  });

  // PATCH /api/users/:nik/reset-password — Admin only; body { newPassword: string }
  app.patch("/api/users/:nik/reset-password", authRequired, requireRole("Admin"), async (req: AuthedRequest, res) => {
    const newPassword = req.body?.newPassword;
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      return res.status(400).json({ error: "newPassword wajib diisi, minimal 6 karakter." });
    }
    try {
      const pool = await getPool();
      const hash = await bcrypt.hash(newPassword, 10);
      const result = await pool
        .request()
        .input("Nik", sql.NVarChar(50), req.params.nik.trim().toLowerCase())
        .input("PasswordHash", sql.NVarChar(255), hash)
        .query("UPDATE dbo.Users SET PasswordHash = @PasswordHash WHERE Nik = @Nik");
      if (!result.rowsAffected[0]) return res.status(404).json({ error: "User tidak ditemukan." });
      res.json({ success: true });
    } catch (err) {
      dbError(res, "PATCH /api/users/:nik/reset-password", err);
    }
  });

  // DELETE /api/users/:nik — Admin & Audit; tidak bisa hapus akun sendiri.
  // Audit HANYA boleh "Tolak" pengajuan yang masih pending — tidak bisa hapus
  // user yang sudah aktif/disetujui (permintaan Pak Irvan 2026-08-18).
  app.delete("/api/users/:nik", authRequired, requireRole("Admin", "Audit"), async (req: AuthedRequest, res) => {
    const nik = req.params.nik.trim().toLowerCase();
    if (nik === req.user!.nik) {
      return res.status(400).json({ error: "Tidak bisa menghapus akun sendiri." });
    }
    const isAudit = req.user!.role === "Audit";
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input("Nik", sql.NVarChar(50), nik)
        .query(`DELETE FROM dbo.Users WHERE Nik = @Nik ${isAudit ? "AND IsApproved = 0" : ""}`);
      if (!result.rowsAffected[0]) {
        return res.status(isAudit ? 403 : 404).json({
          error: isAudit
            ? "Audit hanya bisa menolak pengajuan yang masih pending, tidak bisa menghapus user aktif."
            : "User tidak ditemukan.",
        });
      }
      res.json({ success: true });
    } catch (err) {
      dbError(res, "DELETE /api/users/:nik", err);
    }
  });
}
