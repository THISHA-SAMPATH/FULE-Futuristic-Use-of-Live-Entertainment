import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to apply PostgreSQL migrations.');
const { closeIncidentStore } = await import('../services/incidentStore.js');
await closeIncidentStore();
process.stdout.write('Knex migrations are up to date.\n');
