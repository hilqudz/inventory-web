import sql from "mssql";
import dotenv from "dotenv";

dotenv.config();

// Koneksi via SSH tunnel: DB_HOST=localhost (lihat CLAUDE.md — port 1433 tidak pernah publik)
const config: sql.config = {
  server: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME || "InventoryGudang",
  user: process.env.DB_USER || "",
  password: process.env.DB_PASSWORD || "",
  options: {
    encrypt: process.env.DB_ENCRYPT !== "false",
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== "false",
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
  requestTimeout: 30000,
  connectionTimeout: 15000,
};

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .catch((err) => {
        // Reset supaya request berikutnya coba connect ulang (misal tunnel SSH sempat putus)
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

export { sql };
