import type { Express, Response } from "express";
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "fs";
import path from "path";
import { getPool, sql } from "./db";
import { authRequired, requireRole, type AuthedRequest } from "./auth";
import { ensureMasterItems } from "./dbHelpers";

/* Routes Katalog Foto — pengganti fetchCatalogPhotosSupabase/uploadFotoBarang/
   uploadBase64ToStorage/upsertCatalogPhotoSupabase/bulkUpsertCatalogPhotosSupabase/
   deleteCatalogPhotoSupabase.

   Perbedaan penting vs versi lama (lihat CLAUDE.md): foto TIDAK disimpan sebagai
   base64/blob di database. Base64 dari client di-decode → file di UPLOAD_DIR →
   DB hanya menyimpan path (/uploads/foto-barang/...). Di dev path ini di-serve
   express.static (server.ts), di production oleh Nginx. photoUrl yang sudah
   berupa URL http(s) (mis. Google Drive lama) disimpan apa adanya. */

const WRITE_ROLES = ["Admin", "Audit", "Team Gudang"];

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads/foto-barang");
const PUBLIC_PREFIX = "/uploads/foto-barang";

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

// Cek magic bytes asli file, JANGAN percaya begitu saja MIME type yang diklaim
// client di data-URL — klien bisa berbohong (mis. kirim .html/.svg berisi script
// tapi mengaku "image/png"). Cukup cek signature manual, tidak perlu dependency
// baru untuk 4 format yang didukung.
function sniffImageExt(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return "png";
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) && buffer[5] === 0x61
  ) return "gif";
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return "webp";
  return null;
}

