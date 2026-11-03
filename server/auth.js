import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from './db.js';

const scrypt = promisify(scryptCallback);
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function authSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error('AUTH_SECRET must contain at least 32 bytes.');
  return secret;
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) {
    throw new Error('Password must be between 12 and 200 characters.');
  }
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${Buffer.from(hash).toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!/^[a-f0-9]{32}$/.test(saltHex || '') || !/^[a-f0-9]{128}$/.test(hashHex || '')) return false;
  const candidate = Buffer.from(await scrypt(password, Buffer.from(saltHex, 'hex'), 64));
  return timingSafeEqual(candidate, Buffer.from(hashHex, 'hex'));
}

function issueToken(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  })).toString('base64url');
  const signature = createHmac('sha256', authSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export async function authenticateRequest(request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', authSecret()).update(payload).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!claims.sub || !Number.isInteger(claims.exp) || claims.exp <= Date.now() / 1000) return null;
    const result = await pool.query('SELECT id, email, role FROM app_users WHERE id = $1', [claims.sub]);
    return result.rows[0] || null;
  } catch {
    return null;
  }
}

export async function login(emailInput, password) {
  const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase() : '';
  if (!email || typeof password !== 'string') throw new Error('Email and password are required.');
  const result = await pool.query('SELECT id, email, role, password_hash FROM app_users WHERE email = $1', [email]);
  const user = result.rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw Object.assign(new Error('Invalid email or password.'), { status: 401 });
  }
  return { access_token: issueToken(user), user: { id: user.id, email: user.email, role: user.role } };
}