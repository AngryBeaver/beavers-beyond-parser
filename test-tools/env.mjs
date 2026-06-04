/**
 * Loads .env from the same directory as this file into process.env.
 * Import this as the first statement in any script that needs credentials.
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(dir, '.env');

if (!existsSync(envPath)) {
  console.error(`ERROR: .env not found at ${envPath}`);
  console.error('Copy .env.example to .env and fill in your credentials.');
  process.exit(1);
}

for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq < 0) continue;
  const key = t.slice(0, eq).trim();
  const val = t.slice(eq + 1).trim();
  if (key) process.env[key] = val;
}
