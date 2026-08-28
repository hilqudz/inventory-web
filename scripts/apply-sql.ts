/* Jalankan file .sql ke database (split per batch "GO").
   Pakai: npx tsx scripts/apply-sql.ts sql/003_sp_auth_login.sql */
import { readFileSync } from "fs";
import { getPool } from "../src/db";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Pakai: npx tsx scripts/apply-sql.ts <path-file.sql>");
    process.exit(1);
  }
  const content = readFileSync(file, "utf-8");
  const batches = content
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);

  const pool = await getPool();
  for (const [i, batch] of batches.entries()) {
    await pool.request().batch(batch);
    console.log(`Batch ${i + 1}/${batches.length} OK`);
  }
  await pool.close();
  console.log(`Selesai: ${file}`);
}

main().catch((err) => {
  console.error("Gagal:", err?.message || err);
  process.exit(1);
});
