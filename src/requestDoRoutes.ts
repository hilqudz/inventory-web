import type { Express, Response } from "express";
import { getPool, sql } from "./db";
import { authRequired, requireRole, type AuthedRequest } from "./auth";
import { ensureMasterItems } from "./dbHelpers";

/* Routes Request DO Open (approval flow OPR) — pengganti fetchRequestDoOpen/
   addRequestDoOpen/bulkAddRequestDoOpen/updateRequestDoOpenStatus/
   deleteRequestDoOpen di src/supabase.ts. Bentuk response = RequestDoRecord.

   Role check (docs/API-ENDPOINTS.md — paling ketat):
   - POST & /bulk        : OPR (yang mengajukan)
   - PATCH /:id/status   : Admin/Team Gudang (approve/reject)
   - DELETE /:id         : Admin/Team Gudang
   - GET                 : semua role, tapi OPR hanya lihat request miliknya
     (RequestedByNik = nik dari token — kolom audit baru, tidak ada di skema lama)

   Kompatibilitas id lama: :id boleh UUID atau DocumentNo (versi lama juga
   fallback ke document_no kalau id bukan UUID). */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const mapRow = (row: any) => ({
  id: String(row.Id).toLowerCase(),
  doOpenId: String(row.Id).toLowerCase(),
  postingDate: row.TanggalRequest || "",
  entryName: row.AreaRmOpr || "",
  documentNo: row.DocumentNo || "",
  itemCode: row.ItemCode || "",
  category: "DO_OPEN",
  remark: row.AreaSpvOpr || "",
  qty: Number(row.Qty || 0),
  fromLocation: "",
  toLocation: row.ToLocation || "",
  requestedBy: row.Pengajuan || "",
  requestedAt: row.CreatedAt || "",
  status: String(row.StatusApproval || "PENDING").toUpperCase(),
  approvedBy: row.AksiPicGudang || undefined,
  approvedAt: row.CreatedAt || undefined,
  rejectionReason: row.AksiPicGudang || undefined,
  keterangan: row.Keterangan || "",
});

const dbError = (res: Response, label: string, err: any) => {
  console.error(`Error ${label}:`, err?.message || err);
  res.status(500).json({ error: "Operasi database gagal. Cek tunnel SSH masih terbuka." });
};

function validate(r: any): string | null {
  if (!r || typeof r.documentNo !== "string" || !r.documentNo.trim()) return "documentNo wajib diisi.";
  if (typeof r.itemCode !== "string" || !r.itemCode.trim()) return "itemCode wajib diisi.";
  if (r.qty !== undefined && isNaN(Number(r.qty))) return "qty harus angka.";
  return null;
}

function insertRequest(tx: sql.Transaction, r: any, nik: string, displayName: string) {
  return new sql.Request(tx)
    .input("TanggalRequest", sql.NVarChar(50), r.postingDate || new Date().toISOString().slice(0, 10))
    .input("DocumentNo", sql.NVarChar(100), String(r.documentNo).trim())
    .input("ItemCode", sql.NVarChar(100), String(r.itemCode).trim().toUpperCase())
    .input("Qty", sql.Decimal(18, 2), Number(r.qty || 0))
    .input("AreaRmOpr", sql.NVarChar(150), r.entryName || "")
    .input("AreaSpvOpr", sql.NVarChar(150), r.remark || "")
    .input("ToLocation", sql.NVarChar(150), r.toLocation || null)
    .input("Pengajuan", sql.NVarChar(200), r.requestedBy || displayName || "OPR")
    .input("RequestedByNik", sql.NVarChar(50), nik)
    .input("Keterangan", sql.NVarChar(500), r.keterangan || "")
    .query(`
      INSERT INTO dbo.RequestDoOpen
        (TanggalRequest, DocumentNo, ItemCode, Qty, AreaRmOpr, AreaSpvOpr, ToLocation, Pengajuan, StatusApproval, AksiPicGudang, RequestedByNik, Keterangan)
      OUTPUT INSERTED.Id
      VALUES
        (@TanggalRequest, @DocumentNo, @ItemCode, @Qty, @AreaRmOpr, @AreaSpvOpr, @ToLocation, @Pengajuan, N'PENDING', N'', @RequestedByNik, @Keterangan)
    `);
}

