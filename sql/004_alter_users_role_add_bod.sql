/* =====================================================================
   Tambah role 'BOD' ke CHECK constraint Users.

   Konteks: frontend lama (App.tsx, LoginView, UserManagementView) aktif
   memakai role 'BOD' (akses baca penuh termasuk harga beli, tanpa hak
   tulis), tapi DDL 001 hanya mengizinkan Admin/Audit/Team Gudang/OPR.
   Keputusan (Agustus 2026): 5 role — Admin, Audit, Team Gudang, OPR, BOD.
   - BOD  : baca penuh (termasuk hargaBeli), TANPA hak tulis.
   - Admin: role tertinggi (delete, user management) — baru di versi
            SQL Server, belum ada di frontend lama (ditambah di Fase 5).
   ===================================================================== */

ALTER TABLE dbo.Users DROP CONSTRAINT CK_Users_Role;
GO

ALTER TABLE dbo.Users ADD CONSTRAINT CK_Users_Role
    CHECK (Role IN ('Audit', 'Team Gudang', 'OPR', 'Admin', 'BOD'));
GO
