/* =====================================================================
   Migrasi data produksi dari Supabase (masih aktif) ke SQL Server —
   Fase 7. Sumber: REST API Supabase (anon key, tabel-tabel yang
   RLS-nya terbuka sesuai temuan CLAUDE.md — 'users' sengaja di-skip
   karena diproteksi dengan benar & passwordnya plaintext, tidak boleh
   dipindah apa adanya).

   Tabel yang dimigrasi: master_item, do_open, transaksi_masuk, transaksi_keluar.
   Tabel lain (request_do_open, container_status, katalog_foto, CIF/BAP)
   dicek kosong (0 baris) saat survei — tidak perlu dimigrasi.

   Pakai: npx tsx scripts/migrate-supabase-data.ts [--clear-dummy] [--dry-run]
   ===================================================================== */
import { getPool, sql } from "../src/db";

const SUPABASE_URL = "https://cevaowpizcqikbxquweh.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNldmFvd3BpemNxaWtieHF1d2VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4NTM5NTAsImV4cCI6MjEwMDQyOTk1MH0.72OIdK2KcE2Ya0plTdVAcggB0SoS2qFBTWgKJ7wzBy8";

const PAGE_SIZE = 1000;
const args = process.argv.slice(2);
const CLEAR_DUMMY = args.includes("--clear-dummy");
const DRY_RUN = args.includes("--dry-run");

async function fetchAllRows(table: string): Promise<any[]> {
  const rows: any[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Range: `${from}-${to}`,
      },
    });
    if (!res.ok) throw new Error(`Fetch ${table} gagal (${res.status}): ${await res.text()}`);
    const batch = (await res.json()) as any[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
    process.stdout.write(`\r  ${table}: ${rows.length} baris diambil...`);
  }
  console.log(`\r  ${table}: ${rows.length} baris diambil — selesai fetch.`);
  return rows;
}

function toDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// mssql Table.bulk() (protokol TDS bcp) error "Invalid column type from bcp
// client" untuk semua tipe tanggal saat dites ke SQL Server 2025 — dugaan
// bug kompatibilitas driver/versi server. INSERT parameterized biasa
// terverifikasi jalan normal, jadi dipakai chunked batch INSERT sebagai gantinya.
async function chunkedInsert(
  tableName: string,
  columns: { name: string; type: any }[],
  rows: any[][],
  chunkSize: number
) {
  const pool = await getPool();
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const request = pool.request();
    const valueRows: string[] = [];
    chunk.forEach((row, rIdx) => {
      const placeholders = columns.map((col, cIdx) => {
        const paramName = `p${rIdx}_${cIdx}`;
        request.input(paramName, col.type, row[cIdx]);
        return `@${paramName}`;
      });
      valueRows.push(`(${placeholders.join(", ")})`);
    });
    const colNames = columns.map((c) => c.name).join(", ");
    await request.query(`INSERT INTO ${tableName} (${colNames}) VALUES ${valueRows.join(", ")}`);
    process.stdout.write(`\r  Insert progress: ${Math.min(i + chunkSize, rows.length)}/${rows.length}`);
  }
  console.log("");
}

async function migrateMasterItem() {
  console.log("\n=== MasterItem ===");
  const rows = await fetchAllRows("master_item");

  // Dedupe by kode (PRIMARY KEY) — kalau ada duplikat, ambil yang paling baru (created_at terbesar)
  const byKode = new Map<string, any>();
  for (const r of rows) {
    const kode = String(r.kode || "").trim();
    if (!kode) continue;
    const existing = byKode.get(kode);
    if (!existing || new Date(r.created_at || 0) > new Date(existing.created_at || 0)) {
      byKode.set(kode, r);
    }
  }
  const deduped = Array.from(byKode.values());
  console.log(`  Setelah dedupe by Kode: ${deduped.length} baris (dari ${rows.length} raw)`);

  if (DRY_RUN) {
    console.log("  [DRY RUN] Tidak menulis ke database.");
    return;
  }

  const batchRows = deduped.map((r) => [
    String(r.kode).trim(),
    String(r.nama_barang || r.kode).trim().slice(0, 300),
    String(r.group_name || "Umum").trim().slice(0, 150),
    r.harga_jual !== null && r.harga_jual !== undefined ? Number(r.harga_jual) : null,
    r.harga_beli !== null && r.harga_beli !== undefined ? Number(r.harga_beli) : null,
    toDate(r.created_at) || new Date(),
  ]);

  await chunkedInsert(
    "dbo.MasterItem",
    [
      { name: "Kode", type: sql.NVarChar(100) },
      { name: "NamaBarang", type: sql.NVarChar(300) },
      { name: "GroupName", type: sql.NVarChar(150) },
      { name: "HargaJual", type: sql.Decimal(18, 2) },
      { name: "HargaBeli", type: sql.Decimal(18, 2) },
      { name: "CreatedAt", type: sql.DateTime2 },
    ],
    batchRows,
    300
  );
  console.log(`  Insert selesai: ${batchRows.length} baris ke dbo.MasterItem.`);
}

