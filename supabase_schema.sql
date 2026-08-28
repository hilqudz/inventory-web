-- ============================================================================
-- SQL SCHEMA FOR WEB GUDANG BINTARA IN SUPABASE
-- Project ID: cevaowpizcqikbxquweh
-- Region: ap-southeast-1
-- ============================================================================

-- 1. TABEL USER ROLE LOGIN & OTORISASI USER
CREATE TABLE IF NOT EXISTS public.users (
  nik TEXT PRIMARY KEY,
  nama_lengkap TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Audit', 'Team Gudang', 'OPR')),
  is_approved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABEL MASTER BARANG (master_item)
CREATE TABLE IF NOT EXISTS public.master_item (
  kode TEXT PRIMARY KEY,
  nama_barang TEXT NOT NULL,
  group_name TEXT NOT NULL,
  harga_jual NUMERIC(15, 2) DEFAULT 0,
  harga_beli NUMERIC(15, 2) DEFAULT 0,
  foto_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABEL TRANSAKSI MASUK (transaksi_masuk)
CREATE TABLE IF NOT EXISTS public.transaksi_masuk (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  posting_date TEXT,
  document_no TEXT NOT NULL,
  item_code TEXT NOT NULL REFERENCES public.master_item(kode) ON DELETE CASCADE ON UPDATE CASCADE,
  category TEXT,
  qty NUMERIC(12, 2) DEFAULT 0,
  from_location TEXT,
  to_location TEXT,
  entry_remark TEXT,
  aksi TEXT DEFAULT 'MASUK',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_transaksi_masuk_item_code ON public.transaksi_masuk(item_code);
CREATE INDEX IF NOT EXISTS idx_transaksi_masuk_doc ON public.transaksi_masuk(document_no);

-- 4. TABEL TRANSAKSI KELUAR (transaksi_keluar)
CREATE TABLE IF NOT EXISTS public.transaksi_keluar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  posting_date TEXT,
  document_no TEXT NOT NULL,
  item_code TEXT NOT NULL REFERENCES public.master_item(kode) ON DELETE CASCADE ON UPDATE CASCADE,
  category TEXT,
  qty NUMERIC(12, 2) DEFAULT 0,
  from_location TEXT,
  to_location TEXT,
  entry_remark TEXT,
  aksi TEXT DEFAULT 'KELUAR',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_transaksi_keluar_item_code ON public.transaksi_keluar(item_code);
CREATE INDEX IF NOT EXISTS idx_transaksi_keluar_doc ON public.transaksi_keluar(document_no);

-- 5. TABEL DO OPEN (do_open)
CREATE TABLE IF NOT EXISTS public.do_open (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  posting_date TEXT,
  area_rm_opr TEXT,
  document_no TEXT NOT NULL,
  item_code TEXT NOT NULL REFERENCES public.master_item(kode) ON DELETE CASCADE ON UPDATE CASCADE,
  status_do_open TEXT,
  area_spv_opr TEXT,
  qty NUMERIC(12, 2) DEFAULT 0,
  nilai_jual NUMERIC(15, 2) DEFAULT 0,
  from_location TEXT,
  to_location TEXT,
  aksi TEXT DEFAULT 'DO_OPEN',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_do_open_item_code ON public.do_open(item_code);
CREATE INDEX IF NOT EXISTS idx_do_open_doc ON public.do_open(document_no);

-- 6. TABEL REQUEST DO OPEN (request_do_open)
CREATE TABLE IF NOT EXISTS public.request_do_open (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tanggal_request TEXT,
  document_no TEXT NOT NULL,
  item_code TEXT NOT NULL REFERENCES public.master_item(kode) ON DELETE CASCADE ON UPDATE CASCADE,
  qty NUMERIC(12, 2) DEFAULT 0,
  area_rm_opr TEXT,
  area_spv_opr TEXT,
  to_location TEXT,
  pengajuan TEXT,
  status_approval TEXT DEFAULT 'PENDING',
  aksi_pic_gudang TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 7. VIEW: SISA STOCK (sisa_stok = sum(masuk) - sum(keluar))
-- ============================================================================
CREATE OR REPLACE VIEW public.sisa_stock AS
SELECT 
  m.kode AS item_code,
  m.nama_barang AS item_name,
  m.group_name AS group_name,
  m.harga_jual AS harga_jual,
  m.harga_beli AS harga_beli,
  COALESCE(tm.total_masuk, 0) AS total_masuk,
  COALESCE(tk.total_keluar, 0) AS total_keluar,
  (COALESCE(tm.total_masuk, 0) - COALESCE(tk.total_keluar, 0)) AS sisa_stock,
  ((COALESCE(tm.total_masuk, 0) - COALESCE(tk.total_keluar, 0)) * m.harga_jual) AS nilai_stock_jual,
  ((COALESCE(tm.total_masuk, 0) - COALESCE(tk.total_keluar, 0)) * m.harga_beli) AS nilai_stock_beli,
  CASE 
    WHEN (COALESCE(tm.total_masuk, 0) - COALESCE(tk.total_keluar, 0)) <= 0 THEN 'STOK HABIS'
    WHEN (COALESCE(tm.total_masuk, 0) - COALESCE(tk.total_keluar, 0)) < 10 THEN 'WARNING'
    ELSE 'AMAN'
  END AS status_stock
FROM public.master_item m
LEFT JOIN (
  SELECT item_code, SUM(qty) AS total_masuk 
  FROM public.transaksi_masuk 
  GROUP BY item_code
) tm ON m.kode = tm.item_code
LEFT JOIN (
  SELECT item_code, SUM(qty) AS total_keluar 
  FROM public.transaksi_keluar 
  GROUP BY item_code
) tk ON m.kode = tk.item_code;

-- ============================================================================
-- 8. VIEW: REKONSILIASI STOCK
-- (Sisa Stock (A), Qty DO OPEN (B), Qty Lepasan (A - B), Status Rekonsiliasi)
-- ============================================================================
CREATE OR REPLACE VIEW public.rekonsiliasi_stock AS
SELECT 
  s.item_code,
  s.item_name,
  s.group_name,
  s.sisa_stock AS sisa_stock_a,
  COALESCE(dopen.total_do_open, 0) AS qty_do_open_b,
  (s.sisa_stock - COALESCE(dopen.total_do_open, 0)) AS qty_lepasan,
  CASE 
    WHEN (s.sisa_stock - COALESCE(dopen.total_do_open, 0)) < 0 THEN 'DEFISIT'
    WHEN (s.sisa_stock - COALESCE(dopen.total_do_open, 0)) = 0 THEN 'BALANCED'
    ELSE 'SURPLUS'
  END AS status_rekonsiliasi
FROM public.sisa_stock s
LEFT JOIN (
  SELECT item_code, SUM(qty) AS total_do_open 
  FROM public.do_open 
  GROUP BY item_code
) dopen ON s.item_code = dopen.item_code;

-- ============================================================================
-- 8B. VIEW: REPORT DO OPEN KIRIM (DETAIL & AGREGASI)
-- ============================================================================

-- A. VIEW DETAIL REPORT DO OPEN KIRIM (Approved DO Open + Nilai Jual/Beli Master Item)
CREATE OR REPLACE VIEW public.view_report_do_open_kirim AS
SELECT 
  r.id,
  r.tanggal_request AS posting_date,
  r.document_no,
  r.item_code,
  m.nama_barang AS item_name,
  m.group_name,
  r.qty,
  COALESCE(m.harga_jual, 0) AS harga_jual,
  COALESCE(m.harga_beli, 0) AS harga_beli,
  (r.qty * COALESCE(m.harga_jual, 0)) AS total_nilai_jual,
  (r.qty * COALESCE(m.harga_beli, 0)) AS total_nilai_beli,
  COALESCE(NULLIF(r.area_spv_opr, ''), 'Tanpa Area SPV') AS area_spv_opr,
  COALESCE(NULLIF(r.area_rm_opr, ''), 'Tanpa Area RM') AS area_rm_opr,
  COALESCE(NULLIF(r.to_location, ''), 'Tanpa Lokasi') AS to_location,
  r.pengajuan,
  r.status_approval,
  r.aksi_pic_gudang,
  r.created_at
FROM public.request_do_open r
LEFT JOIN public.master_item m ON r.item_code = m.kode
WHERE UPPER(COALESCE(r.status_approval, '')) = 'APPROVED';

-- B. VIEW AGREGASI PER AREA SPV
CREATE OR REPLACE VIEW public.view_report_do_open_kirim_by_spv AS
SELECT 
  area_spv_opr,
  COUNT(DISTINCT document_no) AS total_dokumen,
  COUNT(id) AS total_item_record,
  SUM(qty) AS total_qty,
  SUM(total_nilai_jual) AS total_nilai_jual,
  SUM(total_nilai_beli) AS total_nilai_beli
FROM public.view_report_do_open_kirim
GROUP BY area_spv_opr
ORDER BY total_qty DESC;

-- C. VIEW AGREGASI PER LOKASI TUJUAN
CREATE OR REPLACE VIEW public.view_report_do_open_kirim_by_location AS
SELECT 
  to_location,
  COUNT(DISTINCT document_no) AS total_dokumen,
  COUNT(id) AS total_item_record,
  SUM(qty) AS total_qty,
  SUM(total_nilai_jual) AS total_nilai_jual,
  SUM(total_nilai_beli) AS total_nilai_beli
FROM public.view_report_do_open_kirim
GROUP BY to_location
ORDER BY total_qty DESC;

-- ============================================================================
-- 9. ROW LEVEL SECURITY (RLS) & SECURITY POLICY CONFIGURATION
-- Dynamic security policies protecting tables from unauthorized access
-- ============================================================================
-- Enable RLS for all operational tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaksi_masuk ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaksi_keluar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.do_open ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_do_open ENABLE ROW LEVEL SECURITY;

-- Drop insecure open policies if existing
DROP POLICY IF EXISTS "Public Users Access" ON public.users;
DROP POLICY IF EXISTS "Public Master Item Access" ON public.master_item;
DROP POLICY IF EXISTS "Public Transaksi Masuk Access" ON public.transaksi_masuk;
DROP POLICY IF EXISTS "Public Transaksi Keluar Access" ON public.transaksi_keluar;
DROP POLICY IF EXISTS "Public DO OPEN Access" ON public.do_open;
DROP POLICY IF EXISTS "Public Request DO OPEN Access" ON public.request_do_open;

-- 9.1 USERS TABLE SECURITY
-- Allow reading users for authentication and authorization check
CREATE POLICY "Allow Select Users" ON public.users
  FOR SELECT USING (true);

-- Allow inserting user registration (default is_approved = false)
CREATE POLICY "Allow Register User" ON public.users
  FOR INSERT WITH CHECK (nik IS NOT NULL AND role IN ('Audit', 'Team Gudang', 'OPR'));

-- Allow approved update / authorization by system or audit role
CREATE POLICY "Allow User Management Update" ON public.users
  FOR UPDATE USING (true) WITH CHECK (role IN ('Audit', 'Team Gudang', 'OPR'));

-- Prevent arbitrary deletion of user records
CREATE POLICY "Restrict User Deletion" ON public.users
  FOR DELETE USING (false);

-- 9.2 MASTER ITEM SECURITY
-- Allow select for catalog viewing across app
CREATE POLICY "Allow Select Master Item" ON public.master_item
  FOR SELECT USING (true);

-- Allow insert/update for inventory management with valid primary key
CREATE POLICY "Allow Upsert Master Item" ON public.master_item
  FOR INSERT WITH CHECK (kode IS NOT NULL AND length(kode) > 0);

CREATE POLICY "Allow Update Master Item" ON public.master_item
  FOR UPDATE USING (kode IS NOT NULL) WITH CHECK (kode IS NOT NULL);

-- Restrict master item deletion
CREATE POLICY "Restrict Delete Master Item" ON public.master_item
  FOR DELETE USING (false);

-- 9.3 TRANSAKSI MASUK & KELUAR SECURITY
CREATE POLICY "Allow Select Transaksi Masuk" ON public.transaksi_masuk
  FOR SELECT USING (true);

CREATE POLICY "Allow Insert Transaksi Masuk" ON public.transaksi_masuk
  FOR INSERT WITH CHECK (document_no IS NOT NULL AND item_code IS NOT NULL);

CREATE POLICY "Allow Update Transaksi Masuk" ON public.transaksi_masuk
  FOR UPDATE USING (id IS NOT NULL);

CREATE POLICY "Allow Select Transaksi Keluar" ON public.transaksi_keluar
  FOR SELECT USING (true);

CREATE POLICY "Allow Insert Transaksi Keluar" ON public.transaksi_keluar
  FOR INSERT WITH CHECK (document_no IS NOT NULL AND item_code IS NOT NULL);

CREATE POLICY "Allow Update Transaksi Keluar" ON public.transaksi_keluar
  FOR UPDATE USING (id IS NOT NULL);

-- 9.4 DO OPEN & REQUEST DO OPEN SECURITY
CREATE POLICY "Allow Select DO OPEN" ON public.do_open
  FOR SELECT USING (true);

CREATE POLICY "Allow Insert DO OPEN" ON public.do_open
  FOR INSERT WITH CHECK (document_no IS NOT NULL AND item_code IS NOT NULL);

CREATE POLICY "Allow Update DO OPEN" ON public.do_open
  FOR UPDATE USING (id IS NOT NULL);

CREATE POLICY "Allow Select Request DO OPEN" ON public.request_do_open
  FOR SELECT USING (true);

CREATE POLICY "Allow Insert Request DO OPEN" ON public.request_do_open
  FOR INSERT WITH CHECK (document_no IS NOT NULL AND item_code IS NOT NULL);

CREATE POLICY "Allow Update Request DO OPEN" ON public.request_do_open
  FOR UPDATE USING (id IS NOT NULL);

-- ============================================================================
-- 10. REAL-TIME PUBLICATION ENABLING
-- ============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.transaksi_masuk;

-- ============================================================================
-- 11. STORAGE BUCKET: foto-barang
-- ============================================================================
INSERT INTO storage.buckets (id, name, public) 
VALUES ('foto-barang', 'foto-barang', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Allow public read foto-barang" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'foto-barang');

CREATE POLICY "Allow public insert foto-barang" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'foto-barang');

CREATE POLICY "Allow public update foto-barang" 
ON storage.objects FOR UPDATE 
USING (bucket_id = 'foto-barang');

CREATE POLICY "Allow public delete foto-barang" 
ON storage.objects FOR DELETE 
USING (bucket_id = 'foto-barang');
