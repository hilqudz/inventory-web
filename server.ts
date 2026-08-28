import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import { getPool, sql } from "./src/db";
import { signToken, authRequired, requireRole, loginRateLimit, type AuthedRequest } from "./src/auth";
import { registerTransaksiRoutes } from "./src/transaksiRoutes";
import { registerDoOpenRoutes } from "./src/doOpenRoutes";
import { registerRequestDoRoutes } from "./src/requestDoRoutes";
import { registerContainerRoutes } from "./src/containerRoutes";
import { registerCatalogPhotoRoutes, UPLOAD_DIR } from "./src/catalogPhotoRoutes";
import { registerReportRoutes } from "./src/reportRoutes";
import { registerUserRoutes } from "./src/userRoutes";
import { registerCifRoutes } from "./src/cifRoutes";
import { registerSecurityRoutes } from "./src/securityRoutes";

dotenv.config();

function generateLocalWarehouseAnswer(query: string, context: any, isOPR: boolean): string {
  const q = (query || "").toLowerCase();
  const totals = context?.totals || {};
  const financials = totals?.financials || {};
  const items: any[] = context?.allItems || context?.searchMatchedItems || context?.topHighestNilaiJual || context?.topHighestStock || [];

  const formatRupiah = (val: number | undefined) => {
    if (val === undefined || val === null || isNaN(val)) return 'Rp 0';
    return 'Rp ' + Math.round(val).toLocaleString('id-ID');
  };

  const isFinancialOrPriceQuery = 
    q.includes('harga') || 
    q.includes('nilai') || 
    q.includes('jual') || 
    q.includes('beli') || 
    q.includes('modal') || 
    q.includes('stok') || 
    q.includes('item') || 
    q.includes('barang') ||
    q.includes('berapa');

  let answer = `### 🤖 AI Gudang Assistant\n\n`;

  if (isFinancialOrPriceQuery) {
    answer += `Berikut adalah rincian data harga jual, harga beli, dan nilai persediaan barang berdasarkan data real-time gudang saat ini:\n\n`;

    answer += `#### 💵 Ringkasan Finansial Inventoris Gudang:\n`;
    answer += `- **Total Sisa Stok Fisik**: ${(totals.stock || 0).toLocaleString('id-ID')} unit (${totals.items || 0} master item)\n`;
    answer += `- **Total Nilai Jual Sisa Stok**: **${formatRupiah(financials.totalNilaiJualSisaStock)}**\n`;

    if (!isOPR && financials.totalNilaiBeliSisaStock !== undefined) {
      answer += `- **Total Nilai Beli / Modal Sisa Stok**: **${formatRupiah(financials.totalNilaiBeliSisaStock)}**\n`;
      const margin = (financials.totalNilaiJualSisaStock || 0) - (financials.totalNilaiBeliSisaStock || 0);
      answer += `- **Estimasi Potensi Margin Profit**: **${formatRupiah(margin)}**\n`;
    } else if (isOPR) {
      answer += `- *Catatan Hak Akses Peran OPR*: Akses informasi Harga Beli & Nilai Beli Modal dibatasi khusus untuk Admin / Audit / BOD.\n`;
    }

    if (financials.totalNilaiJualDoOpen !== undefined) {
      answer += `- **Total Nilai Jual DO OPEN**: ${formatRupiah(financials.totalNilaiJualDoOpen)}\n`;
    }
    if (financials.totalNilaiJualLepasan !== undefined) {
      answer += `- **Total Nilai Jual Stok Lepasan (Bebas)**: ${formatRupiah(financials.totalNilaiJualLepasan)}\n`;
    }
    answer += `\n`;

    if (items && items.length > 0) {
      answer += `#### 📦 Detail Harga & Nilai Stok Per Item Barang:\n\n`;
      if (!isOPR) {
        answer += `| No | Kode Barang | Nama Barang | Sisa Stok | Harga Jual | Total Nilai Jual | Harga Beli | Total Nilai Beli |\n`;
        answer += `|:---:|:---|:---|:---:|:---:|:---:|:---:|:---:|\n`;
        items.forEach((it: any, idx: number) => {
          answer += `| ${idx + 1} | \`${it.code}\` | ${it.name} | ${(it.stk || 0).toLocaleString('id-ID')} unit | ${formatRupiah(it.hj)} | ${formatRupiah(it.nj)} | ${formatRupiah(it.hb)} | ${formatRupiah(it.nb)} |\n`;
        });
      } else {
        answer += `| No | Kode Barang | Nama Barang | Sisa Stok | Harga Jual | Total Nilai Jual |\n`;
        answer += `|:---:|:---|:---|:---:|:---:|:---:|\n`;
        items.forEach((it: any, idx: number) => {
          answer += `| ${idx + 1} | \`${it.code}\` | ${it.name} | ${(it.stk || 0).toLocaleString('id-ID')} unit | ${formatRupiah(it.hj)} | ${formatRupiah(it.nj)} |\n`;
        });
      }
      answer += `\n`;
    }
  } else {
    answer += `Berikut adalah ringkasan status operasional gudang saat ini:\n\n`;
    answer += `- **Total Master Item**: ${totals.items || 0} barang\n`;
    answer += `- **Total Sisa Stok Fisik**: ${(totals.stock || 0).toLocaleString('id-ID')} unit\n`;
    answer += `- **Total DO OPEN Aktif**: ${(totals.doOpen || 0).toLocaleString('id-ID')} unit (Area QC: ${totals.qcGroup?.qty || 0} unit, Area Logistik: ${totals.logGroup?.qty || 0} unit)\n`;
    answer += `- **Total Container Impor**: ${totals.containers?.total || 0} kontainer (${totals.containers?.tibaBintara || 0} Tiba di Bintara)\n\n`;
  }

  answer += `---\n*ℹ️ Tanggapan ini diproses secara instan melalui Engine Real-time Data Gudang.*`;
  return answer;
}

