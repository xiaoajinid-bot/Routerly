export function isVercelRuntime(): boolean {
  return process.env['VERCEL'] === '1';
}

export function usesPostgresStorage(): boolean {
  const configuredBackend = process.env['ROUTERLY_STORAGE_BACKEND'];
  if (configuredBackend === 'file') return false;
  if (configuredBackend === 'postgres') return true;
  return isVercelRuntime();
}
