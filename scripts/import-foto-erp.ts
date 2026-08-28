/* Import foto katalog dari link ERP kantor (query dbo_V_itemFoto) ke API
   production, resize+compress persis sama seperti upload manual di UI
   (CatalogPhotoView.tsx: max 1000x1000, JPEG quality 0.85).

   Beda dari bulk-upload-katalog-foto.ts: sumber gambarnya di-download dari
   URL ERP (bukan file lokal), lalu langsung diupload lewat API yang sama.

   Pakai: npx tsx scripts/import-foto-erp.ts <path-json-batch>
   Butuh env: API_BASE, API_TOKEN (login token Admin) */
import sharp from "sharp";
import { readFileSync } from "fs";
import https from "node:https";

const API_BASE = process.env.API_BASE || "https://inventorynyarpg.my.id";
const API_TOKEN = process.env.API_TOKEN;
const BATCH_FILE = process.argv[2];

// Server foto ERP kantor (md.rpgroup.co.id / storenaughty.rpgroup.co.id) kirim
// sertifikat SSL yang rantainya tidak lengkap ("unable to verify the first
// certificate") — curl/browser masih toleran, tapi Node.js strict dan
// menolak. Ini bug infrastruktur di server kantor sendiri, BUKAN masalah
// skrip ini. Sengaja dilonggarkan verifikasi TLS-nya HANYA untuk request
// download foto (lewat https.get manual, bukan fetch global) supaya
// permintaan ke API kita sendiri (inventorynyarpg.my.id) tetap verifikasi
// TLS normal. Bug sertifikatnya perlu dilaporkan terpisah ke tim IT kantor.
// Sebagian URL dari export ERP punya spasi mentah + kurung siku [ ] yang
// belum di-encode (mis. ".../BATAKO_LF/ [UMBRELLA...") — bikin request line
// HTTP invalid, server balas 400. Spasi di AWAL nama file ternyata memang
// bukan bagian nama file asli (dikonfirmasi: versi tanpa leading space balik
// 200) makanya di-trim, bukan di-encode jadi %20. Sengaja TIDAK pakai
// encodeURI() polos karena itu ikut meng-encode ulang '%' yang sudah valid
// (mis. %23 dari REPLACE '#' di query SQL asal) jadi %2523 — rusak.
function fixUrl(rawUrl: string): string {
  const parts = rawUrl.split("/");
  const last = parts.pop()!.trim();
  parts.push(last);
  return parts.join("/").replace(/ /g, "%20").replace(/\[/g, "%5B").replace(/\]/g, "%5D");
}

function downloadRaw(rawUrl: string): Promise<Buffer> {
  const url = fixUrl(rawUrl);
  return new Promise((resolve, reject) => {
    https.get(url, { rejectUnauthorized: false, timeout: 20000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download gagal HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject).on("timeout", function (this: any) { this.destroy(new Error("Timeout")); });
  });
}

if (!API_TOKEN) {
  console.error("API_TOKEN belum diset.");
  process.exit(1);
}
if (!BATCH_FILE) {
  console.error("Usage: npx tsx scripts/import-foto-erp.ts <path-json-batch>");
  process.exit(1);
}

type Item = { itemCode: string; photoUrl: string };

async function downloadAndCompress(url: string): Promise<Buffer> {
  const raw = await downloadRaw(url);
  return sharp(raw)
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
        notes: "Import dari database ERP kantor (dbo_V_itemFoto)",
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
  const items: Item[] = JSON.parse(readFileSync(BATCH_FILE, "utf-8"));
  console.log(`Total ${items.length} foto akan diimport dari ERP...`);

  let success = 0;
  const failed: { itemCode: string; photoUrl: string; error: string }[] = [];

  for (let i = 0; i < items.length; i++) {
    const { itemCode, photoUrl } = items[i];
    try {
      const buffer = await downloadAndCompress(photoUrl);
      const result = await uploadOne(itemCode, buffer);
      if (result.ok) {
        success++;
        console.log(`[${i + 1}/${items.length}] OK: ${itemCode}`);
      } else {
        failed.push({ itemCode, photoUrl, error: result.error || "unknown" });
        console.log(`[${i + 1}/${items.length}] GAGAL upload: ${itemCode} -- ${result.error}`);
      }
    } catch (e: any) {
      failed.push({ itemCode, photoUrl, error: e?.message || String(e) });
      console.log(`[${i + 1}/${items.length}] GAGAL download: ${itemCode} -- ${e?.message || e}`);
    }
  }

  console.log("\n=== SELESAI ===");
  console.log(`Sukses: ${success}`);
  console.log(`Gagal: ${failed.length}`);
  if (failed.length > 0) {
    console.log("Detail gagal:", JSON.stringify(failed, null, 1));
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
