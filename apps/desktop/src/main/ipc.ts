import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import {
  BackupStore,
  conflictOf,
  findDuplicates,
  inspectAccount,
  planMigration,
  planRestore,
  PROVIDERS,
  testConnection,
  VERSION,
} from '@imaptransfer/core';
import { CONFLICT_MARK, type AccountDraft, type AppInfo, type DuplicateSearchProgress, type JobRequest, type PlanRequest } from '../shared/api';
import { secretStorageStrength, type AccountSecret, type AccountStore } from './accounts';
import { backupIn, type JobRunner } from './jobs';
import type { SettingsStore } from './settings';
import { forgetSignIn, microsoftClientId, pendingSignIn, signInMicrosoft } from './signin';

/** Like `ipcMain.handle`, but a known conflict reaches the window with its code (see `CONFLICT_MARK`). */
function handle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await listener(event, ...args);
    } catch (error) {
      const conflict = conflictOf(error);
      if (conflict) throw new Error(`${CONFLICT_MARK}${JSON.stringify(conflict)}`);
      throw error;
    }
  });
}

function secretFromDraft(draft: AccountDraft): AccountSecret | null {
  if (draft.auth === 'oauth-microsoft') return pendingSignIn(draft.signInId);
  return draft.password ? { type: 'password', password: draft.password } : null;
}

function safeFolderName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'account';
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing ${name}`);
  return value;
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Missing ${name}`);
  return value;
}

function stringList(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`Invalid ${name}`);
  return value as string[];
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error(`Invalid ${name}`);
  return value as Record<string, unknown>;
}

/** The window is sandboxed, but a request it sends is still checked before it starts a job. */
function parseJobRequest(input: unknown): JobRequest {
  const value = record(input, 'request');
  const excludeFolders = stringList(value.excludeFolders, 'folder list');
  switch (value.kind) {
    case 'backup':
      return { kind: 'backup', accountId: requireString(value.accountId, 'account'), directory: requireString(value.directory, 'directory'), excludeFolders };
    case 'restore': {
      const includeRemoved = requireBoolean(value.includeRemoved, 'includeRemoved');
      const sync = requireBoolean(value.sync, 'sync');
      if (sync && includeRemoved) throw new Error('A sync takes deleted mail out of the account, so it cannot restore deleted mail at the same time');
      return { kind: 'restore', directory: requireString(value.directory, 'directory'), accountId: requireString(value.accountId, 'account'), includeRemoved, excludeFolders, sync };
    }
    case 'migrate':
      return {
        kind: 'migrate',
        fromAccountId: requireString(value.fromAccountId, 'account'),
        toAccountId: requireString(value.toAccountId, 'target account'),
        excludeFolders,
        sync: requireBoolean(value.sync, 'sync'),
      };
    case 'dedupe':
      return { kind: 'dedupe', accountId: requireString(value.accountId, 'account'), excludeFolders };
    case 'verify':
      return { kind: 'verify', directory: requireString(value.directory, 'directory') };
    case 'export-mbox':
      return {
        kind: 'export-mbox',
        directory: requireString(value.directory, 'directory'),
        outputDirectory: requireString(value.outputDirectory, 'output directory'),
        includeRemoved: requireBoolean(value.includeRemoved, 'includeRemoved'),
      };
    default:
      throw new Error(`Unknown job kind ${String(value.kind)}`);
  }
}

function parsePlanRequest(input: unknown): PlanRequest {
  const request = parseJobRequest(input);
  if (request.kind !== 'restore' && request.kind !== 'migrate') throw new Error(`No plan for ${request.kind}`);
  return request;
}

