import { sql } from "./db";

/* Dipakai semua route yang menulis ItemCode ke tabel anak (TransaksiMasuk/
   Keluar, DoOpen, KatalogFoto, RequestDoOpen). Menjamin baris MasterItem
   induknya ada sebelum insert — wajib dipanggil di SETIAP jalur tulis
   (single & bulk) setelah FK MasterItem.Kode ditambahkan, supaya insert
   untuk item baru tidak ditolak FK. */
export const cleanCode = (v: any) => String(v ?? "-").trim().toUpperCase() || "-";

export async function ensureMasterItems(tx: sql.Transaction, codes: (string | undefined | null)[]) {
  const unique = new Set(codes.map(cleanCode));
  for (const code of unique) {
    await new sql.Request(tx)
      .input("Kode", sql.NVarChar(100), code)
      .input("Nama", sql.NVarChar(300), code === "-" ? "GENERAL ITEM" : code)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.MasterItem WHERE Kode = @Kode)
          INSERT INTO dbo.MasterItem (Kode, NamaBarang, GroupName)
          VALUES (@Kode, @Nama, N'Umum')
      `);
  }
}
