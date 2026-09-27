import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { requireAuth, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import type { Product } from '../types';

export const productsRouter = Router();

// ── GET /api/products ─────────────────────────────────────────────────────

productsRouter.get('/', async (req, res, next) => {
  try {
    const category = req.query.category as string | undefined;
    const query = db('products').where({ is_active: true }).orderBy('name');
    if (category) query.where({ category });

    const products: Product[] = await query;
    res.json({ data: products });
  } catch (err) { next(err); }
});

// ── GET /api/products/:id ─────────────────────────────────────────────────

productsRouter.get('/:id', async (req, res, next) => {
  try {
    const product = await db('products')
      .where({ id: req.params.id, is_active: true })
      .first();
    if (!product) throw new AppError(404, 'Product not found');
    res.json({ data: product });
  } catch (err) { next(err); }
});

// ── POST /api/products (admin only) ──────────────────────────────────────

const productSchema = z.object({
  sku: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  price: z.number().positive(),
  stock_quantity: z.number().int().nonnegative().default(0),
  category: z.string().optional(),
});

productsRouter.post('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const body = productSchema.parse(req.body);
    const existing = await db('products').where({ sku: body.sku }).first();
    if (existing) throw new AppError(409, 'SKU already exists', 'DUPLICATE_SKU');

    const [product]: Product[] = await db('products').insert(body).returning('*');
    res.status(201).json({ data: product });
  } catch (err) { next(err); }
});

// ── PATCH /api/products/:id (admin only) ──────────────────────────────────

productsRouter.patch('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const body = productSchema.partial().parse(req.body);
    const [updated]: Product[] = await db('products')
      .where({ id: req.params.id })
      .update({ ...body, updated_at: new Date() })
      .returning('*');
    if (!updated) throw new AppError(404, 'Product not found');
    res.json({ data: updated });
  } catch (err) { next(err); }
});
