import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import knexFactory from 'knex';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
if (!process.env.DATABASE_URL || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) throw new Error('Set DATABASE_URL, ADMIN_EMAIL, and ADMIN_PASSWORD in backend/.env.');
if (process.env.ADMIN_PASSWORD.length < 16) throw new Error('ADMIN_PASSWORD must be at least 16 characters.');
const db = knexFactory({ client: 'pg', connection: process.env.DATABASE_URL, migrations: { directory: fileURLToPath(new URL('../migrations/', import.meta.url)), extension: 'mjs', loadExtensions: ['.mjs'] } });
try {
  await db.migrate.latest();
  const account = { account_id: `acct-${randomBytes(16).toString('hex')}`, email: process.env.ADMIN_EMAIL.trim().toLowerCase(), password_hash: await bcrypt.hash(process.env.ADMIN_PASSWORD, 12), role: 'admin', guardian_approved: true };
  await db('accounts').insert(account).onConflict('email').ignore();
  process.stdout.write(`Admin account ensured for ${account.email}.\n`);
} finally { await db.destroy(); }
