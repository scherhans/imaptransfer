import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  backupAccount,
  BackupStore,
  classifyError,
  ConflictError,
  conflictOf,
  describeError,
  exportMbox,
  migrateAccount,
  removeDuplicates,
  restoreBackup,
  roundRemaining,
  verifyBackup,
  type BackupSummary,
  type ProgressEvent,
} from '@imaptransfer/core';
import type { AccountSummary, JobRequest, JobState } from '../shared/api';
import type { AccountStore } from './accounts';

const SEND_INTERVAL_MS = 100;

/**
 * The backup of this account in a folder; null when the folder holds none, holds the backup
 * of another account, or cannot be read.
 */
export function backupIn(directory: string, account: Pick<AccountSummary, 'user' | 'host'>): BackupSummary | null {
  if (!BackupStore.exists(directory)) return null;
  try {
    const store = BackupStore.open(directory, { readOnly: true });
    try {
      const summary = store.summary();
      const owner = summary.account;
      const ours = owner !== null && owner.user.toLowerCase() === account.user.toLowerCase() && owner.host.toLowerCase() === account.host.toLowerCase();
      return ours ? summary : null;
    } finally {
      store.close();
    }
  } catch {
    return null;
  }
}
const MAX_WARNINGS = 200;

export interface JobHooks {
  /** Called with every state the user interface should see, at most every 100 ms. */
  publish(state: JobState): void;
  started(state: JobState): void;
  finished(state: JobState): void;
  accountsChanged(): void;
}

/** Runs one job at a time in the main process and keeps its state for the window. */
export class JobRunner {
  private readonly accounts: AccountStore;
  private readonly hooks: JobHooks;
  /** Where migrations remember what each source folder held, one file per pair of accounts. */
  private readonly memories: string;
  private state: JobState | null = null;
  private controller: AbortController | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** Settles when the running job is over; resolved when none runs. */
  private done: Promise<void> = Promise.resolve();

  constructor(accounts: AccountStore, hooks: JobHooks, memories: string) {
    this.accounts = accounts;
    this.hooks = hooks;
    this.memories = memories;
  }

  /**
   * The memory of migrations from one account into another. Every migration keeps it, not only a
   * sync: a sync after earlier migrations then also takes out what left the source in between.
   */
  syncMemory(fromAccountId: string, toAccountId: string): string {
    return join(this.memories, `${fromAccountId}--${toAccountId}.db`);
  }

  /** Removes what migrations from or into the account remembered (with SQLite's journal). */
  forgetSyncMemories(accountId: string): void {
    if (!existsSync(this.memories)) return;
    for (const name of readdirSync(this.memories)) {
      if (name.startsWith(`${accountId}--`) || name.includes(`--${accountId}.db`)) rmSync(join(this.memories, name), { force: true });
    }
  }

  get running(): boolean {
    return this.state?.status === 'running';
  }

  current(): JobState | null {
    return this.state;
  }

  start(request: JobRequest): JobState {
    if (this.running) throw new Error('Another job is still running.');
    const controller = new AbortController();
    const state: JobState = {
      id: randomUUID(),
      request,
      status: 'running',
      phase: null,
      folder: null,
      progress: { done: 0, total: 0, bytes: 0 },
      remaining: null,
      current: null,
      warnings: [],
      retry: null,
      report: null,
      verify: null,
      mbox: null,
      error: null,
      startedAt: new Date().toISOString(),
    };
    this.state = state;
    this.controller = controller;
    this.hooks.started(state);
    this.done = this.execute(state, controller.signal)
      .finally(() => {
        this.controller = null;
        this.flush();
        this.hooks.finished(state);
      })
      .catch((error: unknown) => {
        // `execute` reports every error in the state; this only guards the hooks.
        console.error('Job finished with an error outside the report:', error);
      });
    return state;
  }

  cancel(): void {
    this.controller?.abort();
  }

  /** Waits until the running job is over, so a quit can let it close its connections. */
  whenIdle(): Promise<void> {
    return this.done;
  }

  dismiss(): void {
    if (!this.running) this.state = null;
  }

