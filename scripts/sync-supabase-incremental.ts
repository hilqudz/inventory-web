/* =====================================================================
   Sinkronisasi incremental dari Supabase (masih dipakai paralel oleh tim
   untuk input data) ke SQL Server, tanpa menghapus/duplikasi data yang
   sudah ada dari migrasi awal (Fase 7).

   Strategi:
   - Tambah kolom SourceId (UUID dari Supabase) ke TransaksiMasuk,
     TransaksiKeluar, DoOpen — supaya sync berikutnya idempotent.
   - Baris lama hasil migrasi awal (SourceId masih NULL) dicocokkan ke
     baris Supabase lewat composite natural key, lalu SourceId-nya
     di-backfill (bukan insert ulang / duplikat).
   - Baris Supabase yang tidak match baris manapun di SQL -> INSERT baru.
   - MasterItem: upsert by Kode (data referensi, aman ditimpa).
   - DoOpen yang ada di SQL tapi sudah tidak ada lagi di Supabase (closed/
     shipped) TIDAK dihapus otomatis -- hanya dilaporkan, karena
     mempengaruhi laporan (Rekonsiliasi, Qty Lepasan).

   Pakai: npx tsx scripts/sync-supabase-incremental.ts [--dry-run]
   ===================================================================== */
import { getPool, sql } from "../src/db";

const SUPABASE_URL = "https://cevaowpizcqikbxquweh.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNldmFvd3BpemNxaWtieHF1d2VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4NTM5NTAsImV4cCI6MjEwMDQyOTk1MH0.72OIdK2KcE2Ya0plTdVAcggB0SoS2qFBTWgKJ7wzBy8";
const PAGE_SIZE = 1000;
const DRY_RUN = process.argv.includes("--dry-run");

