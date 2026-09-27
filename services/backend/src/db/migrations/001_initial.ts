import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Users
  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('email', 255).notNullable().unique();
    t.string('password_hash', 255).notNullable();
    t.string('name', 255).notNullable();
    t.enum('role', ['admin', 'developer', 'viewer']).defaultTo('developer');
    t.boolean('is_active').defaultTo(true);
    t.timestamps(true, true);
  });

  // Products
  await knex.schema.createTable('products', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('sku', 100).notNullable().unique();
    t.string('name', 255).notNullable();
    t.text('description');
    t.decimal('price', 12, 2).notNullable();
    t.integer('stock_quantity').defaultTo(0);
    t.string('category', 100);
    t.boolean('is_active').defaultTo(true);
    t.timestamps(true, true);
  });

  // Orders
  await knex.schema.createTable('orders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.enum('status', ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'])
      .defaultTo('pending');
    t.decimal('total_amount', 12, 2).notNullable();
    t.string('shipping_address', 500);
    t.string('payment_method', 50);
    t.string('payment_status', 50).defaultTo('pending');
    t.string('external_payment_id', 255);
    t.jsonb('metadata').defaultTo('{}');
    t.timestamps(true, true);
  });

  // Order items
  await knex.schema.createTable('order_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE');
    t.uuid('product_id').notNullable().references('id').inTable('products').onDelete('RESTRICT');
    t.integer('quantity').notNullable();
    t.decimal('unit_price', 12, 2).notNullable();
    t.decimal('subtotal', 12, 2).notNullable();
  });

  // Refresh tokens
  await knex.schema.createTable('refresh_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash', 255).notNullable().unique();
    t.boolean('revoked').defaultTo(false);
    t.timestamp('expires_at').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Indexes
  await knex.schema.alterTable('orders', (t) => {
    t.index(['user_id', 'status']);
    t.index(['created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('order_items');
  await knex.schema.dropTableIfExists('orders');
  await knex.schema.dropTableIfExists('refresh_tokens');
  await knex.schema.dropTableIfExists('products');
  await knex.schema.dropTableIfExists('users');
}
