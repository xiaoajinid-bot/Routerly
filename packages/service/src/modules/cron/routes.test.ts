import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCronRoutes, type MaintenanceResult } from './routes.js';

const secret = 'a'.repeat(64);
const result: MaintenanceResult = { usageRecordsPruned: 2, orphanUsageRecordsPruned: 1 };

async function requestMaintenance(authorization?: string, run = vi.fn().mockResolvedValue(result)) {
  const app = Fastify();
  await app.register(createCronRoutes(run));
  const response = await app.inject({
    method: 'GET',
    url: '/api/cron/maintenance',
    ...(authorization ? { headers: { authorization } } : {}),
  });
  await app.close();
  return { response, run };
}

afterEach(() => vi.unstubAllEnvs());

describe('Vercel Cron maintenance route', () => {
  it('runs maintenance only for the configured bearer secret', async () => {
    vi.stubEnv('CRON_SECRET', secret);
    const { response, run } = await requestMaintenance(`Bearer ${secret}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect(run).toHaveBeenCalledOnce();
  });

  it('rejects a malformed or incorrect bearer secret without running maintenance', async () => {
    vi.stubEnv('CRON_SECRET', secret);
    const { response, run } = await requestMaintenance('Bearer not-a-secret');

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'forbidden' });
    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed when no cron secret is configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('ROUTERLY_CRON_SECRET', '');
    const { response, run } = await requestMaintenance(`Bearer ${secret}`);

    expect(response.statusCode).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });
});