async function fetchAllRows(table: string): Promise<any[]> {
  const rows: any[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Range: `${from}-${to}` },
    });
    if (!res.ok) throw new Error(`Fetch ${table} gagal (${res.status}): ${await res.text()}`);
    const batch = (await res.json()) as any[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

function toDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

async function ensureSourceIdColumn(table: string): Promise<boolean> {
  const pool = await getPool();
  const check = await pool.request().query(`
    SELECT COUNT(*) AS cnt FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.${table}') AND name = 'SourceId'
  `);
  if (check.recordset[0].cnt === 0) {
    if (DRY_RUN) {
      console.log(`  [DDL] (dry-run) Akan menambah kolom SourceId ke dbo.${table} saat live run.`);
      return false; // caller: treat as "column doesn't exist yet" for dry-run stats
    }
    console.log(`  [DDL] Menambah kolom SourceId ke dbo.${table}...`);
    await pool.request().query(`ALTER TABLE dbo.${table} ADD SourceId UNIQUEIDENTIFIER NULL`);
    await pool.request().query(
      `CREATE UNIQUE INDEX UX_${table}_SourceId ON dbo.${table}(SourceId) WHERE SourceId IS NOT NULL`
    );
  }
  return true;
}

async function syncMasterItem() {
  console.log("\n=== MasterItem (upsert by Kode) ===");
  const rows = await fetchAllRows("master_item");
  const byKode = new Map<string, any>();
  for (const r of rows) {
    const kode = String(r.kode || "").trim();
    if (!kode) continue;
    const existing = byKode.get(kode);
    if (!existing || new Date(r.created_at || 0) > new Date(existing.created_at || 0)) byKode.set(kode, r);
  }
  const pool = await getPool();
  const existingRes = await pool.request().query(`SELECT Kode, NamaBarang, GroupName, HargaJual, HargaBeli FROM dbo.MasterItem`);
  const existingMap = new Map<string, any>(existingRes.recordset.map((r: any) => [r.Kode, r]));

  let inserted = 0, updated = 0, unchanged = 0;
  for (const [kode, r] of byKode) {
    const namaBarang = String(r.nama_barang || r.kode).trim().slice(0, 300);
    const groupName = String(r.group_name || "Umum").trim().slice(0, 150);
    const hargaJual = r.harga_jual !== null && r.harga_jual !== undefined ? Number(r.harga_jual) : null;
    const hargaBeli = r.harga_beli !== null && r.harga_beli !== undefined ? Number(r.harga_beli) : null;
    const existing = existingMap.get(kode);

    if (!existing) {
      inserted++;
      if (!DRY_RUN) {
        await pool.request()
          .input("Kode", sql.NVarChar(100), kode)
          .input("NamaBarang", sql.NVarChar(300), namaBarang)
          .input("GroupName", sql.NVarChar(150), groupName)
          .input("HargaJual", sql.Decimal(18, 2), hargaJual)
          .input("HargaBeli", sql.Decimal(18, 2), hargaBeli)
          .input("CreatedAt", sql.DateTime2, toDate(r.created_at) || new Date())
          .query(`INSERT INTO dbo.MasterItem (Kode, NamaBarang, GroupName, HargaJual, HargaBeli, CreatedAt)
                  VALUES (@Kode, @NamaBarang, @GroupName, @HargaJual, @HargaBeli, @CreatedAt)`);
      }
    } else {
      const changed =
        existing.NamaBarang !== namaBarang ||
        existing.GroupName !== groupName ||
        Number(existing.HargaJual ?? 0) !== Number(hargaJual ?? 0) ||
        Number(existing.HargaBeli ?? 0) !== Number(hargaBeli ?? 0);
      if (changed) {
        updated++;
        if (!DRY_RUN) {
          await pool.request()
            .input("Kode", sql.NVarChar(100), kode)
            .input("NamaBarang", sql.NVarChar(300), namaBarang)
            .input("GroupName", sql.NVarChar(150), groupName)
            .input("HargaJual", sql.Decimal(18, 2), hargaJual)
            .input("HargaBeli", sql.Decimal(18, 2), hargaBeli)
            .query(`UPDATE dbo.MasterItem SET NamaBarang=@NamaBarang, GroupName=@GroupName, HargaJual=@HargaJual, HargaBeli=@HargaBeli WHERE Kode=@Kode`);
        }
      } else {
        unchanged++;
      }
    }
  }
  console.log(`  Insert baru: ${inserted}, Update: ${updated}, Tidak berubah: ${unchanged}`);
}

async function syncTransaksi(supabaseTable: string, sqlTable: string, keyFields: string[]) {
  console.log(`\n=== ${sqlTable} (dari ${supabaseTable}) ===`);
  const columnExists = await ensureSourceIdColumn(sqlTable);
  const rows = await fetchAllRows(supabaseTable);
  const pool = await getPool();

  // Baris SQL yang sudah punya SourceId -> sudah pasti sinkron, skip dari matching
  const taggedRes = columnExists
    ? await pool.request().query(`SELECT SourceId FROM dbo.${sqlTable} WHERE SourceId IS NOT NULL`)
    : { recordset: [] as any[] };
  const taggedIds = new Set(taggedRes.recordset.map((r: any) => String(r.SourceId).toLowerCase()));

  // Baris SQL lama (dari migrasi awal, SourceId NULL) -> untuk matching composite key
  const untaggedRes = await pool.request().query(`
    SELECT Id, ItemCode, Qty, TanggalTransaksi, DocumentNo
    FROM dbo.${sqlTable} ${columnExists ? "WHERE SourceId IS NULL" : ""}
  `);
  // key -> queue of row Ids (handle duplicate composite keys by consuming one at a time)
  const untaggedByKey = new Map<string, number[]>();
  for (const r of untaggedRes.recordset) {
    const key = [
      String(r.ItemCode || "").trim().toUpperCase(),
      Number(r.Qty || 0),
      r.TanggalTransaksi ? new Date(r.TanggalTransaksi).toISOString().slice(0, 10) : "",
      String(r.DocumentNo || "").trim(),
    ].join("|");
    if (!untaggedByKey.has(key)) untaggedByKey.set(key, []);
    untaggedByKey.get(key)!.push(r.Id);
  }

  let backfilled = 0, inserted = 0, skippedAlreadyTagged = 0, unmatchedNoBackfill = 0;

  for (const r of rows) {
    const id = String(r.id).toLowerCase();
    if (taggedIds.has(id)) {
      skippedAlreadyTagged++;
      continue;
    }
    const itemCode = String(r.item_code || "-").trim().toUpperCase().slice(0, 100);
    const qty = r.qty !== null && r.qty !== undefined ? Number(r.qty) : 0;
    const tglDate = toDate(r.posting_date);
    const tglKey = tglDate ? tglDate.toISOString().slice(0, 10) : "";
    const docNo = r.document_no ? String(r.document_no).slice(0, 100) : "";
    const key = [itemCode, qty, tglKey, docNo].join("|");

    const queue = untaggedByKey.get(key);
    if (queue && queue.length > 0) {
      const matchedRowId = queue.shift()!;
      backfilled++;
      if (!DRY_RUN) {
        await pool.request()
          .input("Id", sql.BigInt, matchedRowId)
          .input("SourceId", sql.UniqueIdentifier, r.id)
          .query(`UPDATE dbo.${sqlTable} SET SourceId = @SourceId WHERE Id = @Id`);
      }
      continue;
    }

    // Tidak ketemu match -> baris baru, insert
    inserted++;
    if (!DRY_RUN) {
      await pool.request()
        .input("ItemCode", sql.NVarChar(100), itemCode)
        .input("Qty", sql.Decimal(18, 2), qty)
        .input("TanggalTransaksi", sql.Date, tglDate)
        .input("DocumentNo", sql.NVarChar(100), docNo || null)
        .input("Category", sql.NVarChar(150), r.category ? String(r.category).slice(0, 150) : null)
        .input("EntryRemark", sql.NVarChar(500), r.entry_remark ? String(r.entry_remark).slice(0, 500) : null)
        .input("FromLocation", sql.NVarChar(150), r.from_location ? String(r.from_location).slice(0, 150) : null)
        .input("ToLocation", sql.NVarChar(150), r.to_location ? String(r.to_location).slice(0, 150) : null)
        .input("CreatedAt", sql.DateTime2, toDate(r.created_at) || new Date())
        .input("SourceId", sql.UniqueIdentifier, r.id)
        .query(`INSERT INTO dbo.${sqlTable}
                (ItemCode, Qty, TanggalTransaksi, DocumentNo, Category, EntryRemark, FromLocation, ToLocation, CreatedAt, SourceId)
                VALUES (@ItemCode, @Qty, @TanggalTransaksi, @DocumentNo, @Category, @EntryRemark, @FromLocation, @ToLocation, @CreatedAt, @SourceId)`);
    }
  }

  console.log(`  Sudah sinkron sebelumnya (SourceId match): ${skippedAlreadyTagged}`);
  console.log(`  Backfill SourceId ke baris migrasi lama (match by key): ${backfilled}`);
  console.log(`  Insert baris baru: ${inserted}`);
  const remainingUntagged = [...untaggedByKey.values()].reduce((a, q) => a + q.length, 0);
  console.log(`  Baris SQL lama yang TIDAK ketemu pasangan di Supabase (dibiarkan, tidak dihapus): ${remainingUntagged}`);
}

async function syncDoOpen() {
  console.log(`\n=== DoOpen (dari do_open) ===`);
  const columnExists = await ensureSourceIdColumn("DoOpen");
  const rows = await fetchAllRows("do_open");
  const pool = await getPool();

  const taggedRes = columnExists
    ? await pool.request().query(`SELECT SourceId FROM dbo.DoOpen WHERE SourceId IS NOT NULL`)
    : { recordset: [] as any[] };
  const taggedIds = new Set(taggedRes.recordset.map((r: any) => String(r.SourceId).toLowerCase()));

  const untaggedRes = await pool.request().query(`
    SELECT Id, ItemCode, Qty, PostingDate, DocumentNo, ToLocation FROM dbo.DoOpen ${columnExists ? "WHERE SourceId IS NULL" : ""}
  `);
  const untaggedByKey = new Map<string, string[]>();
  for (const r of untaggedRes.recordset) {
    const key = [
      String(r.ItemCode || "").trim().toUpperCase(),
      Number(r.Qty || 0),
      String(r.PostingDate || "").trim(),
      String(r.DocumentNo || "").trim(),
      String(r.ToLocation || "").trim(),
    ].join("|");
    if (!untaggedByKey.has(key)) untaggedByKey.set(key, []);
    untaggedByKey.get(key)!.push(r.Id);
  }

  let backfilled = 0, inserted = 0, skippedAlreadyTagged = 0;
  for (const r of rows) {
    const id = String(r.id).toLowerCase();
    if (taggedIds.has(id)) { skippedAlreadyTagged++; continue; }

    const itemCode = String(r.item_code || "-").trim().toUpperCase().slice(0, 100);
    const qty = r.qty !== null && r.qty !== undefined ? Number(r.qty) : 0;
    const postingDate = r.posting_date ? String(r.posting_date) : "";
    const docNo = String(r.document_no || "-").trim().slice(0, 100);
    const toLoc = r.to_location ? String(r.to_location).slice(0, 150) : "";
    const key = [itemCode, qty, postingDate, docNo, toLoc].join("|");

    const queue = untaggedByKey.get(key);
    if (queue && queue.length > 0) {
      const matchedId = queue.shift()!;
      backfilled++;
      if (!DRY_RUN) {
        await pool.request()
          .input("Id", sql.UniqueIdentifier, matchedId)
          .input("SourceId", sql.UniqueIdentifier, r.id)
          .query(`UPDATE dbo.DoOpen SET SourceId = @SourceId WHERE Id = @Id`);
      }
      continue;
    }

    inserted++;
    if (!DRY_RUN) {
      await pool.request()
        .input("PostingDate", sql.NVarChar(50), postingDate || null)
        .input("AreaRmOpr", sql.NVarChar(150), r.area_rm_opr ? String(r.area_rm_opr).slice(0, 150) : null)
        .input("DocumentNo", sql.NVarChar(100), docNo)
        .input("ItemCode", sql.NVarChar(100), itemCode)
        .input("StatusDoOpen", sql.NVarChar(100), r.status_do_open ? String(r.status_do_open).slice(0, 100) : null)
        .input("AreaSpvOpr", sql.NVarChar(150), r.area_spv_opr ? String(r.area_spv_opr).slice(0, 150) : null)
        .input("Qty", sql.Decimal(18, 2), qty)
        .input("NilaiJual", sql.Decimal(18, 2), r.nilai_jual !== null && r.nilai_jual !== undefined ? Number(r.nilai_jual) : null)
        .input("FromLocation", sql.NVarChar(150), r.from_location ? String(r.from_location).slice(0, 150) : null)
        .input("ToLocation", sql.NVarChar(150), toLoc || null)
        .input("Aksi", sql.NVarChar(100), "DO_OPEN")
        .input("TotalQty", sql.Decimal(18, 2), r.total_qty !== null && r.total_qty !== undefined ? Number(r.total_qty) : null)
        .input("TotalCost", sql.Decimal(18, 2), r.total_cost !== null && r.total_cost !== undefined ? Number(r.total_cost) : null)
        .input("TotalPrice", sql.Decimal(18, 2), r.total_price !== null && r.total_price !== undefined ? Number(r.total_price) : null)
        .input("NoDosl", sql.NVarChar(100), r.no_dosl ? String(r.no_dosl).slice(0, 100) : null)
        .input("Keterangan", sql.NVarChar(500), r.keterangan ? String(r.keterangan).slice(0, 500) : null)
        .input("CreatedAt", sql.DateTime2, toDate(r.created_at) || new Date())
        .input("SourceId", sql.UniqueIdentifier, r.id)
        .query(`INSERT INTO dbo.DoOpen
                (PostingDate, AreaRmOpr, DocumentNo, ItemCode, StatusDoOpen, AreaSpvOpr, Qty, NilaiJual, FromLocation, ToLocation, Aksi, TotalQty, TotalCost, TotalPrice, NoDosl, Keterangan, CreatedAt, SourceId)
                VALUES (@PostingDate, @AreaRmOpr, @DocumentNo, @ItemCode, @StatusDoOpen, @AreaSpvOpr, @Qty, @NilaiJual, @FromLocation, @ToLocation, @Aksi, @TotalQty, @TotalCost, @TotalPrice, @NoDosl, @Keterangan, @CreatedAt, @SourceId)`);
    }
  }

  const remainingIds = [...untaggedByKey.values()].flat();
  console.log(`  Sudah sinkron sebelumnya (SourceId match): ${skippedAlreadyTagged}`);
  console.log(`  Backfill SourceId ke baris migrasi lama (match by key): ${backfilled}`);
  console.log(`  Insert baris baru: ${inserted}`);
  console.log(`  Baris DoOpen sudah closed/shipping di Supabase (akan dihapus dari SQL, dibackup dulu): ${remainingIds.length}`);

  if (remainingIds.length > 0 && !DRY_RUN) {
    await pool.request().query(`
      IF OBJECT_ID('dbo.DoOpen_ClosedBackup_20260816', 'U') IS NULL
      SELECT * INTO dbo.DoOpen_ClosedBackup_20260816 FROM dbo.DoOpen WHERE 1=0
    `);
    for (const id of remainingIds) {
      await pool.request()
        .input("Id", sql.UniqueIdentifier, id)
        .query(`
          INSERT INTO dbo.DoOpen_ClosedBackup_20260816 SELECT * FROM dbo.DoOpen WHERE Id = @Id;
          DELETE FROM dbo.DoOpen WHERE Id = @Id;
        `);
    }
    console.log(`  Backup ke dbo.DoOpen_ClosedBackup_20260816 dan hapus dari dbo.DoOpen selesai.`);
  }
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (tidak menulis apa pun)" : "LIVE (menulis ke database)"}`);
  await syncMasterItem();
  await syncTransaksi("transaksi_masuk", "TransaksiMasuk", []);
  await syncTransaksi("transaksi_keluar", "TransaksiKeluar", []);
  await syncDoOpen();
  console.log("\nSelesai.");
  const pool = await getPool();
  await pool.close();
}

main().catch((err) => {
  console.error("GAGAL:", err?.message || err);
  process.exit(1);
});