async function startServer() {
  const app = express();
  // Nginx selalu jadi reverse proxy di production/dev (lihat CLAUDE.md) — percaya
  // header X-Forwarded-For dari hop pertama saja, supaya req.ip = IP client asli,
  // bukan 127.0.0.1 (penting untuk rate-limit & log LoginAttempts per-IP).
  app.set("trust proxy", 1);
  // Jangan bocorin framework backend ke response header (info disclosure minor).
  app.disable("x-powered-by");
  app.use(express.json({ limit: "15mb" }));

  const PORT = 3000;

  // AI Router config (OpenAI-compatible endpoint, self-hosted — pengganti Gemini SDK langsung)
  const AI_ROUTER_BASE_URL = (process.env.AI_ROUTER_BASE_URL || "http://localhost:20128/v1").replace(/\/+$/, "");
  const AI_ROUTER_API_KEY = process.env.AI_ROUTER_API_KEY || "";
  const AI_ROUTER_MODELS = (process.env.AI_ROUTER_MODELS || "cc/claude-haiku-4-5-20251001,ag/gemini-3.6-flash-medium")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Health check API
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // ============================================================
  // AUTH — pengganti verifyLoginSupabase (lihat docs/API-ENDPOINTS.md)
  // ============================================================
  const logLoginAttempt = async (nik: string, ip: string, success: boolean, failReason?: string) => {
    try {
      const pool = await getPool();
      await pool
        .request()
        .input("Nik", sql.NVarChar(50), nik || null)
        .input("IpAddress", sql.NVarChar(100), ip || null)
        .input("Success", sql.Bit, success ? 1 : 0)
        .input("FailReason", sql.NVarChar(100), failReason || null)
        .query(
          "INSERT INTO dbo.LoginAttempts (Nik, IpAddress, Success, FailReason) VALUES (@Nik, @IpAddress, @Success, @FailReason)"
        );
    } catch (err) {
      // Jangan sampai gagal log bikin login ikut gagal — cukup catat ke console
      console.error("Gagal catat LoginAttempts:", (err as any)?.message || err);
    }
  };

  app.post("/api/auth/login", loginRateLimit, async (req, res) => {
    const clientIp = req.ip || "unknown";
    try {
      const { nik, password } = req.body || {};
      if (typeof nik !== "string" || typeof password !== "string" || !nik.trim() || !password) {
        return res.status(400).json({ error: "nik dan password wajib diisi." });
      }
      const cleanNik = nik.trim().toLowerCase();

      const pool = await getPool();
      const result = await pool
        .request()
        .input("Nik", sql.NVarChar(50), cleanNik)
        .execute("usp_GetUserForLogin");

      const row = result.recordset?.[0];
      // Pesan error sengaja sama untuk "user tidak ada" vs "password salah"
      const invalidMsg = { error: "NIK atau password salah." };
      if (!row) {
        await logLoginAttempt(cleanNik, clientIp, false, "user_not_found");
        return res.status(401).json(invalidMsg);
      }

      const match = await bcrypt.compare(password, row.PasswordHash);
      if (!match) {
        await logLoginAttempt(cleanNik, clientIp, false, "wrong_password");
        return res.status(401).json(invalidMsg);
      }

      if (!row.IsApproved) {
        await logLoginAttempt(cleanNik, clientIp, false, "not_approved");
        return res.status(403).json({ error: "Akun belum di-approve Admin." });
      }

      await logLoginAttempt(cleanNik, clientIp, true);
      const token = signToken({ nik: row.Nik, role: row.Role, displayName: row.NamaLengkap });
      // Bentuk `user` mengikuti AppUser di src/types.ts — TANPA kolom password
      res.json({
        token,
        user: {
          id: row.Nik,
          nik: row.Nik,
          displayName: row.NamaLengkap,
          role: row.Role,
          isApproved: Boolean(row.IsApproved),
          createdAt: row.CreatedAt,
          approvedBy: row.ApprovedBy ?? undefined,
          approvedAt: row.ApprovedAt ?? undefined,
        },
      });
    } catch (err: any) {
      console.error("Error /api/auth/login:", err?.message || err);
      res.status(500).json({ error: "Gagal terhubung ke database. Cek tunnel SSH masih terbuka." });
    }
  });

  app.get("/api/auth/me", authRequired, (req: AuthedRequest, res) => {
    res.json({ user: req.user });
  });

  // ============================================================
  // MASTER ITEM — pengganti fetchMasterItems / addMasterItem
  // Bentuk response mengikuti MasterItem di src/types.ts
  // ============================================================
  const mapMasterItemRow = (row: any, hideHargaBeli: boolean) => ({
    id: row.Kode,
    itemCode: row.Kode,
    itemName: row.NamaBarang,
    groupName: row.GroupName,
    hargaJual: Number(row.HargaJual || 0),
    // Harga beli/modal disembunyikan dari OPR & Team Gudang (permintaan Pak Irvan
    // 2026-08-18: OPR & Team Gudang cuma boleh lihat harga jual; Audit tetap
    // lihat dua-duanya). Lihat docs/API-ENDPOINTS.md.
    ...(hideHargaBeli ? {} : { hargaBeli: Number(row.HargaBeli || 0) }),
    createdDate: row.CreatedAt ? new Date(row.CreatedAt).toISOString().slice(0, 10) : undefined,
    createdAt: row.CreatedAt,
  });

  app.get("/api/master-items", authRequired, async (req: AuthedRequest, res) => {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .query("SELECT Kode, NamaBarang, GroupName, HargaJual, HargaBeli, CreatedAt FROM dbo.MasterItem ORDER BY CreatedAt");
      const hideHargaBeli = req.user!.role === "OPR" || req.user!.role === "Team Gudang";
      res.json(result.recordset.map((row) => mapMasterItemRow(row, hideHargaBeli)));
    } catch (err: any) {
      console.error("Error GET /api/master-items:", err?.message || err);
      res.status(500).json({ error: "Gagal ambil data master item." });
    }
  });

  app.post(
    "/api/master-items",
    authRequired,
    requireRole("Admin", "Audit", "Team Gudang"),
    async (req: AuthedRequest, res) => {
      try {
        const { itemCode, itemName, groupName, hargaJual, hargaBeli } = req.body || {};
        if (typeof itemCode !== "string" || !itemCode.trim() || typeof itemName !== "string" || !itemName.trim() || typeof groupName !== "string" || !groupName.trim()) {
          return res.status(400).json({ error: "itemCode, itemName, dan groupName wajib diisi." });
        }
        if ((hargaJual !== undefined && isNaN(Number(hargaJual))) || (hargaBeli !== undefined && isNaN(Number(hargaBeli)))) {
          return res.status(400).json({ error: "hargaJual/hargaBeli harus angka." });
        }

        const pool = await getPool();
        await pool
          .request()
          .input("Kode", sql.NVarChar(100), itemCode.trim())
          .input("NamaBarang", sql.NVarChar(300), itemName.trim())
          .input("GroupName", sql.NVarChar(150), groupName.trim())
          .input("HargaJual", sql.Decimal(18, 2), hargaJual !== undefined ? Number(hargaJual) : null)
          .input("HargaBeli", sql.Decimal(18, 2), hargaBeli !== undefined ? Number(hargaBeli) : null)
          .query(`
            INSERT INTO dbo.MasterItem (Kode, NamaBarang, GroupName, HargaJual, HargaBeli)
            VALUES (@Kode, @NamaBarang, @GroupName, @HargaJual, @HargaBeli)
          `);
        res.status(201).json({ success: true });
      } catch (err: any) {
        if (err?.number === 2627 || err?.number === 2601) {
          return res.status(409).json({ error: "Kode barang sudah ada." });
        }
        console.error("Error POST /api/master-items:", err?.message || err);
        res.status(500).json({ error: "Gagal simpan master item." });
      }
    }
  );

  // AI ChatBot Endpoint for Warehouse Inventory
  app.post("/api/chat-gudang", authRequired, async (req: AuthedRequest, res) => {
    try {
      const { message, history, context } = req.body;

      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      const isOPR = req.user!.role === "OPR";

      // System prompt optimized for all web features, clarity, financial valuations, and token efficiency
      const systemInstruction = `
Anda adalah "AI Gudang Assistant" - Asisten Cerdas untuk Sistem Inventoris Gudang & Tracking Container Bintara.
Tugas Anda: Memberikan jawaban LENGKAP, AKURAT, LUGAS, dan TERSTRUKTUR dalam bahasa Indonesia mengenai seluruh data stok, perhitungan finansial (Nilai Jual & Nilai Beli Barang), serta seluruh fitur di aplikasi web ini.

=== PENGETAHUAN PERHITUNGAN NILAI HARGA JUAL & NILAI HARGA BELI BARANG ===
1. KODE FIELD PROPERTI ITEM DARI DATA CONTEXT:
   - 'code': Kode Barang
   - 'name': Nama Barang
   - 'cat': Kategori / Group
   - 'stk': Sisa Stok Fisik (Total Masuk - Total Keluar)
   - 'do': Total Qty DO OPEN
   - 'lep': Total Qty Stok Lepasan (Sisa Stok - DO OPEN)
   - 'hj': Harga Jual per unit (Rp)
   - 'nj': Nilai Jual Sisa Stok (stk * hj)
   - 'hb': Harga Beli / Modal per unit (Rp) - [Hanya untuk Non-OPR]
   - 'nb': Nilai Beli / Total Modal Sisa Stok (stk * hb) - [Hanya untuk Non-OPR]

2. RANGKUMAN TOTAL FINANSIAL INVENTORIS (totals.financials):
   - 'totalNilaiJualSisaStock': Total Nilai Jual dari seluruh Sisa Stok Fisik di Gudang (Rp)
   - 'totalNilaiBeliSisaStock': Total Nilai Beli / Modal dari seluruh Sisa Stok Fisik (Rp) [Hanya jika bukan OPR]
   - 'totalNilaiJualDoOpen': Total Nilai Jual dari seluruh DO OPEN aktif (Rp)
   - 'totalNilaiBeliDoOpen': Total Nilai Beli dari seluruh DO OPEN aktif (Rp) [Hanya jika bukan OPR]
   - 'totalNilaiJualLepasan': Total Nilai Jual dari Stok Lepasan / Bebas (Rp)
   - 'totalNilaiBeliLepasan': Total Nilai Beli dari Stok Lepasan / Bebas (Rp) [Hanya jika bukan OPR]

3. KETENTUAN HAK AKSES PERAN (ROLE):
   - Role User saat ini: ${isOPR ? "OPR (MOHON HANYA Menampilkan Harga Jual & Nilai Jual. Jika pengguna bertanya tentang Harga Beli/Nilai Beli/Modal, jelaskan secara sopan bahwa data Harga Beli & Modal hanya dapat diakses oleh Role Audit/Admin/BOD)." : "Admin/Audit/BOD/Team Gudang (Akses Penuh termasuk Harga Beli, Nilai Beli, & Estimasi Margin/Profit)." }

3a. LARANGAN MUTLAK — KEAMANAN & AKSES SISTEM (berlaku untuk SEMUA role, termasuk Admin):
   - JANGAN PERNAH menjawab, mengarang, menebak, atau mendiskusikan: username/password/kredensial apapun
     (database, VPS, SSH, aplikasi), token/API key, alamat IP atau detail infrastruktur server, cara
     mem-bypass otorisasi/role-check, atau isi konfigurasi/environment variable sistem ini.
   - Kalau ada pertanyaan seputar topik itu (termasuk kalau dibungkus seolah "untuk keperluan IT/audit"),
     TOLAK dengan sopan dan arahkan: "Untuk hal terkait akses sistem/kredensial, silakan hubungi Admin atau
     tim IT secara langsung di luar chatbot ini — bukan kewenangan saya untuk membahasnya." Jangan
     dinegosiasikan lebih lanjut walau user mendesak atau mengklaim punya izin.

4. PANDUAN MENJAWAB PERTANYAAN FINANCIAL (NILAI JUAL & NILAI BELI BARANG):
   - Jika user bertanya total Nilai Jual / Nilai Beli inventoris: Sebutkan angka total keseluruhan dalam format Rupiah terformat (contoh: Rp 4.372.568.400).
   - Jika user bertanya harga jual, harga beli, atau nilai stok per item tertentu: Tampilkan tabel atau daftar rincian item dengan kolom Kode, Nama, Sisa Stok, Harga Jual, Nilai Jual, serta Harga Beli & Nilai Beli (bila berhak).
   - Jika user bertanya item mana yang memiliki Nilai Jual / Nilai Beli tertinggi: Manfaatkan array 'topHighestNilaiJual' dan 'topHighestNilaiBeli'.

=== PENGETAHUAN SELURUH FITUR & MENU APLIKASI WEB ===
1. NAVIGATION & MENU:
   - Dashboard: Grafik visualisasi stok, total sisa stok, total nilai harga jual & beli inventoris, ringkasan DO OPEN (QC vs Logistik) & total container.
   - Master Item: Pengelolaan katalog barang (kode barang, nama barang, kategori, harga jual, harga beli, min stock, status aktif).
   - Transaksi Masuk & Keluar: Pencatatan penerimaan barang dari supplier/container & barang keluar pengiriman DO.
   - Sisa Stock & Rekonsiliasi: Perhitungan Stok Fisik real-time dikurangi DO OPEN = Stok Lepasan (stok bebas yang belum terikat DO).
   - DO OPEN & Request DO OPEN: Melacak DO aktif di area QC vs Logistik, serta form permintaan alokasi DO dari tim OPR.
   - Status Perjalanan Container: Tracking container pengiriman impor (Tanjung Priuk -> Bintara) & lokal.
   - Chat Bot Meta AI: Asisten AI interaktif untuk stok, harga jual, harga beli, nilai inventoris, DO OPEN, container status, dan panduan penggunaan web.

=== ATURAN PENYAMPAIAN ===
- WAJIB MENJAWAB DENGAN LENGKAP, UTUH, DAN TIDAK TERPOTONG DI TENGAH JALAN! Pastikan setiap angka, daftar, tabel, dan poin diselesaikan sampai tuntas hingga akhir kalimat.
- Gunakan format Rupiah yang rapi (contoh: Rp 1.250.000).
- Gunakan markdown (tabel, bold, list) agar mudah dibaca oleh BOD/Audit/OPR.
- Jangan pernah menyertakan teks kode mentah/JSON internal dalam jawaban.

=== REAL-TIME SNAPSHOT CONTEXT WEB ===
${JSON.stringify(context || {})}
      `;

      // Construct messages array (format OpenAI-compatible)
      const messages: any[] = [{ role: "system", content: systemInstruction }];
      if (Array.isArray(history)) {
        history.slice(-2).forEach((h: { role: string; content: string }) => {
          if (h && h.content) {
            messages.push({
              role: h.role === "user" ? "user" : "assistant",
              content: h.content,
            });
          }
        });
      }
      messages.push({ role: "user", content: message });

      let reply = "";

      for (const modelName of AI_ROUTER_MODELS) {
        try {
          const routerRes = await fetch(`${AI_ROUTER_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${AI_ROUTER_API_KEY}`,
            },
            body: JSON.stringify({
              model: modelName,
              messages,
              temperature: 0.1,
              max_tokens: 2048,
              stream: false,
            }),
          });

          if (!routerRes.ok) {
            const errText = await routerRes.text();
            console.warn(`Model ${modelName} error (${routerRes.status}):`, errText.slice(0, 150));
            continue;
          }

          const data: any = await routerRes.json();
          reply = data?.choices?.[0]?.message?.content || "";
          if (reply) break; // Success!
        } catch (modelErr: any) {
          const errStr = String(modelErr?.message || modelErr);
          console.warn(`Model ${modelName} error:`, errStr.slice(0, 150));
          // Continue to next model kalau router down/timeout/model tidak tersedia
        }
      }

      if (!reply) {
        // Fallback response using real-time context data if all models hit rate limit on free tier
        reply = generateLocalWarehouseAnswer(message, context, isOPR);
      }

      res.json({ reply });
    } catch (err: any) {
      console.error("Error call to /api/chat-gudang:", err);
      // Fallback on error
      const fallbackReply = generateLocalWarehouseAnswer(req.body?.message || "", req.body?.context || {}, req.user?.role === "OPR");
      res.json({ reply: fallbackReply });
    }
  });

  // PUT /api/master-items/:kode — partial update
  app.put(
    "/api/master-items/:kode",
    authRequired,
    requireRole("Admin", "Audit", "Team Gudang"),
    async (req: AuthedRequest, res) => {
      const r = req.body || {};
      const sets: string[] = [];
      const request = (await getPool()).request().input("Kode", sql.NVarChar(100), req.params.kode.trim());
      if (r.itemName !== undefined) { sets.push("NamaBarang = @Nama"); request.input("Nama", sql.NVarChar(300), String(r.itemName).trim()); }
      if (r.groupName !== undefined) { sets.push("GroupName = @Group"); request.input("Group", sql.NVarChar(150), String(r.groupName).trim()); }
      if (r.hargaJual !== undefined) { sets.push("HargaJual = @Jual"); request.input("Jual", sql.Decimal(18, 2), Number(r.hargaJual || 0)); }
      if (r.hargaBeli !== undefined) { sets.push("HargaBeli = @Beli"); request.input("Beli", sql.Decimal(18, 2), Number(r.hargaBeli || 0)); }
      if (!sets.length) return res.status(400).json({ error: "Tidak ada field yang diupdate." });
      try {
        const result = await request.query(`UPDATE dbo.MasterItem SET ${sets.join(", ")} WHERE Kode = @Kode`);
        if (!result.rowsAffected[0]) return res.status(404).json({ error: "Item tidak ditemukan." });
        res.json({ success: true });
      } catch (err: any) {
        console.error("Error PUT /api/master-items/:kode:", err?.message || err);
        res.status(500).json({ error: "Gagal update master item." });
      }
    }
  );

  const upsertMasterItemQuery = `
    MERGE dbo.MasterItem AS t
    USING (SELECT @Kode AS Kode) AS s ON t.Kode = s.Kode
    WHEN MATCHED THEN UPDATE SET
      NamaBarang = @NamaBarang, GroupName = @GroupName, HargaJual = @HargaJual, HargaBeli = @HargaBeli
    WHEN NOT MATCHED THEN INSERT (Kode, NamaBarang, GroupName, HargaJual, HargaBeli)
      VALUES (@Kode, @NamaBarang, @GroupName, @HargaJual, @HargaBeli);
  `;

  // PUT /api/master-items/:kode/upsert — insert atau update by kode
  app.put(
    "/api/master-items/:kode/upsert",
    authRequired,
    requireRole("Admin", "Audit", "Team Gudang"),
    async (req: AuthedRequest, res) => {
      const r = req.body || {};
      try {
        const pool = await getPool();
        await pool
          .request()
          .input("Kode", sql.NVarChar(100), req.params.kode.trim())
          .input("NamaBarang", sql.NVarChar(300), String(r.itemName || req.params.kode).trim())
          .input("GroupName", sql.NVarChar(150), String(r.groupName || "Umum").trim())
          .input("HargaJual", sql.Decimal(18, 2), Number(r.hargaJual || 0))
          .input("HargaBeli", sql.Decimal(18, 2), Number(r.hargaBeli || 0))
          .query(upsertMasterItemQuery);
        res.json({ success: true });
      } catch (err: any) {
        console.error("Error PUT /api/master-items/:kode/upsert:", err?.message || err);
        res.status(500).json({ error: "Gagal upsert master item." });
      }
    }
  );

  // POST /api/master-items/bulk — upsert banyak item dalam satu transaction
  app.post(
    "/api/master-items/bulk",
    authRequired,
    requireRole("Admin", "Audit", "Team Gudang"),
    async (req: AuthedRequest, res) => {
      const records: any[] = req.body?.records;
      if (!Array.isArray(records) || !records.length) {
        return res.status(400).json({ error: "Body harus { records: [...] } dan tidak kosong." });
      }
      const pool = await getPool();
      const tx = new sql.Transaction(pool);
      try {
        await tx.begin();
        let count = 0;
        for (const r of records) {
          const kode = String(r.itemCode || "").trim();
          if (!kode) continue;
          await new sql.Request(tx)
            .input("Kode", sql.NVarChar(100), kode)
            .input("NamaBarang", sql.NVarChar(300), String(r.itemName || kode).trim())
            .input("GroupName", sql.NVarChar(150), String(r.groupName || "Umum").trim())
            .input("HargaJual", sql.Decimal(18, 2), Number(r.hargaJual || 0))
            .input("HargaBeli", sql.Decimal(18, 2), Number(r.hargaBeli || 0))
            .query(upsertMasterItemQuery);
          count++;
        }
        await tx.commit();
        res.status(201).json({ success: true, upserted: count });
      } catch (err: any) {
        try { await tx.rollback(); } catch { /* sudah batal */ }
        console.error("Error POST /api/master-items/bulk:", err?.message || err);
        res.status(500).json({ error: "Gagal bulk upsert master item." });
      }
    }
  );

  // DELETE /api/master-items/:kode — Admin only
  app.delete("/api/master-items/:kode", authRequired, requireRole("Admin"), async (req: AuthedRequest, res) => {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input("Kode", sql.NVarChar(100), req.params.kode.trim())
        .query("DELETE FROM dbo.MasterItem WHERE Kode = @Kode");
      if (!result.rowsAffected[0]) return res.status(404).json({ error: "Item tidak ditemukan." });
      res.json({ success: true });
    } catch (err: any) {
      if (err?.number === 547) {
        return res.status(409).json({
          error: "Item ini tidak bisa dihapus karena masih punya riwayat transaksi (Transaksi Masuk/Keluar, DO OPEN, atau foto katalog). Hapus/pindahkan riwayatnya dulu kalau memang item ini harus dihapus.",
        });
      }
      console.error("Error DELETE /api/master-items/:kode:", err?.message || err);
      res.status(500).json({ error: "Gagal hapus master item." });
    }
  });

  // POST /api/admin/clear-table — Admin only. Pengganti clearSupabaseTable
  // (fitur "Hapus Permanent Seluruh Data" di UI). Whitelist nama tabel lama →
  // tabel SQL Server; nama di luar whitelist ditolak.
  const CLEARABLE_TABLES: Record<string, string> = {
    master_item: "dbo.MasterItem",
    transaksi_masuk: "dbo.TransaksiMasuk",
    transaksi_keluar: "dbo.TransaksiKeluar",
    do_open: "dbo.DoOpen",
    request_do_open: "dbo.RequestDoOpen",
    container_status: "dbo.ContainerStatus",
    katalog_foto: "dbo.KatalogFoto",
  };
  app.post("/api/admin/clear-table", authRequired, requireRole("Admin"), async (req: AuthedRequest, res) => {
    const table = CLEARABLE_TABLES[String(req.body?.table || "")];
    if (!table) return res.status(400).json({ error: "Nama tabel tidak dikenal." });
    try {
      const pool = await getPool();
      const result = await pool.request().query(`DELETE FROM ${table}`);
      res.json({ success: true, deleted: result.rowsAffected[0] || 0 });
    } catch (err: any) {
      console.error("Error POST /api/admin/clear-table:", err?.message || err);
      res.status(500).json({ error: "Gagal mengosongkan tabel." });
    }
  });

  // ============================================================
  // TRANSAKSI MASUK & KELUAR (lihat src/transaksiRoutes.ts)
  // ============================================================
  registerTransaksiRoutes(app, "masuk");
  registerTransaksiRoutes(app, "keluar");

  // ============================================================
  // DO OPEN + reconcile + cleanup (lihat src/doOpenRoutes.ts)
  // ============================================================
  registerDoOpenRoutes(app);

  // ============================================================
  // REQUEST DO OPEN — approval flow OPR (lihat src/requestDoRoutes.ts)
  // ============================================================
  registerRequestDoRoutes(app);

  // ============================================================
  // CONTAINER STATUS (lihat src/containerRoutes.ts)
  // ============================================================
  registerContainerRoutes(app);

  // ============================================================
  // KATALOG FOTO (lihat src/catalogPhotoRoutes.ts)
  // Di production Nginx yang serve /uploads/*; static di sini untuk dev
  // ============================================================
  registerCatalogPhotoRoutes(app);
  app.use("/uploads/foto-barang", express.static(UPLOAD_DIR));

  // ============================================================
  // REPORTS — agregasi via VIEW T-SQL (lihat src/reportRoutes.ts)
  // ============================================================
  registerReportRoutes(app);

  // ============================================================
  // USERS (Admin only + register publik) & CIF CONTAINER (Admin/Audit)
  // ============================================================
  registerUserRoutes(app);
  registerCifRoutes(app);
  registerSecurityRoutes(app);

  // Vite middleware setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
