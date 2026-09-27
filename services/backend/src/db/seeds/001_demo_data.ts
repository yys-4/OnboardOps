import type { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  // Clear in FK order
  await knex('order_items').del();
  await knex('orders').del();
  await knex('refresh_tokens').del();
  await knex('products').del();
  await knex('users').del();

  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.hash('password123', 10);

  const [admin] = await knex('users').insert({
    email: 'admin@onboardops.dev',
    password_hash: hash,
    name: 'Admin User',
    role: 'admin',
  }).returning('*');

  const [dev1] = await knex('users').insert({
    email: 'alice@onboardops.dev',
    password_hash: hash,
    name: 'Alice Engineer',
    role: 'developer',
  }).returning('*');

  const products = await knex('products').insert([
    { sku: 'SVC-001', name: 'Starter Plan', description: 'Basic SaaS tier', price: 29.00, stock_quantity: 9999, category: 'subscription' },
    { sku: 'SVC-002', name: 'Pro Plan', description: 'Professional SaaS tier', price: 99.00, stock_quantity: 9999, category: 'subscription' },
    { sku: 'SVC-003', name: 'Enterprise Plan', description: 'Enterprise SaaS tier', price: 499.00, stock_quantity: 9999, category: 'subscription' },
    { sku: 'ADD-001', name: 'Extra Seats (10)', description: '10 additional seats', price: 50.00, stock_quantity: 9999, category: 'addon' },
    { sku: 'ADD-002', name: 'Priority Support', description: '24/7 priority support', price: 199.00, stock_quantity: 9999, category: 'addon' },
  ]).returning('*');

  // Seed some realistic orders
  const [order1] = await knex('orders').insert({
    user_id: dev1.id,
    status: 'delivered',
    total_amount: 99.00,
    shipping_address: '123 Main St, San Francisco, CA 94102',
    payment_method: 'card',
    payment_status: 'paid',
    external_payment_id: 'pi_seed_001',
  }).returning('*');

  await knex('order_items').insert({
    order_id: order1.id,
    product_id: products[1].id,
    quantity: 1,
    unit_price: 99.00,
    subtotal: 99.00,
  });
}
