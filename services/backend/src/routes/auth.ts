import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../db/client';
import { env } from '../config/env';
import { AppError } from '../middleware/error-handler';
import { requireAuth } from '../middleware/auth';
import type { AuthTokens, User } from '../types';

export const authRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────

function issueTokens(user: User): AuthTokens {
  const accessToken = jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
  );
  const refreshToken = crypto.randomBytes(40).toString('hex');
  return { accessToken, refreshToken, expiresIn: 900 };
}

// ── POST /api/auth/register ───────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(255),
});

authRouter.post('/register', async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    const existing = await db('users').where({ email: body.email }).first();
    if (existing) throw new AppError(409, 'Email already registered', 'EMAIL_EXISTS');

    const password_hash = await bcrypt.hash(body.password, 12);
    const [user]: User[] = await db('users')
      .insert({ email: body.email, password_hash, name: body.name })
      .returning('*');

    const tokens = issueTokens(user);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db('refresh_tokens').insert({
      user_id: user.id,
      token_hash: crypto.createHash('sha256').update(tokens.refreshToken).digest('hex'),
      expires_at: expiresAt,
    });

    res.status(201).json({ data: { user: { id: user.id, email: user.email, name: user.name }, tokens } });
  } catch (err) { next(err); }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const user: User = await db('users').where({ email: body.email, is_active: true }).first();
    if (!user) throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');

    const valid = await bcrypt.compare(body.password, (user as any).password_hash);
    if (!valid) throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');

    const tokens = issueTokens(user);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db('refresh_tokens').insert({
      user_id: user.id,
      token_hash: crypto.createHash('sha256').update(tokens.refreshToken).digest('hex'),
      expires_at: expiresAt,
    });

    res.json({ data: { user: { id: user.id, email: user.email, name: user.name, role: user.role }, tokens } });
  } catch (err) { next(err); }
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    const stored = await db('refresh_tokens')
      .where({ token_hash: tokenHash, revoked: false })
      .where('expires_at', '>', new Date())
      .first();

    if (!stored) throw new AppError(401, 'Invalid or expired refresh token', 'INVALID_REFRESH');

    const user: User = await db('users').where({ id: stored.user_id }).first();
    if (!user || !user.is_active) throw new AppError(401, 'User not found', 'USER_INACTIVE');

    // Rotate: revoke old, issue new
    await db('refresh_tokens').where({ id: stored.id }).update({ revoked: true });

    const tokens = issueTokens(user);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db('refresh_tokens').insert({
      user_id: user.id,
      token_hash: crypto.createHash('sha256').update(tokens.refreshToken).digest('hex'),
      expires_at: expiresAt,
    });

    res.json({ data: { tokens } });
  } catch (err) { next(err); }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────

authRouter.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await db('refresh_tokens').where({ user_id: req.user!.sub }).update({ revoked: true });
    res.json({ data: { message: 'Logged out successfully' } });
  } catch (err) { next(err); }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await db('users')
      .select('id', 'email', 'name', 'role', 'created_at')
      .where({ id: req.user!.sub })
      .first();
    if (!user) throw new AppError(404, 'User not found');
    res.json({ data: { user } });
  } catch (err) { next(err); }
});
