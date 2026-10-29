export { backupAccount, type BackupOptions } from './backup.ts';
export {
  DUPLICATE_PROBLEMS,
  findDuplicates,
  removeDuplicates,
  type DedupeOptions,
  type DuplicateFolder,
  type DuplicateMessage,
  type DuplicatePlan,
  type DuplicateProblem,
} from './dedupe.ts';
export { CancelledError, ConflictError, classifyError, conflictOf, describeError } from './errors.ts';
export { roundRemaining, type RoundedTime } from './estimate.ts';
export { fingerprint, summarizeHeaders } from './fingerprint.ts';
export { filterFlags } from './flags.ts';
export { mapFolders, type AccountLayout, type FolderMapping, type ListedFolder } from './folders.ts';
export { exportMbox, type MboxExportOptions, type MboxExportReport } from './mbox.ts';
export {
  authorizeInteractive,
  googleProvider,
  microsoftProvider,
  OAuthError,
  OAuthTokenSource,
  refreshTokens,
  type OAuthProvider,
  type OAuthTokens,
} from './oauth.ts';
export { detectProvider, findProvider, PROVIDERS, type ProviderAuth, type ProviderHint, type ProviderPreset } from './providers.ts';
export { inspectAccount, testConnection, type ConnectionTestResult } from './session.ts';
export { BackupStore, type BackupSummary } from './store/store.ts';
export {
  migrateAccount,
  planMigration,
  planRestore,
  restoreBackup,
  SYNC_PROBLEMS,
  type MigrateOptions,
  type RestoreOptions,
  type SyncProblem,
  type TransferPlan,
} from './transfer.ts';
export type {
  AccountAuth,
  AccountConfig,
  Conflict,
  ConflictCode,
  ErrorKind,
  Failure,
  FolderInfo,
  FolderReport,
  FolderRole,
  JobOptions,
  Phase,
  ProgressEvent,
  Report,
  RunError,
} from './types.ts';
export { verifyBackup, type VerifyReport } from './verify.ts';
export { VERSION } from './version.ts';
