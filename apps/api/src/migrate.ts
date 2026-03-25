import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(): Promise<void> {
  const sqlPath = path.join(__dirname, '..', 'sql', 'init.sql');
  const sql = fs.readFileSync(sqlPath, 'utf-8');

  // Retry up to 10 times with 3s delay — DB may not be ready immediately on cold start
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await pool.query(sql);
      console.log('Migrations applied successfully');
      return;
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      const isTransient = code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === '57P03';
      if (isTransient && attempt < 10) {
        console.log(`Migration attempt ${attempt} failed (DB not ready), retrying in 3s...`);
        await new Promise((r) => setTimeout(r, 3000));
      } else {
        console.error('Migration failed:', err);
        throw err;
      }
    }
  }
}
