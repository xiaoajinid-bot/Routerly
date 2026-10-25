import { attachDatabasePool } from '@vercel/functions';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { UsageRecord, UsageRetentionConfig } from '@routerly/shared';
import * as schema from './schema.js';
import { isVercelRuntime } from './storage-mode.js';

const { routerlyState } = schema;
const CONFIG_KIND = 'config' as const;
const USAGE_KIND = 'usage' as const;
const USAGE_KEY = '';
const CONFIG_SEQUENCE = 0;
const INSERT_BATCH_SIZE = 500;
const DELETE_BATCH_SIZE = 1000;

type Database = NodePgDatabase<typeof schema>;
type UsageRow = { seq: number; payload: unknown; byteSize: number };

let database: Database | undefined;

function getDatabase(): Database {
  if (database) return database;
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL is required when Postgres storage is enabled');
  }

  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
  });
  if (isVercelRuntime()) attachDatabasePool(pool);
  database = drizzle(pool, { schema });
  return database;
}

function configWhere(key: string) {
  return and(
    eq(routerlyState.kind, CONFIG_KIND),
    eq(routerlyState.key, key),
    eq(routerlyState.seq, CONFIG_SEQUENCE),
  );
}

function configValues(key: string, payload: unknown) {
  return {
    kind: CONFIG_KIND,
    key,
    seq: CONFIG_SEQUENCE,
    payload,
    eventTimestamp: null,
    byteSize: 0,
  };
}

function usageValues(record: UsageRecord) {
  const eventDate = new Date(record.timestamp);
  return {
    kind: USAGE_KIND,
    key: USAGE_KEY,
    payload: record,
    eventTimestamp: Number.isNaN(eventDate.getTime()) ? null : eventDate,
    byteSize: Buffer.byteLength(JSON.stringify(record), 'utf-8') + 1,
  };
}

async function lockConfig(tx: Parameters<Parameters<Database['transaction']>[0]>[0], key: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'routerly:config:' + key}, 0))`);
}

async function lockUsage(tx: Parameters<Parameters<Database['transaction']>[0]>[0]): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('routerly:usage', 0))`);
}

export async function readConfigRow<T>(key: string, defaultValue: T): Promise<T> {
  const db = getDatabase();
  const [existing] = await db
    .select({ payload: routerlyState.payload })
    .from(routerlyState)
    .where(configWhere(key))
    .limit(1);
  if (existing) return existing.payload as T;

  return db.transaction(async (tx) => {
    await lockConfig(tx, key);
    const [row] = await tx
      .select({ payload: routerlyState.payload })
      .from(routerlyState)
      .where(configWhere(key))
      .limit(1)
      .for('update');
    if (row) return row.payload as T;

    await tx.insert(routerlyState).values(configValues(key, defaultValue)).onConflictDoNothing();
    return defaultValue;
  });
}

export async function writeConfigRow<T>(key: string, payload: T): Promise<void> {
  const db = getDatabase();
  await db.transaction(async (tx) => {
    await lockConfig(tx, key);
    await tx
      .insert(routerlyState)
      .values(configValues(key, payload))
      .onConflictDoUpdate({
        target: [routerlyState.kind, routerlyState.key, routerlyState.seq],
        set: { payload, eventTimestamp: null, byteSize: 0 },
      });
  });
}

export async function updateConfigRow<T>(
  key: string,
  defaultValue: T,
  mutate: (current: T) => T | Promise<T>,
): Promise<T> {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    await lockConfig(tx, key);
    const [row] = await tx
      .select({ payload: routerlyState.payload })
      .from(routerlyState)
      .where(configWhere(key))
      .limit(1)
      .for('update');
    const current = row ? (row.payload as T) : defaultValue;
    if (!row) {
      await tx.insert(routerlyState).values(configValues(key, defaultValue)).onConflictDoNothing();
    }

    const next = await mutate(current);
    if (next !== current) {
      await tx
        .insert(routerlyState)
        .values(configValues(key, next))
        .onConflictDoUpdate({
          target: [routerlyState.kind, routerlyState.key, routerlyState.seq],
          set: { payload: next, eventTimestamp: null, byteSize: 0 },
        });
    }
    return next;
  });
}

export async function readUsageRows(): Promise<UsageRecord[]> {
  const rows = await getDatabase()
    .select({ payload: routerlyState.payload })
    .from(routerlyState)
    .where(and(eq(routerlyState.kind, USAGE_KIND), eq(routerlyState.key, USAGE_KEY)))
    .orderBy(asc(routerlyState.seq));
  return rows.map((row) => row.payload as UsageRecord);
}

