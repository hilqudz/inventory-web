/* Upload massal foto katalog dari folder lokal Foto_Katalog_Item/ ke API
   production, resize+compress persis sama seperti upload manual di UI
   (CatalogPhotoView.tsx: max 1000x1000, JPEG quality 0.85).

   Pakai endpoint API asli (bukan tulis file+DB manual) supaya validasi
   magic-byte & role-check yang sudah ada otomatis berlaku.

   Pakai: npx tsx scripts/bulk-upload-katalog-foto.ts
   Butuh env: API_BASE, API_TOKEN (login token Admin) */
import { readFileSync } from "fs";
import path from "path";
import sharp from "sharp";

const LIST_FILE = "/private/tmp/claude-501/-Users-qq/dfddb8b2-0c8e-495b-8241-ade7d7dd2608/scratchpad/photo_upload_list.json";
const PHOTO_DIR = "/Users/qq/Desktop/rpg-inventory-app/Foto_Katalog_Item";
const API_BASE = process.env.API_BASE || "https://inventorynyarpg.my.id";
const API_TOKEN = process.env.API_TOKEN;

if (!API_TOKEN) {
  console.error("API_TOKEN belum diset.");
  process.exit(1);
}

type Item = { file: string; itemCode: string };

async function compress(filePath: string): Promise<Buffer> {
  return sharp(filePath)
    .resize(1000, 1000, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function uploadOne(itemCode: string, buffer: Buffer): Promise<{ ok: boolean; error?: string }> {
  const base64 = buffer.toString("base64");
  const dataUrl = `data:image/jpeg;base64,${base64}`;
  try {
    const res = await fetch(`${API_BASE}/api/catalog-photos/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_TOKEN}`,
      },
      body: JSON.stringify({
        itemCode,
        itemName: "",
        groupName: "",
        photoUrl: dataUrl,
        notes: "Bulk import Foto_Katalog_Item",
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 150)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function main() {
  const items: Item[] = JSON.parse(readFileSync(LIST_FILE, "utf-8"));
  console.log(`Total ${items.length} foto akan diupload...`);

  let success = 0;
  let failed: { file: string; itemCode: string; error: string }[] = [];

  for (let i = 0; i < items.length; i++) {
    const { file, itemCode } = items[i];
    const filePath = path.join(PHOTO_DIR, file);
    try {
      const buffer = await compress(filePath);
      const result = await uploadOne(itemCode, buffer);
      if (result.ok) {
        success++;
      } else {
        failed.push({ file, itemCode, error: result.error || "unknown" });
      }
    } catch (e: any) {
      failed.push({ file, itemCode, error: e?.message || String(e) });
    }
    if ((i + 1) % 50 === 0 || i === items.length - 1) {
      console.log(`Progress: ${i + 1}/${items.length} (sukses: ${success}, gagal: ${failed.length})`);
    }
  }

  console.log("\n=== SELESAI ===");
  console.log(`Sukses: ${success}`);
  console.log(`Gagal: ${failed.length}`);
  if (failed.length > 0) {
    console.log("Detail gagal (maks 30):", JSON.stringify(failed.slice(0, 30), null, 1));
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