  private onProgress(state: JobState) {
    return (event: ProgressEvent) => {
      switch (event.type) {
        case 'phase':
          state.phase = event.phase;
          break;
        case 'folder':
          state.folder = { path: event.path, index: event.index, count: event.count };
          break;
        case 'progress':
          state.progress = { done: event.done, total: event.total, bytes: event.bytes };
          state.remaining =
            event.remainingMessages > 0
              ? { messages: event.remainingMessages, bytes: event.remainingBytes, time: roundRemaining(event.remainingSeconds) }
              : null;
          state.retry = null;
          break;
        case 'message':
          if (event.finished) state.current = null;
          else if (event.transferred === 0 || !state.current) {
            // A new large message: the window shows it only once it takes a moment.
            state.current = { direction: event.direction, subject: event.subject, size: event.size, transferred: event.transferred, startedAt: Date.now() };
          } else state.current = { ...state.current, transferred: event.transferred };
          break;
        case 'warning':
          if (state.warnings.length < MAX_WARNINGS) state.warnings.push({ message: event.message, ...(event.folder ? { folder: event.folder } : {}), ...(event.subject ? { subject: event.subject } : {}) });
          break;
        case 'retry':
          state.retry = { attempt: event.attempt, delayMs: event.delayMs, reason: event.reason, at: Date.now() };
          break;
      }
      this.schedule();
    };
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.state) this.hooks.publish(structuredClone(this.state));
    }, SEND_INTERVAL_MS);
  }

  private flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.state) this.hooks.publish(structuredClone(this.state));
  }

  private async execute(state: JobState, signal: AbortSignal): Promise<void> {
    const options = { signal, onProgress: this.onProgress(state) };
    const request = state.request;
    try {
      switch (request.kind) {
        case 'backup': {
          // The folder held this account's backup at its last run and holds none now: a drive
          // not plugged in, or a mount point without its drive. A new full backup there would be
          // worse than stopping. A folder chosen anew has no such past and simply starts.
          const account = this.accounts.list().find((candidate) => candidate.id === request.accountId);
          if (account?.lastBackup?.directory === request.directory && !BackupStore.exists(request.directory)) {
            throw new ConflictError(`The backup folder ${request.directory} no longer holds a backup. Is the drive connected?`, {
              code: 'backup-missing',
              details: { directory: request.directory },
            });
          }
          const report = await backupAccount(await this.accounts.config(request.accountId), request.directory, {
            ...options,
            excludeFolders: request.excludeFolders,
          });
          state.report = report;
          this.recordBackup(request.accountId, request.directory, report.status, report.finishedAt);
          break;
        }
        case 'restore':
          state.report = await restoreBackup(request.directory, await this.accounts.config(request.accountId), {
            ...options,
            includeRemoved: request.includeRemoved,
            excludeFolders: request.excludeFolders,
            sync: request.sync,
          });
          break;
        case 'migrate':
          state.report = await migrateAccount(await this.accounts.config(request.fromAccountId), await this.accounts.config(request.toAccountId), {
            ...options,
            excludeFolders: request.excludeFolders,
            sync: request.sync,
            memory: this.syncMemory(request.fromAccountId, request.toAccountId),
          });
          break;
        case 'dedupe':
          state.report = await removeDuplicates(await this.accounts.config(request.accountId), {
            ...options,
            excludeFolders: request.excludeFolders,
          });
          break;
        case 'verify':
          state.verify = await verifyBackup(request.directory, options);
          break;
        case 'export-mbox':
          state.mbox = await exportMbox(request.directory, request.outputDirectory, { ...options, includeRemoved: request.includeRemoved });
          break;
      }
      state.status = state.report?.status ?? (state.verify?.cancelled || state.mbox?.cancelled ? 'cancelled' : 'completed');
    } catch (error) {
      state.status = signal.aborted ? 'cancelled' : 'failed';
      state.error = { kind: classifyError(error), message: describeError(error), conflict: conflictOf(error) };
    } finally {
      state.current = null;
      state.remaining = null;
    }
  }

  private recordBackup(accountId: string, directory: string, status: JobState['status'], finishedAt: string): void {
    if (status === 'running') return;
    const account = this.accounts.list().find((candidate) => candidate.id === accountId);
    if (!account) return;
    const backup = backupIn(directory, account);
    const previous = account.lastBackup;
    this.accounts.update(accountId, {
      backupDirectory: directory,
      lastBackup: backup
        ? { finishedAt, status, messages: backup.messages, bytes: backup.bytes, directory }
        : // The run never got as far as its folder (wrong password, a folder of another account):
          // the account shows its outcome, with the counts and folder of the last backup.
          { finishedAt, status, messages: previous?.messages ?? 0, bytes: previous?.bytes ?? 0, directory: previous?.directory ?? null },
    });
    this.hooks.accountsChanged();
  }
}