function parseDraft(input: unknown): AccountDraft {
  const value = record(input, 'account');
  const port = Number(value.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('Invalid port');
  if (value.auth !== 'password' && value.auth !== 'oauth-microsoft') throw new Error('Invalid sign-in kind');
  return {
    ...(typeof value.id === 'string' ? { id: value.id } : {}),
    user: requireString(value.user, 'user'),
    host: requireString(value.host, 'host'),
    port,
    secure: requireBoolean(value.secure, 'secure'),
    allowSelfSigned: requireBoolean(value.allowSelfSigned, 'allowSelfSigned'),
    providerId: typeof value.providerId === 'string' ? value.providerId : null,
    auth: value.auth,
    ...(typeof value.password === 'string' ? { password: value.password } : {}),
    ...(typeof value.signInId === 'string' ? { signInId: value.signInId } : {}),
  };
}

export function registerIpc(accounts: AccountStore, jobs: JobRunner, settings: SettingsStore, applySettings: () => void): void {
  handle('app:updateSettings', (_event, change: unknown) => {
    const updated = settings.update(record(change, 'settings'));
    applySettings();
    return updated;
  });
  handle('app:info', async (): Promise<AppInfo> => ({
    settings: settings.current,
    version: VERSION,
    platform: process.platform,
    microsoftSignIn: Boolean(microsoftClientId()),
    secretStorage: await secretStorageStrength(),
    accountsProblem: accounts.problem,
  }));
  handle('app:defaultBackupDirectory', (_event, name: unknown) =>
    join(app.getPath('documents'), 'IMAP Transfer', safeFolderName(requireString(name, 'name'))),
  );
  handle('providers', () => PROVIDERS);

  handle('accounts:list', () => accounts.list());
  handle('accounts:save', async (_event, input: unknown) => {
    const draft = parseDraft(input);
    const saved = await accounts.save(draft, secretFromDraft(draft));
    forgetSignIn(draft.signInId);
    return saved;
  });
  handle('accounts:remove', (_event, id: unknown) => {
    const accountId = requireString(id, 'account');
    accounts.remove(accountId);
    // What syncs of this account remembered belongs to it and goes with it.
    jobs.forgetSyncMemories(accountId);
  });
  handle('accounts:test', async (_event, input: unknown) => {
    const draft = parseDraft(input);
    return testConnection(await accounts.draftConfig(draft, secretFromDraft(draft)));
  });
  handle('accounts:folders', async (_event, id: unknown) => (await inspectAccount(await accounts.config(requireString(id, 'account')))).folders);
  handle('accounts:signInMicrosoft', (_event, loginHint: unknown) => signInMicrosoft(typeof loginHint === 'string' ? loginHint : undefined));
  handle('accounts:setBackupDirectory', (_event, id: unknown, directory: unknown) => {
    const accountId = requireString(id, 'account');
    const path = requireString(directory, 'directory');
    const account = accounts.list().find((candidate) => candidate.id === accountId);
    // A folder that already holds this account's backup brings its last run along; for any
    // other folder the account keeps its last run, which then belongs to another folder.
    const backup = account ? backupIn(path, account) : null;
    const run = backup?.lastRun;
    return accounts.update(accountId, {
      backupDirectory: path,
      ...(backup && run ? { lastBackup: { finishedAt: run.finishedAt, status: run.status, messages: backup.messages, bytes: backup.bytes, directory: path } } : {}),
    });
  });

  handle('backups:inspect', (_event, directory: unknown) => {
    const path = requireString(directory, 'directory');
    if (!BackupStore.exists(path)) return null;
    const store = BackupStore.open(path, { readOnly: true });
    try {
      return store.summary();
    } finally {
      store.close();
    }
  });

  handle('jobs:start', (_event, input: unknown) => jobs.start(parseJobRequest(input)));
  handle('jobs:cancel', () => jobs.cancel());
  handle('jobs:current', () => jobs.current());
  handle('jobs:dismiss', () => jobs.dismiss());
  handle('jobs:plan', async (_event, input: unknown) => {
    const request = parsePlanRequest(input);
    return request.kind === 'restore'
      ? planRestore(request.directory, await accounts.config(request.accountId), {
          includeRemoved: request.includeRemoved,
          excludeFolders: request.excludeFolders,
        })
      : planMigration(await accounts.config(request.fromAccountId), await accounts.config(request.toAccountId), {
          excludeFolders: request.excludeFolders,
          memory: jobs.syncMemory(request.fromAccountId, request.toAccountId),
        });
  });
  // The test run is a question to the account, not a job: it answers with the plan, and tells
  // the window on the way how far it is. Closing the dialog stops it.
  let duplicateSearch: AbortController | null = null;
  handle('jobs:findDuplicates', async (event, accountId: unknown) => {
    duplicateSearch?.abort();
    const controller = new AbortController();
    duplicateSearch = controller;
    const progress: DuplicateSearchProgress = { phase: 'connect', folder: null, done: 0, total: 0 };
    let lastSent = 0;
    const send = (force: boolean) => {
      const now = Date.now();
      // A stopped run says nothing more: its last numbers would land in the next test run.
      if ((!force && now - lastSent < 100) || controller.signal.aborted || event.sender.isDestroyed()) return;
      lastSent = now;
      event.sender.send('jobs:duplicateProgress', { ...progress });
    };
    try {
      return await findDuplicates(await accounts.config(requireString(accountId, 'account')), {
        signal: controller.signal,
        onProgress: (update) => {
          if (update.type === 'phase' && (update.phase === 'connect' || update.phase === 'scan')) progress.phase = update.phase;
          else if (update.type === 'folder') progress.folder = { path: update.path, index: update.index, count: update.count };
          else if (update.type === 'progress') Object.assign(progress, { done: update.done, total: update.total });
          else return;
          send(update.type !== 'progress');
        },
      });
    } catch (error) {
      // Stopped on purpose: nobody waits for an answer any more.
      if (controller.signal.aborted) return null;
      throw error;
    } finally {
      if (duplicateSearch === controller) duplicateSearch = null;
    }
  });
  handle('jobs:cancelFindDuplicates', () => duplicateSearch?.abort());

  handle('dialogs:chooseDirectory', async (event, options: { title: string; defaultPath?: string; create?: boolean }) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: Electron.OpenDialogOptions = {
      title: options.title,
      properties: ['openDirectory', ...(options.create ? (['createDirectory', 'promptToCreate'] as const) : [])],
      ...(options.defaultPath && existsSync(options.defaultPath) ? { defaultPath: options.defaultPath } : {}),
    };
    const result = window ? await dialog.showOpenDialog(window, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle('shell:openPath', async (_event, path: unknown) => {
    const error = await shell.openPath(requireString(path, 'path'));
    if (error) throw new Error(error);
  });
  handle('shell:openExternal', (_event, url: unknown) => {
    const target = requireString(url, 'url');
    if (!target.startsWith('https://')) throw new Error('Only https links can be opened.');
    return shell.openExternal(target);
  });
}
