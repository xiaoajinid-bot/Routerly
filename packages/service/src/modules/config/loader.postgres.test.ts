import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  postgresEnabled: false,
  readConfigRow: vi.fn(),
  writeConfigRow: vi.fn(),
  updateConfigRow: vi.fn(),
  pruneOrphanUsageRows: vi.fn(),
}));

vi.mock('./storage-mode.js', () => ({
  isVercelRuntime: () => false,
  usesPostgresStorage: () => state.postgresEnabled,
}));
vi.mock('./postgres-store.js', () => ({
  readConfigRow: state.readConfigRow,
  writeConfigRow: state.writeConfigRow,
  updateConfigRow: state.updateConfigRow,
  pruneOrphanUsageRows: state.pruneOrphanUsageRows,
}));

const { readConfig, writeConfig, updateConfig } = await import('./loader.js');

beforeEach(() => {
  state.postgresEnabled = true;
  vi.clearAllMocks();
});

afterEach(() => {
  state.postgresEnabled = false;
});

describe('Postgres config dispatch', () => {
  it('reads a typed config from the database adapter', async () => {
    const stored = [{ id: 'db-router' }];
    state.readConfigRow.mockResolvedValue(stored);

    await expect(readConfig('routers')).resolves.toEqual(stored);
    expect(state.readConfigRow).toHaveBeenCalledWith('routers', expect.any(Array));
  });

  it('writes a typed config through the database adapter', async () => {
    const settings = { port: 4300 } as never;

    await writeConfig('settings', settings);

    expect(state.writeConfigRow).toHaveBeenCalledWith('settings', settings);
  });

  it('preserves atomic update semantics through the database adapter', async () => {
    const next = [{ id: 'updated' }];
    state.updateConfigRow.mockImplementation(async (_key, _defaults, mutate) => mutate([]));

    await expect(updateConfig('routers', () => next as never)).resolves.toEqual(next);
    expect(state.updateConfigRow).toHaveBeenCalledWith('routers', expect.any(Array), expect.any(Function));
  });

  it('keeps usage append-only in Postgres mode', async () => {
    await expect(updateConfig('usage', () => [] as never)).rejects.toThrow(/append-only/);
    expect(state.updateConfigRow).not.toHaveBeenCalled();
  });
});
