import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  readUsageRows: vi.fn(),
  writeUsageRows: vi.fn(),
  appendUsageRows: vi.fn(),
  applyUsageRetentionRows: vi.fn(),
}));

vi.mock('./storage-mode.js', () => ({ usesPostgresStorage: () => true }));
vi.mock('./postgres-store.js', () => store);

const {
  readUsageNdjson,
  writeUsageNdjson,
  appendUsageRecordsNdjson,
  applyUsageRetention,
} = await import('./usageNdjson.js');

beforeEach(() => vi.clearAllMocks());

describe('Postgres usage dispatch', () => {
  it('reads records from the database adapter', async () => {
    const records = [{ id: 'usage-1' }];
    store.readUsageRows.mockResolvedValue(records);

    await expect(readUsageNdjson()).resolves.toEqual(records);
    expect(store.readUsageRows).toHaveBeenCalledOnce();
  });

  it('replaces records through the database adapter', async () => {
    const records = [{ id: 'usage-1' }];

    await writeUsageNdjson(records as never);

    expect(store.writeUsageRows).toHaveBeenCalledWith(records);
  });

  it('appends records through the database adapter without reading history', async () => {
    const records = [{ id: 'usage-1' }];

    await appendUsageRecordsNdjson(records as never);

    expect(store.appendUsageRows).toHaveBeenCalledWith(records);
    expect(store.readUsageRows).not.toHaveBeenCalled();
  });

  it('delegates retention to the database adapter', async () => {
    store.applyUsageRetentionRows.mockResolvedValue(3);

    await expect(applyUsageRetention({ maxAgeDays: 30 })).resolves.toBe(3);
    expect(store.applyUsageRetentionRows).toHaveBeenCalledWith({ maxAgeDays: 30 });
  });
});
