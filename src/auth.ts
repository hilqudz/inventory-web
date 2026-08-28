import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "";
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET belum di-set di .env — wajib diisi sebelum server jalan.");
}

const TOKEN_EXPIRY = "12h";

export interface AuthTokenPayload {
  nik: string;
  role: string;
  displayName: string;
}

export interface AuthedRequest extends Request {
  user?: AuthTokenPayload;
}

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

// Middleware: wajib login (Bearer token) — dipakai semua endpoint kecuali /api/auth/login
export function authRequired(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Token tidak ditemukan. Login dulu." });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
    next();
  } catch {
    return res.status(401).json({ error: "Token tidak valid atau kedaluwarsa." });
  }
}

// Middleware: batasi ke role tertentu — dipasang SETELAH authRequired
export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Belum login." });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Role kamu tidak punya akses ke resource ini." });
    }
    next();
  };
}

/* Rate limiter sederhana in-memory untuk /api/auth/login (cegah brute force).
   Cukup untuk 4 user internal; kalau nanti dipakai ~500 user, pertimbangkan
   express-rate-limit + store eksternal. */
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function loginRateLimit(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    return res.status(429).json({ error: "Terlalu banyak percobaan login. Coba lagi 15 menit lagi." });
  }
  next();
}
