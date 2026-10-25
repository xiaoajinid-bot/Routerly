import { afterEach, describe, expect, it, vi } from 'vitest';
import { isVercelRuntime, usesPostgresStorage } from './storage-mode.js';

afterEach(() => vi.unstubAllEnvs());

describe('storage mode', () => {
  it('defaults to file storage outside Vercel', () => {
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('ROUTERLY_STORAGE_BACKEND', '');

    expect(isVercelRuntime()).toBe(false);
    expect(usesPostgresStorage()).toBe(false);
  });

  it('uses Postgres automatically on Vercel', () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('ROUTERLY_STORAGE_BACKEND', '');

    expect(isVercelRuntime()).toBe(true);
    expect(usesPostgresStorage()).toBe(true);
  });

  it('allows an explicit file backend override', () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('ROUTERLY_STORAGE_BACKEND', 'file');

    expect(usesPostgresStorage()).toBe(false);
  });

  it('allows an explicit Postgres backend outside Vercel', () => {
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('ROUTERLY_STORAGE_BACKEND', 'postgres');

    expect(usesPostgresStorage()).toBe(true);
  });
});
