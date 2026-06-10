import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

interface TokenPayload {
  sub: 'admin';
  exp: number;
}

export function createAdminToken(): string {
  const payload: TokenPayload = {
    sub: 'admin',
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign(body);
  return `${body}.${sig}`;
}

export function verifyAdminToken(token: string): boolean {
  const [body, sig] = token.split('.');
  if (!body || !sig) return false;
  if (!safeEqual(sig, sign(body))) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    return payload.sub === 'admin' && payload.exp > Date.now();
  } catch {
    return false;
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !verifyAdminToken(token)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

export function isValidAdminPassword(password: unknown): boolean {
  const configured = process.env.ADMIN_PASSWORD || '';
  if (!configured || configured === 'change_me') return false;
  if (typeof password !== 'string') return false;
  return safeEqual(password, configured);
}

function sign(value: string): string {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('ADMIN_JWT_SECRET must be set and at least 32 characters');
  }
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
