import { sql } from 'drizzle-orm';
import { bigint, check, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const routerlyState = pgTable(
  'routerly_state',
  {
    kind: text('kind').$type<'config' | 'usage'>().notNull(),
    key: text('key').notNull().default(''),
    seq: bigint('seq', { mode: 'number' }).generatedByDefaultAsIdentity().notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    eventTimestamp: timestamp('event_timestamp', { withTimezone: true, mode: 'date' }),
    byteSize: integer('byte_size').notNull().default(0),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: 'routerly_state_pkey',
      columns: [table.kind, table.key, table.seq],
    }),
    kindCheck: check('routerly_state_kind_check', sql`${table.kind} IN ('config', 'usage')`),
    shapeCheck: check(
      'routerly_state_shape_check',
      sql`(
        (${table.kind} = 'config' AND ${table.key} <> '' AND ${table.seq} = 0 AND ${table.eventTimestamp} IS NULL AND ${table.byteSize} = 0)
        OR (${table.kind} = 'usage' AND ${table.key} = '' AND ${table.seq} > 0 AND ${table.byteSize} >= 0)
      )`,
    ),
  }),
);