// base64 data-URL → file di UPLOAD_DIR, return path publik.
// Bukan data-URL (http/https/path) → return apa adanya.
function savePhotoIfBase64(photoUrl: string, itemCode: string): string {
  const raw = String(photoUrl || "").trim();
  if (!raw.startsWith("data:")) return raw;

  const match = raw.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw Object.assign(new Error("Format data URL tidak valid."), { status: 400 });
  const claimedExt = ALLOWED_MIME[match[1].toLowerCase()];
  if (!claimedExt) throw Object.assign(new Error(`Tipe file ${match[1]} tidak diizinkan (hanya jpeg/png/webp/gif).`), { status: 400 });

  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) throw Object.assign(new Error("Data foto kosong."), { status: 400 });
  if (buffer.length > MAX_PHOTO_BYTES) throw Object.assign(new Error("Foto lebih dari 10MB."), { status: 400 });

  const sniffed = sniffImageExt(buffer);
  if (!sniffed || sniffed !== claimedExt) {
    throw Object.assign(
      new Error("Isi file tidak cocok dengan tipe yang diklaim (bukan gambar valid atau format tidak didukung)."),
      { status: 400 }
    );
  }
  const ext = sniffed;

  const cleanCode = String(itemCode || "item").replace(/[^a-zA-Z0-9]/g, "_");
  const fileName = `${cleanCode}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
  mkdirSync(UPLOAD_DIR, { recursive: true });
  writeFileSync(path.join(UPLOAD_DIR, fileName), buffer);
  return `${PUBLIC_PREFIX}/${fileName}`;
}

const mapRow = (row: any) => ({
  id: row.Id,
  itemCode: row.ItemCode || "",
  itemName: row.ItemName || "",
  groupName: row.GroupName || "",
  photoUrl: row.PhotoPath || "",
  notes: row.Notes || "",
  createdAt: row.CreatedAt,
  updatedAt: row.UpdatedAt ?? undefined,
});

const dbError = (res: Response, label: string, err: any) => {
  console.error(`Error ${label}:`, err?.message || err);
  res.status(500).json({ error: "Operasi database gagal. Cek tunnel SSH masih terbuka." });
};

const genId = (itemCode: string) =>
  `photo_${String(itemCode || "item").replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

async function upsertPhoto(reqOrTx: sql.Request, p: any): Promise<string> {
  const id = p.id || genId(p.itemCode);
  const photoPath = savePhotoIfBase64(p.photoUrl, p.itemCode);
  await reqOrTx
    .input("Id", sql.NVarChar(100), id)
    .input("ItemCode", sql.NVarChar(100), String(p.itemCode).trim().toUpperCase())
    .input("ItemName", sql.NVarChar(300), p.itemName || "")
    .input("GroupName", sql.NVarChar(150), p.groupName || "")
    .input("PhotoPath", sql.NVarChar(500), photoPath)
    .input("Notes", sql.NVarChar(500), p.notes || "")
    .query(`
      MERGE dbo.KatalogFoto AS t
      USING (SELECT @Id AS Id) AS s ON t.Id = s.Id
      WHEN MATCHED THEN UPDATE SET
        ItemCode = @ItemCode, ItemName = @ItemName, GroupName = @GroupName,
        PhotoPath = @PhotoPath, Notes = @Notes, UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (Id, ItemCode, ItemName, GroupName, PhotoPath, Notes)
        VALUES (@Id, @ItemCode, @ItemName, @GroupName, @PhotoPath, @Notes);
    `);
  return id;
}

function validate(p: any): string | null {
  if (!p || typeof p.itemCode !== "string" || !p.itemCode.trim()) return "itemCode wajib diisi.";
  if (typeof p.photoUrl !== "string" || !p.photoUrl.trim()) return "photoUrl wajib diisi (data URL base64 atau URL http).";
  return null;
}

export function registerCatalogPhotoRoutes(app: Express) {
  // GET — semua role
  app.get("/api/catalog-photos", authRequired, async (_req: AuthedRequest, res) => {
    try {
      const pool = await getPool();
      const result = await pool.request().query("SELECT * FROM dbo.KatalogFoto ORDER BY CreatedAt");
      res.json(result.recordset.map(mapRow));
    } catch (err) {
      dbError(res, "GET /api/catalog-photos", err);
    }
  });

  // POST /upload — Admin/Audit/Team Gudang. Pengganti uploadFotoBarang +
  // uploadBase64ToStorage: base64 → file disk, row baru/update di KatalogFoto.
  app.post("/api/catalog-photos/upload", authRequired, requireRole(...WRITE_ROLES), async (req: AuthedRequest, res) => {
    const invalid = validate(req.body);
    if (invalid) return res.status(400).json({ error: invalid });
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      await ensureMasterItems(tx, [req.body.itemCode]);
      const id = await upsertPhoto(new sql.Request(tx), req.body);
      const row = await new sql.Request(tx).input("Id", sql.NVarChar(100), id).query("SELECT * FROM dbo.KatalogFoto WHERE Id = @Id");
      await tx.commit();
      res.status(201).json(mapRow(row.recordset[0]));
    } catch (err: any) {
      try { await tx.rollback(); } catch { /* sudah batal */ }
      if (err?.status === 400) return res.status(400).json({ error: err.message });
      dbError(res, "POST /api/catalog-photos/upload", err);
    }
  });

  // PUT /:id — Admin/Audit/Team Gudang. Upsert by id (perilaku upsertCatalogPhotoSupabase).
  app.put("/api/catalog-photos/:id", authRequired, requireRole(...WRITE_ROLES), async (req: AuthedRequest, res) => {
    const invalid = validate(req.body);
    if (invalid) return res.status(400).json({ error: invalid });
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      await ensureMasterItems(tx, [req.body.itemCode]);
      const id = await upsertPhoto(new sql.Request(tx), { ...req.body, id: req.params.id });
      await tx.commit();
      res.json({ success: true, id });
    } catch (err: any) {
      try { await tx.rollback(); } catch { /* sudah batal */ }
      if (err?.status === 400) return res.status(400).json({ error: err.message });
      dbError(res, "PUT /api/catalog-photos/:id", err);
    }
  });

  // POST /bulk — Admin/Audit/Team Gudang, satu transaction
  app.post("/api/catalog-photos/bulk", authRequired, requireRole(...WRITE_ROLES), async (req: AuthedRequest, res) => {
    const photos: any[] = req.body?.records;
    if (!Array.isArray(photos) || !photos.length) {
      return res.status(400).json({ error: "Body harus { records: [...] } dan tidak kosong." });
    }
    for (const [i, p] of photos.entries()) {
      const invalid = validate(p);
      if (invalid) return res.status(400).json({ error: `Record ke-${i + 1}: ${invalid}` });
    }
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      await ensureMasterItems(tx, photos.map((p) => p.itemCode));
      const ids: string[] = [];
      for (const p of photos) {
        ids.push(await upsertPhoto(new sql.Request(tx), p));
      }
      await tx.commit();
      res.status(201).json({ success: true, upserted: ids.length, ids });
    } catch (err: any) {
      try { await tx.rollback(); } catch { /* sudah batal */ }
      if (err?.status === 400) return res.status(400).json({ error: err.message });
      dbError(res, "POST /api/catalog-photos/bulk", err);
    }
  });

  // DELETE /:id — Admin only. Hapus row + file fisiknya (kalau file lokal).
  app.delete("/api/catalog-photos/:id", authRequired, requireRole("Admin", "Audit"), async (req: AuthedRequest, res) => {
    try {
      const pool = await getPool();
      const row = await pool
        .request()
        .input("Id", sql.NVarChar(100), req.params.id)
        .query("SELECT PhotoPath FROM dbo.KatalogFoto WHERE Id = @Id");
      if (!row.recordset.length) return res.status(404).json({ error: "Foto tidak ditemukan." });

      await pool.request().input("Id", sql.NVarChar(100), req.params.id).query("DELETE FROM dbo.KatalogFoto WHERE Id = @Id");

      const photoPath = String(row.recordset[0].PhotoPath || "");
      if (photoPath.startsWith(`${PUBLIC_PREFIX}/`)) {
        // path.basename mencegah path traversal dari nilai DB
        const filePath = path.join(UPLOAD_DIR, path.basename(photoPath));
        if (existsSync(filePath)) {
          try { unlinkSync(filePath); } catch (e: any) { console.warn("Gagal hapus file foto:", e?.message); }
        }
      }
      res.json({ success: true });
    } catch (err) {
      dbError(res, "DELETE /api/catalog-photos/:id", err);
    }
  });
}