export function registerRequestDoRoutes(app: Express) {
  // GET — semua role; OPR hanya lihat request miliknya
  app.get("/api/request-do-open", authRequired, async (req: AuthedRequest, res) => {
    try {
      const pool = await getPool();
      const request = pool.request();
      let where = "";
      if (req.user!.role === "OPR") {
        where = "WHERE RequestedByNik = @Nik";
        request.input("Nik", sql.NVarChar(50), req.user!.nik);
      }
      const result = await request.query(`SELECT * FROM dbo.RequestDoOpen ${where} ORDER BY CreatedAt`);
      res.json(result.recordset.map(mapRow));
    } catch (err) {
      dbError(res, "GET /api/request-do-open", err);
    }
  });

  // POST — OPR (ajukan dari DoOpenView/CatalogPhotoView) + Admin/Team Gudang/Audit
  // (tombol "+ Input Request DO" manual di RequestDoOpenView, halaman yang sama
  // dipakai untuk approval — role ini semua bisa lihat & pakai tombol itu, jadi
  // backend wajib izinkan juga, kalau tidak POST-nya 403 tapi UI kelihatan "berhasil").
  app.post("/api/request-do-open", authRequired, requireRole("OPR", "Admin", "Team Gudang", "Audit"), async (req: AuthedRequest, res) => {
    const invalid = validate(req.body);
    if (invalid) return res.status(400).json({ error: invalid });
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      await ensureMasterItems(tx, [req.body.itemCode]);
      const result = await insertRequest(tx, req.body, req.user!.nik, req.user!.displayName);
      await tx.commit();
      res.status(201).json({ success: true, id: String(result.recordset[0].Id).toLowerCase() });
    } catch (err) {
      try { await tx.rollback(); } catch { /* sudah batal */ }
      dbError(res, "POST /api/request-do-open", err);
    }
  });

  // POST /bulk — sama seperti POST tunggal di atas, all-or-nothing
  app.post("/api/request-do-open/bulk", authRequired, requireRole("OPR", "Admin", "Team Gudang", "Audit"), async (req: AuthedRequest, res) => {
    const records: any[] = req.body?.records;
    if (!Array.isArray(records) || !records.length) {
      return res.status(400).json({ error: "Body harus { records: [...] } dan tidak kosong." });
    }
    for (const [i, r] of records.entries()) {
      const invalid = validate(r);
      if (invalid) return res.status(400).json({ error: `Record ke-${i + 1}: ${invalid}` });
    }
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      await ensureMasterItems(tx, records.map((r) => r.itemCode));
      for (const r of records) {
        await insertRequest(tx, r, req.user!.nik, req.user!.displayName);
      }
      await tx.commit();
      res.status(201).json({ success: true, inserted: records.length });
    } catch (err) {
      try { await tx.rollback(); } catch { /* sudah batal */ }
      dbError(res, "POST /api/request-do-open/bulk", err);
    }
  });

  // PATCH /:id/status — Admin/Team Gudang (approve/reject/revert).
  // 'PENDING' dipakai untuk revert request yang salah approve/reject (mis.
  // pas testing pakai data live) — AksiPicGudang & ApprovedByNik dikosongkan
  // lagi supaya bersih seperti request baru.
  app.patch(
    "/api/request-do-open/:id/status",
    authRequired,
    requireRole("Admin", "Team Gudang"),
    async (req: AuthedRequest, res) => {
      const { status, picAction, documentNo } = req.body || {};
      if (status !== "APPROVED" && status !== "REJECTED" && status !== "PENDING") {
        return res.status(400).json({ error: "status harus 'APPROVED', 'REJECTED', atau 'PENDING'." });
      }
      try {
        const pool = await getPool();
        const id = req.params.id;
        const byUuid = UUID_RE.test(id);
        const isPending = status === "PENDING";
        const request = pool
          .request()
          .input("Status", sql.NVarChar(50), status)
          .input("Pic", sql.NVarChar(200), isPending ? "" : picAction || "")
          .input("ApprovedByNik", sql.NVarChar(50), isPending ? null : req.user!.nik);
        let where: string;
        if (byUuid) {
          where = "Id = @Id";
          request.input("Id", sql.UniqueIdentifier, id);
        } else {
          // Kompatibilitas lama: id bukan UUID → perlakukan sebagai DocumentNo
          where = "DocumentNo = @Doc";
          request.input("Doc", sql.NVarChar(100), documentNo || id);
        }
        const result = await request.query(
          `UPDATE dbo.RequestDoOpen SET StatusApproval = @Status, AksiPicGudang = @Pic, ApprovedByNik = @ApprovedByNik WHERE ${where}`
        );
        if (!result.rowsAffected[0]) return res.status(404).json({ error: "Request tidak ditemukan." });
        res.json({ success: true, updated: result.rowsAffected[0] });
      } catch (err) {
        dbError(res, "PATCH /api/request-do-open/:id/status", err);
      }
    }
  );

  // DELETE /:id — Admin/Team Gudang
  app.delete(
    "/api/request-do-open/:id",
    authRequired,
    requireRole("Admin", "Team Gudang"),
    async (req: AuthedRequest, res) => {
      try {
        const pool = await getPool();
        const id = req.params.id;
        const byUuid = UUID_RE.test(id);
        const request = pool.request();
        let where: string;
        if (byUuid) {
          where = "Id = @Id";
          request.input("Id", sql.UniqueIdentifier, id);
        } else {
          where = "DocumentNo = @Doc";
          request.input("Doc", sql.NVarChar(100), (req.query.documentNo as string) || id);
        }
        const result = await request.query(`DELETE FROM dbo.RequestDoOpen WHERE ${where}`);
        if (!result.rowsAffected[0]) return res.status(404).json({ error: "Request tidak ditemukan." });
        res.json({ success: true, deleted: result.rowsAffected[0] });
      } catch (err) {
        dbError(res, "DELETE /api/request-do-open/:id", err);
      }
    }
  );
}
