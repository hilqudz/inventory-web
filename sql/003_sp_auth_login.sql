/* =====================================================================
   AUTH — Stored procedure login (lihat CLAUDE.md poin 3 Security Requirements)

   Catatan desain: bcrypt TIDAK bisa dihitung di T-SQL, jadi pembagian
   tanggung jawabnya:
     - SP ini: satu-satunya jalur baca kredensial user untuk login
       (mengembalikan PasswordHash HANYA untuk dibandingkan di API,
       tidak pernah diteruskan ke response client).
     - API (server.ts): bcrypt.compare(password_input, PasswordHash).

   Jalankan file ini di database InventoryGudang.
   ===================================================================== */

CREATE OR ALTER PROCEDURE dbo.usp_GetUserForLogin
    @Nik NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP 1
        Nik,
        NamaLengkap,
        PasswordHash,
        Role,
        IsApproved,
        CreatedAt,
        ApprovedBy,
        ApprovedAt
    FROM dbo.Users
    WHERE Nik = LOWER(LTRIM(RTRIM(@Nik)));
END
GO