export async function writeUsageRows(records: UsageRecord[]): Promise<void> {
  const db = getDatabase();
  await db.transaction(async (tx) => {
    await lockUsage(tx);
    await tx
      .delete(routerlyState)
      .where(and(eq(routerlyState.kind, USAGE_KIND), eq(routerlyState.key, USAGE_KEY)));

    const values = records.map(usageValues);
    for (let offset = 0; offset < values.length; offset += INSERT_BATCH_SIZE) {
      await tx.insert(routerlyState).values(values.slice(offset, offset + INSERT_BATCH_SIZE));
    }
  });
}

export async function appendUsageRows(records: UsageRecord[]): Promise<void> {
  if (records.length === 0) return;
  const db = getDatabase();
  await db.transaction(async (tx) => {
    await lockUsage(tx);
    const values = records.map(usageValues);
    for (let offset = 0; offset < values.length; offset += INSERT_BATCH_SIZE) {
      await tx.insert(routerlyState).values(values.slice(offset, offset + INSERT_BATCH_SIZE));
    }
  });
}

export async function applyUsageRetentionRows(policy: UsageRetentionConfig): Promise<number> {
  if (!policy.maxAgeDays && !policy.maxSizeMb) return 0;
  const db = getDatabase();
  return db.transaction(async (tx) => {
    await lockUsage(tx);
    const rows: UsageRow[] = await tx
      .select({ seq: routerlyState.seq, payload: routerlyState.payload, byteSize: routerlyState.byteSize })
      .from(routerlyState)
      .where(and(eq(routerlyState.kind, USAGE_KIND), eq(routerlyState.key, USAGE_KEY)))
      .orderBy(asc(routerlyState.seq));

    let kept = rows;
    if (policy.maxAgeDays) {
      const cutoff = Date.now() - policy.maxAgeDays * 24 * 60 * 60 * 1000;
      kept = kept.filter((row) => new Date((row.payload as UsageRecord).timestamp).getTime() >= cutoff);
    }

    if (policy.maxSizeMb) {
      const maxBytes = policy.maxSizeMb * 1024 * 1024;
      const byteSize = (row: UsageRow) =>
        row.byteSize > 0 ? row.byteSize : Buffer.byteLength(JSON.stringify(row.payload), 'utf-8') + 1;
      let totalBytes = kept.reduce((sum, row) => sum + byteSize(row), 0);
      let start = 0;
      while (totalBytes > maxBytes && start < kept.length) {
        totalBytes -= byteSize(kept[start]!);
        start++;
      }
      kept = kept.slice(start);
    }

    const retainedSequences = new Set(kept.map((row) => row.seq));
    const removedSequences = rows.filter((row) => !retainedSequences.has(row.seq)).map((row) => row.seq);
    for (let offset = 0; offset < removedSequences.length; offset += DELETE_BATCH_SIZE) {
      const batch = removedSequences.slice(offset, offset + DELETE_BATCH_SIZE);
      await tx
        .delete(routerlyState)
        .where(and(
          eq(routerlyState.kind, USAGE_KIND),
          eq(routerlyState.key, USAGE_KEY),
          inArray(routerlyState.seq, batch),
        ));
    }
    return removedSequences.length;
  });
}

export async function pruneOrphanUsageRows(validRouterIds: ReadonlySet<string>): Promise<number> {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    await lockUsage(tx);
    const rows: UsageRow[] = await tx
      .select({ seq: routerlyState.seq, payload: routerlyState.payload, byteSize: routerlyState.byteSize })
      .from(routerlyState)
      .where(and(eq(routerlyState.kind, USAGE_KIND), eq(routerlyState.key, USAGE_KEY)))
      .orderBy(asc(routerlyState.seq));
    const removedSequences = rows
      .filter((row) => !validRouterIds.has((row.payload as UsageRecord).routerId))
      .map((row) => row.seq);

    for (let offset = 0; offset < removedSequences.length; offset += DELETE_BATCH_SIZE) {
      const batch = removedSequences.slice(offset, offset + DELETE_BATCH_SIZE);
      await tx
        .delete(routerlyState)
        .where(and(
          eq(routerlyState.kind, USAGE_KIND),
          eq(routerlyState.key, USAGE_KEY),
          inArray(routerlyState.seq, batch),
        ));
    }
    return removedSequences.length;
  });
}
