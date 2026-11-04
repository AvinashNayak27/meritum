import 'dotenv/config';

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPool } from '../lib/database.js';

const migrationsDirectory = fileURLToPath(new URL('./migrations/', import.meta.url));
const lockName = 'meritum-schema-migrations';

export async function migrateDatabase() {
  const pool = getPool();
  await pool.query(
    `create table if not exists meritum_schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )`,
  );

  const files = (await readdir(migrationsDirectory)).filter((filename) => /^\d+_.+\.sql$/.test(filename)).sort();

  for (const filename of files) {
    const sql = await readFile(path.join(migrationsDirectory, filename), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [lockName]);
      const applied = await client.query('select 1 from meritum_schema_migrations where filename = $1', [filename]);
      if (!applied.rowCount) {
        await client.query(sql);
        await client.query('insert into meritum_schema_migrations (filename) values ($1)', [filename]);
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw new Error(`Database migration ${filename} failed: ${String(error)}`, { cause: error });
    } finally {
      client.release();
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrateDatabase()
    .then(() => console.log('Database migrations are up to date.'))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => {
      if (process.env.DATABASE_URL) void getPool().end();
    });
}
