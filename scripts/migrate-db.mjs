/**
 * Apply db/schema.sql to DATABASE_URL.
 * Usage: DATABASE_URL=... npm run db:migrate
 * Or with .env.local loaded via dotenv-free read of process.env
 * (Next loads .env.local for the app; for this script set DATABASE_URL explicitly
 *  or place it in the environment).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(root, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* no .env.local */
  }
}

loadEnvLocal();

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error(
    'DATABASE_URL が未設定です。.env.local か環境変数に設定してください。\n' +
      '例: postgresql://minutes_user:minutes_pass@127.0.0.1:5432/minutes_db'
  );
  process.exit(1);
}

const schemaPath = join(root, 'db', 'schema.sql');
const sql = readFileSync(schemaPath, 'utf8');

const client = new Client({ connectionString: url });
try {
  await client.connect();
  await client.query(sql);
  console.log('migrate ok:', schemaPath);
} catch (err) {
  console.error('migrate failed:', err);
  process.exit(1);
} finally {
  await client.end();
}