async function migrateTransaksi(supabaseTable: string, sqlTable: string) {
  console.log(`\n=== ${sqlTable} (dari ${supabaseTable}) ===`);
  const rows = await fetchAllRows(supabaseTable);

  if (DRY_RUN) {
    console.log("  [DRY RUN] Tidak menulis ke database.");
    return;
  }

  const batchRows = rows.map((r) => [
    String(r.item_code || "-").trim().toUpperCase().slice(0, 100),
    r.qty !== null && r.qty !== undefined ? Number(r.qty) : 0,
    toDate(r.posting_date),
    r.document_no ? String(r.document_no).slice(0, 100) : null,
    r.category ? String(r.category).slice(0, 150) : null,
    r.entry_remark ? String(r.entry_remark).slice(0, 500) : null,
    r.from_location ? String(r.from_location).slice(0, 150) : null,
    r.to_location ? String(r.to_location).slice(0, 150) : null,
    toDate(r.created_at) || new Date(),
  ]);

  await chunkedInsert(
    `dbo.${sqlTable}`,
    [
      { name: "ItemCode", type: sql.NVarChar(100) },
      { name: "Qty", type: sql.Decimal(18, 2) },
      { name: "TanggalTransaksi", type: sql.Date },
      { name: "DocumentNo", type: sql.NVarChar(100) },
      { name: "Category", type: sql.NVarChar(150) },
      { name: "EntryRemark", type: sql.NVarChar(500) },
      { name: "FromLocation", type: sql.NVarChar(150) },
      { name: "ToLocation", type: sql.NVarChar(150) },
      { name: "CreatedAt", type: sql.DateTime2 },
    ],
    batchRows,
    200
  );
  console.log(`  Insert selesai: ${batchRows.length} baris ke dbo.${sqlTable}.`);
}

async function migrateDoOpen() {
  console.log("\n=== DoOpen (dari do_open) ===");
  const rows = await fetchAllRows("do_open");

  if (DRY_RUN) {
    console.log("  [DRY RUN] Tidak menulis ke database.");
    return;
  }

  const batchRows = rows.map((r) => [
    r.posting_date ? String(r.posting_date) : null,
    r.area_rm_opr ? String(r.area_rm_opr).slice(0, 150) : null,
    String(r.document_no || "-").trim().slice(0, 100),
    String(r.item_code || "-").trim().toUpperCase().slice(0, 100),
    r.status_do_open ? String(r.status_do_open).slice(0, 100) : null,
    r.area_spv_opr ? String(r.area_spv_opr).slice(0, 150) : null,
    r.qty !== null && r.qty !== undefined ? Number(r.qty) : 0,
    r.nilai_jual !== null && r.nilai_jual !== undefined ? Number(r.nilai_jual) : null,
    r.from_location ? String(r.from_location).slice(0, 150) : null,
    r.to_location ? String(r.to_location).slice(0, 150) : null,
    "DO_OPEN",
    r.total_qty !== null && r.total_qty !== undefined ? Number(r.total_qty) : null,
    r.total_cost !== null && r.total_cost !== undefined ? Number(r.total_cost) : null,
    r.total_price !== null && r.total_price !== undefined ? Number(r.total_price) : null,
    r.no_dosl ? String(r.no_dosl).slice(0, 100) : null,
    r.keterangan ? String(r.keterangan).slice(0, 500) : null,
    toDate(r.created_at) || new Date(),
  ]);

  await chunkedInsert(
    "dbo.DoOpen",
    [
      { name: "PostingDate", type: sql.NVarChar(50) },
      { name: "AreaRmOpr", type: sql.NVarChar(150) },
      { name: "DocumentNo", type: sql.NVarChar(100) },
      { name: "ItemCode", type: sql.NVarChar(100) },
      { name: "StatusDoOpen", type: sql.NVarChar(100) },
      { name: "AreaSpvOpr", type: sql.NVarChar(150) },
      { name: "Qty", type: sql.Decimal(18, 2) },
      { name: "NilaiJual", type: sql.Decimal(18, 2) },
      { name: "FromLocation", type: sql.NVarChar(150) },
      { name: "ToLocation", type: sql.NVarChar(150) },
      { name: "Aksi", type: sql.NVarChar(100) },
      { name: "TotalQty", type: sql.Decimal(18, 2) },
      { name: "TotalCost", type: sql.Decimal(18, 2) },
      { name: "TotalPrice", type: sql.Decimal(18, 2) },
      { name: "NoDosl", type: sql.NVarChar(100) },
      { name: "Keterangan", type: sql.NVarChar(500) },
      { name: "CreatedAt", type: sql.DateTime2 },
    ],
    batchRows,
    100
  );
  console.log(`  Insert selesai: ${batchRows.length} baris ke dbo.DoOpen.`);
}

async function clearDummyData() {
  console.log("\n=== Membersihkan data dummy Fase 2 ===");
  const pool = await getPool();
  const tables = ["dbo.DoOpen", "dbo.TransaksiKeluar", "dbo.TransaksiMasuk", "dbo.MasterItem"];
  for (const t of tables) {
    const result = await pool.request().query(`DELETE FROM ${t}`);
    console.log(`  ${t}: ${result.rowsAffected[0]} baris dihapus.`);
  }
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (tidak menulis apa pun)" : "LIVE (menulis ke database)"}`);
  if (CLEAR_DUMMY && !DRY_RUN) {
    await clearDummyData();
  }
  await migrateMasterItem();
  await migrateTransaksi("transaksi_masuk", "TransaksiMasuk");
  await migrateTransaksi("transaksi_keluar", "TransaksiKeluar");
  await migrateDoOpen();
  console.log("\nSelesai.");
  const pool = await getPool();
  await pool.close();
}

main().catch((err) => {
  console.error("GAGAL:", err?.message || err);
  process.exit(1);
});
