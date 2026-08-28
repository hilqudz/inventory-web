/* =====================================================================
   LoginAttempts — jejak setiap percobaan login (sukses maupun gagal),
   dipakai untuk deteksi brute-force / pola serangan (menu "Keamanan" khusus
   Admin). Sebelumnya rate-limit login cuma di memori (hilang tiap restart
   PM2, tidak ada histori) — tabel ini kasih visibilitas persisten.
   ===================================================================== */

CREATE TABLE LoginAttempts (
    Id           BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Nik          NVARCHAR(50)   NULL,      -- NIK yang dicoba (bisa NIK yang tidak ada)
    IpAddress    NVARCHAR(100)  NULL,
    Success      BIT            NOT NULL,
    FailReason   NVARCHAR(100)  NULL,      -- 'user_not_found' | 'wrong_password' | 'not_approved'
    AttemptedAt  DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_LoginAttempts_AttemptedAt ON LoginAttempts(AttemptedAt);
CREATE INDEX IX_LoginAttempts_IpAddress ON LoginAttempts(IpAddress);
GO
