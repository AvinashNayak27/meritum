// @ts-nocheck
import pg from 'pg';

let pool;

export function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return pool;
}

export async function transaction(work) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
