import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { readConfig, pruneOrphanUsage } from '../config/loader.js';
import { applyUsageRetention } from '../config/usageNdjson.js';

export interface MaintenanceResult {
  usageRecordsPruned: number;
  orphanUsageRecordsPruned: number;
}

export type MaintenanceRunner = () => Promise<MaintenanceResult>;

const authorizationSchema = z.string().regex(/^Bearer [0-9a-f]{64}$/i);
const secretSchema = z.string().regex(/^[0-9a-f]{64}$/i);

export function isAuthorizedCronRequest(
  authorization: string | undefined,
  secret: string | undefined,
): boolean {
  if (!authorization || !secret || !secretSchema.safeParse(secret).success) return false;
  const parsed = authorizationSchema.safeParse(authorization);
  if (!parsed.success) return false;

  const expected = Buffer.from(`Bearer ${secret}`, 'utf-8');
  const received = Buffer.from(parsed.data, 'utf-8');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function runScheduledMaintenance(): Promise<MaintenanceResult> {
  const settings = await readConfig('settings');
  const usageRecordsPruned = settings.usageRetention
    ? await applyUsageRetention(settings.usageRetention)
    : 0;
  const orphanUsageRecordsPruned = await pruneOrphanUsage();
  return { usageRecordsPruned, orphanUsageRecordsPruned };
}

export function createCronRoutes(
  runMaintenance: MaintenanceRunner = runScheduledMaintenance,
): FastifyPluginAsync {
  return async (fastify) => {
    fastify.get('/api/cron/maintenance', async (request, reply) => {
      const secret = process.env['CRON_SECRET'] || process.env['ROUTERLY_CRON_SECRET'];
      if (!isAuthorizedCronRequest(request.headers.authorization, secret)) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      return runMaintenance();
    });
  };
}
