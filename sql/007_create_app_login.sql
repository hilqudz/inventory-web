/* =====================================================================
   Login SQL Server khusus aplikasi (least-privilege), pengganti 'sa'
   untuk koneksi API sehari-hari — keputusan Fase 1 di CLAUDE.md.

   Password di-generate acak, DIGANTI di baris @Password di bawah sebelum
   dijalankan (jangan commit password asli ke git — file ini aman di-commit
   karena placeholder-nya generik, tapi versi yang dieksekusi di server
   punya password asli hanya di memori psql session, tidak tersimpan).
   ===================================================================== */

USE master;
GO

IF NOT EXISTS (SELECT 1 FROM sys.sql_logins WHERE name = 'app_inventory_user')
BEGIN
    CREATE LOGIN app_inventory_user WITH PASSWORD = '__REPLACE_WITH_STRONG_PASSWORD__';
END
GO

USE InventoryGudang;
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'app_inventory_user')
BEGIN
    CREATE USER app_inventory_user FOR LOGIN app_inventory_user;
END
GO

-- Least privilege: baca/tulis data, TANPA hak DDL (buat/hapus tabel) atau db_owner
ALTER ROLE db_datareader ADD MEMBER app_inventory_user;
ALTER ROLE db_datawriter ADD MEMBER app_inventory_user;
GO

-- Wajib untuk endpoint login (stored procedure usp_GetUserForLogin)
GRANT EXECUTE ON dbo.usp_GetUserForLogin TO app_inventory_user;
GO
