/* Buat/update user dummy untuk testing login (password di-bcrypt).
   Pakai: npx tsx scripts/seed-dummy-user.ts <nik> <password> <role> [namaLengkap]
   Contoh: npx tsx scripts/seed-dummy-user.ts admin.dummy "Admin123!" Admin "Admin Dummy"
   Role valid: Admin | Audit | Team Gudang | OPR (lihat CK_Users_Role di sql/001) */
import bcrypt from "bcrypt";
import { getPool, sql } from "../src/db";

async function main() {
  const [nik, password, role, namaLengkap] = process.argv.slice(2);
  if (!nik || !password || !role) {
    console.error('Pakai: npx tsx scripts/seed-dummy-user.ts <nik> <password> <role> [namaLengkap]');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const pool = await getPool();

  // MERGE upsert supaya script aman dijalankan berulang
  await pool
    .request()
    .input("Nik", sql.NVarChar(50), nik.trim().toLowerCase())
    .input("NamaLengkap", sql.NVarChar(200), namaLengkap || nik)
    .input("PasswordHash", sql.NVarChar(255), hash)
    .input("Role", sql.NVarChar(50), role)
    .query(`
      MERGE dbo.Users AS t
      USING (SELECT @Nik AS Nik) AS s ON t.Nik = s.Nik
      WHEN MATCHED THEN
        UPDATE SET NamaLengkap = @NamaLengkap, PasswordHash = @PasswordHash, Role = @Role, IsApproved = 1
      WHEN NOT MATCHED THEN
        INSERT (Nik, NamaLengkap, PasswordHash, Role, IsApproved)
        VALUES (@Nik, @NamaLengkap, @PasswordHash, @Role, 1);
    `);

  await pool.close();
  console.log(`User '${nik}' siap (role ${role}, approved).`);
}

main().catch((err) => {
  console.error("Gagal:", err?.message || err);
  process.exit(1);
});
