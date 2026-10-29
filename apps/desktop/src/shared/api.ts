import type {
  BackupSummary,
  ConnectionTestResult,
  DuplicatePlan,
  ListedFolder,
  MboxExportReport,
  Phase,
  ProviderPreset,
  Report,
  RoundedTime,
  RunError,
  TransferPlan,
  VerifyReport,
} from '@imaptransfer/core';
import type { LanguageChoice } from './languages';

export type AuthKind = 'password' | 'oauth-microsoft';

/** An account as the user interface sees it: never contains a password or token. */
export interface AccountSummary {
  id: string;
  user: string;
  host: string;
  port: number;
  secure: boolean;
  allowSelfSigned: boolean;
  providerId: string | null;
  auth: AuthKind;
  backupDirectory: string | null;
  lastBackup: LastBackup | null;
}

/** The account's last backup run, with the counts of the backup it went into. */
export interface LastBackup {
  finishedAt: string;
  status: Report['status'];
  messages: number;
  bytes: number;
  /** The folder holding that backup; null when no run has got as far as a folder yet. */
  directory: string | null;
}

/**
 * Only the message of an error thrown in the main process reaches the window. A known conflict
 * travels in it behind this mark, as JSON, so the window can say it in the user's language.
 */
export const CONFLICT_MARK = 'imaptransfer-conflict:';

export interface AccountDraft {
  /** Missing for a new account. */
  id?: string;
  user: string;
  host: string;
  port: number;
  secure: boolean;
  allowSelfSigned: boolean;
  providerId: string | null;
  auth: AuthKind;
  /** Password or app password; empty keeps the stored one when editing. */
  password?: string;
  /** Result of `accounts.signInMicrosoft`, used instead of a password. */
  signInId?: string;
}

export type JobRequest =
  | { kind: 'backup'; accountId: string; directory: string; excludeFolders: string[] }
  /** `sync`: in one direction, what left the source leaves the target too (see the engine's `sync` option). */
  | { kind: 'restore'; directory: string; accountId: string; includeRemoved: boolean; excludeFolders: string[]; sync: boolean }
  | { kind: 'migrate'; fromAccountId: string; toAccountId: string; excludeFolders: string[]; sync: boolean }
  | { kind: 'dedupe'; accountId: string; excludeFolders: string[] }
  | { kind: 'verify'; directory: string }
  | { kind: 'export-mbox'; directory: string; outputDirectory: string; includeRemoved: boolean };

export type PlanRequest = Extract<JobRequest, { kind: 'restore' } | { kind: 'migrate' }>;

export interface JobWarning {
  message: string;
  folder?: string;
  subject?: string;
}

export interface JobState {
  id: string;
  request: JobRequest;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  phase: Phase | null;
  folder: { path: string; index: number; count: number } | null;
  progress: { done: number; total: number; bytes: number };
  /** Messages and bytes that still have to cross the network, and the time that will take. */
  remaining: { messages: number; bytes: number; time: RoundedTime } | null;
  /** The large message (1 MB or more) on its way right now. */
  current: { direction: 'download' | 'upload'; subject: string | null; size: number; transferred: number; startedAt: number } | null;
  warnings: JobWarning[];
  retry: { attempt: number; delayMs: number; reason: string; at: number } | null;
  report: Report | null;
  verify: VerifyReport | null;
  mbox: MboxExportReport | null;
  /** Unexpected error outside of a report, e.g. the backup folder cannot be read. */
  error: RunError | null;
  startedAt: string;
}

/** Light, dark, or whatever the operating system uses. */
export type ThemeChoice = 'system' | 'light' | 'dark';

/** How the sidebar lists the accounts: by address, or by provider (the server, when no provider is known). */
export type AccountOrder = 'address' | 'provider';

/** What the user set up for the app itself; kept next to the accounts. */
export interface Settings {
  theme: ThemeChoice;
  language: LanguageChoice;
  accountOrder: AccountOrder;
}

/** How far the test run for duplicate mail is. */
export interface DuplicateSearchProgress {
  phase: 'connect' | 'scan';
  folder: { path: string; index: number; count: number } | null;
  done: number;
  total: number;
}

export interface AppInfo {
  version: string;
  platform: NodeJS.Platform;
  microsoftSignIn: boolean;
  /** `weak` on Linux without a keyring: passwords are stored only obfuscated. */
  secretStorage: 'os' | 'weak';
  /** The account file could not be read as it should; what happened, for the window to show. */
  accountsProblem: string | null;
  settings: Settings;
}

export interface ImaptransferApi {
  app: {
    info(): Promise<AppInfo>;
    /** A folder for the backup of the account with that name, under the user's documents. */
    defaultBackupDirectory(name: string): Promise<string>;
    updateSettings(change: Partial<Settings>): Promise<Settings>;
  };
  providers(): Promise<ProviderPreset[]>;
  accounts: {
    list(): Promise<AccountSummary[]>;
    save(draft: AccountDraft): Promise<AccountSummary>;
    remove(id: string): Promise<void>;
    test(draft: AccountDraft): Promise<ConnectionTestResult>;
    folders(id: string): Promise<ListedFolder[]>;
    signInMicrosoft(loginHint?: string): Promise<{ signInId: string; email: string | null }>;
    setBackupDirectory(id: string, directory: string): Promise<AccountSummary>;
  };
  backups: {
    inspect(directory: string): Promise<BackupSummary | null>;
  };
  jobs: {
    start(request: JobRequest): Promise<JobState>;
    cancel(): Promise<void>;
    current(): Promise<JobState | null>;
    dismiss(): Promise<void>;
    plan(request: PlanRequest): Promise<TransferPlan>;
    /** Copies of the same message within a folder of the account, before cleaning them up. */
    findDuplicates(accountId: string): Promise<DuplicatePlan | null>;
    /** Stops a test run that is still searching; it then answers null. */
    cancelFindDuplicates(): Promise<void>;
    onDuplicateProgress(listener: (progress: DuplicateSearchProgress) => void): () => void;
    onUpdate(listener: (state: JobState) => void): () => void;
    onAccountsChanged(listener: () => void): () => void;
  };
  dialogs: {
    chooseDirectory(options: { title: string; defaultPath?: string; create?: boolean }): Promise<string | null>;
  };
  shell: {
    openPath(path: string): Promise<void>;
    openExternal(url: string): Promise<void>;
  };
}
