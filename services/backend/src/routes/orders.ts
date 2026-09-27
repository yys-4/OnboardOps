import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { orderCounter, orderValueHistogram } from '../telemetry/metrics';
import type { Order, OrderItem, Product } from '../types';

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

// ── GET /api/orders ───────────────────────────────────────────────────────

ordersRouter.get('/', async (req, res, next) => {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const offset = (page - 1) * limit;

    // Admins see all orders; others see own
    const query = db('orders').orderBy('created_at', 'desc');
    if (req.user!.role !== 'admin') query.where({ user_id: req.user!.sub });

    const [{ count }] = await query.clone().count('* as count');
    const orders: Order[] = await query.limit(limit).offset(offset);

    res.json({
      data: orders,
      pagination: {
        page, limit,
        total: Number(count),
        totalPages: Math.ceil(Number(count) / limit),
      },
    });
  } catch (err) { next(err); }
});

// ── GET /api/orders/:id ───────────────────────────────────────────────────

ordersRouter.get('/:id', async (req, res, next) => {
  try {
    const order: Order = await db('orders').where({ id: req.params.id }).first();
    if (!order) throw new AppError(404, 'Order not found');
    if (req.user!.role !== 'admin' && order.user_id !== req.user!.sub) {
      throw new AppError(403, 'Access denied');
    }

    const items: (OrderItem & { product_name: string; product_sku: string })[] =
      await db('order_items as oi')
        .join('products as p', 'oi.product_id', 'p.id')
        .select('oi.*', 'p.name as product_name', 'p.sku as product_sku')
        .where({ 'oi.order_id': order.id });

    res.json({ data: { ...order, items } });
  } catch (err) { next(err); }
});

// ── POST /api/orders ──────────────────────────────────────────────────────

const createOrderSchema = z.object({
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).min(1),
  shipping_address: z.string().min(10),
  payment_method: z.enum(['card', 'bank_transfer', 'wallet']),
});

ordersRouter.post('/', async (req, res, next) => {
  try {
    const body = createOrderSchema.parse(req.body);

    // Validate products exist and have stock
    const productIds = body.items.map(i => i.product_id);
    const products: Product[] = await db('products')
      .whereIn('id', productIds)
      .where({ is_active: true });

    if (products.length !== productIds.length) {
      throw new AppError(422, 'One or more products not found or inactive');
    }

    // Calculate totals + check stock
    let totalAmount = 0;
    const orderItems = body.items.map(item => {
      const product = products.find(p => p.id === item.product_id)!;
      if (product.stock_quantity < item.quantity) {
        throw new AppError(422, `Insufficient stock for ${product.name}`);
      }
      const subtotal = Number(product.price) * item.quantity;
      totalAmount += subtotal;
      return { product_id: item.product_id, quantity: item.quantity, unit_price: Number(product.price), subtotal };
    });

    // Transactional insert
    const order: Order = await db.transaction(async (trx) => {
      const [created]: Order[] = await trx('orders').insert({
        user_id: req.user!.sub,
        status: 'pending',
        total_amount: totalAmount,
        shipping_address: body.shipping_address,
        payment_method: body.payment_method,
        payment_status: 'pending',
      }).returning('*');

      await trx('order_items').insert(
        orderItems.map(oi => ({ ...oi, order_id: created.id }))
      );

      // Decrement stock
      for (const item of body.items) {
        await trx('products')
          .where({ id: item.product_id })
          .decrement('stock_quantity', item.quantity);
      }

      return created;
    });

    // Record metrics
    orderCounter.add(1, { payment_method: body.payment_method });
    orderValueHistogram.record(totalAmount, { payment_method: body.payment_method });

    res.status(201).json({ data: order });
  } catch (err) { next(err); }
});

// ── PATCH /api/orders/:id/status ──────────────────────────────────────────

const updateStatusSchema = z.object({
  status: z.enum(['confirmed', 'processing', 'shipped', 'delivered', 'cancelled']),
});

ordersRouter.patch('/:id/status', async (req, res, next) => {
  try {
    if (req.user!.role === 'viewer') throw new AppError(403, 'Viewers cannot update orders');
    const { status } = updateStatusSchema.parse(req.body);

    const order: Order = await db('orders').where({ id: req.params.id }).first();
    if (!order) throw new AppError(404, 'Order not found');

    const [updated]: Order[] = await db('orders')
      .where({ id: req.params.id })
      .update({ status, updated_at: new Date() })
      .returning('*');

    res.json({ data: updated });
  } catch (err) { next(err); }
});
