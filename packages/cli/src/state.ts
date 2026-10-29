import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AccountConfig } from '@imaptransfer/core';

/** Where the command line keeps data of its own: the place each system has for it. */
export function stateDirectory(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'imaptransfer');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'imaptransfer');
  return join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'imaptransfer');
}

/**
 * The file in which syncs of two accounts remember what the source held. One file per pair, so
 * a cron job finds its memory again without being told where it is.
 */
export function defaultSyncState(from: Pick<AccountConfig, 'user' | 'host'>, to: Pick<AccountConfig, 'user' | 'host'>, directory = stateDirectory()): string {
  const pair = [from.user, from.host, to.user, to.host].map((value) => value.toLowerCase());
  return join(directory, 'sync', `${createHash('sha256').update(JSON.stringify(pair)).digest('hex').slice(0, 16)}.db`);
}
