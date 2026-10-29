import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { open, readFile, rename, rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { ConflictError } from '../errors.ts';
import { mergeFlags } from '../flags.ts';
import type { HeaderSummary } from '../fingerprint.ts';
import type { FolderInfo, FolderRole, Report } from '../types.ts';
import { folderDirectory, messageFileName, uniquePath } from './paths.ts';

export const DATABASE_FILE = 'imaptransfer.db';
export const MAIL_DIRECTORY = 'mail';
const LOCK_FILE = 'imaptransfer.lock';
const LOCK_HEARTBEAT_MS = 30_000;
const LOCK_STALE_MS = 5 * 60_000;
const BUSY_TIMEOUT_MS = 10_000;
const SCHEMA_VERSION = 2;
/** Meta key set while a backup run is under way; recording the run removes it. */
const RUN_UNFINISHED = 'run.unfinished';

interface LockHandle {
  release(): void;
}

const TABLES = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  delimiter TEXT NOT NULL,
  special_use TEXT,
  role TEXT NOT NULL,
  uid_validity TEXT,
  uid_next INTEGER,
  dir TEXT NOT NULL,
  dir_key TEXT NOT NULL UNIQUE,
  removed_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  file TEXT NOT NULL,
  file_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  internal_date TEXT,
  header_date TEXT,
  subject TEXT,
  from_address TEXT,
  message_id_header TEXT,
  email_id TEXT,
  added_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  id INTEGER PRIMARY KEY,
  folder_id INTEGER NOT NULL REFERENCES folders(id),
  message_id INTEGER NOT NULL REFERENCES messages(id),
  uid INTEGER,
  flags TEXT NOT NULL,
  removed_at TEXT
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  report TEXT NOT NULL
);
`;

/** Columns added after a table first existed; older backups get them on open. */
const ADDED_COLUMNS: Record<string, [string, string][]> = {
  folders: [
    ['uid_next', 'INTEGER'],
    ['removed_at', 'TEXT'],
  ],
  messages: [['email_id', 'TEXT']],
};

const INDEXES = `
CREATE UNIQUE INDEX IF NOT EXISTS memberships_folder_uid ON memberships(folder_id, uid) WHERE uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS memberships_message ON memberships(message_id);
CREATE INDEX IF NOT EXISTS memberships_folder ON memberships(folder_id);
CREATE INDEX IF NOT EXISTS messages_email_id ON messages(email_id) WHERE email_id IS NOT NULL;
`;

function migrate(db: DatabaseSync): void {
  db.exec(TABLES);
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    const present = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((row) => String(row.name)));
    for (const [name, type] of columns) {
      if (!present.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
  db.exec(INDEXES);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

const README = `This folder is a backup made with imaptransfer.

mail/            One .eml file per message, in the folder structure of the account.
                 Any mail program opens these files with a double click.
imaptransfer.db  Index (SQLite): folders, read/flagged state, dates and checksums.
                 imaptransfer needs it to continue a backup and to restore it.

A message that lives in several folders (for example Gmail labels) is stored once,
under the first folder it was found in. The index knows all its folders.

Diese Ablage ist eine Sicherung von imaptransfer.

mail/            Eine .eml-Datei pro Mail, in der Ordnerstruktur des Kontos.
                 Jedes Mailprogramm öffnet diese Dateien per Doppelklick.
imaptransfer.db  Verzeichnis (SQLite): Ordner, gelesen/markiert, Datum und Prüfsummen.
                 imaptransfer braucht es, um weiterzusichern und wiederherzustellen.
`;

export interface StoredFolder extends FolderInfo {
  id: number;
  uidValidity: string | null;
  /** UIDNEXT when the folder was last backed up completely: everything below is known. */
  uidNext: number | null;
  dir: string;
  /** The folder no longer exists in the account. */
  removed: boolean;
}

export interface StoredMessage {
  id: number;
  fingerprint: string;
  file: string;
  sha256: string;
  size: number;
  internalDate: string | null;
  headerDate: string | null;
  subject: string | null;
  fromAddress: string | null;
}

export interface Placement {
  folder: string;
  flags: string[];
  /** How often the folder holds the message: an interrupted sync can leave several copies. */
  copies: number;
  removed: boolean;
}

export interface RestorableMessage extends StoredMessage {
  placements: Placement[];
}

export interface ActiveMembership {
  id: number;
  messageId: number;
  flags: string[];
}

export interface BackupSummary {
  folders: number;
  messages: number;
  bytes: number;
  lastRun: { kind: Report['kind']; status: Report['status']; finishedAt: string } | null;
  account: { host: string; user: string } | null;
}

type Row = Record<string, SQLInputValue>;

function key(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

function toFolder(row: Row): StoredFolder {
  return {
    id: Number(row.id),
    path: String(row.path),
    delimiter: String(row.delimiter),
    specialUse: row.special_use === null ? null : String(row.special_use),
    role: String(row.role) as FolderRole,
    uidValidity: row.uid_validity === null ? null : String(row.uid_validity),
    uidNext: row.uid_next === null || row.uid_next === undefined ? null : Number(row.uid_next),
    dir: String(row.dir),
    removed: row.removed_at !== null && row.removed_at !== undefined,
  };
}

function toMessage(row: Row): StoredMessage {
  const text = (value: SQLInputValue | undefined) => (value === null || value === undefined ? null : String(value));
  return {
    id: Number(row.id),
    fingerprint: String(row.fingerprint),
    file: String(row.file),
    sha256: String(row.sha256),
    size: Number(row.size),
    internalDate: text(row.internal_date),
    headerDate: text(row.header_date),
    subject: text(row.subject),
    fromAddress: text(row.from_address),
  };
}

/** Makes a rename durable. Windows cannot open directories for this and needs no such step. */
async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  try {
    const handle = await open(path, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Some network file systems refuse fsync on directories; the file itself is synced.
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * A backup on disk: one .eml file per message plus an SQLite index. Opening it for writing
 * takes a lock file, so a scheduled backup and a manual one never write at the same time.
 */
export class BackupStore {
  readonly root: string;
  private readonly db: DatabaseSync;
  private readonly lock: LockHandle | null;

  private constructor(root: string, db: DatabaseSync, lock: LockHandle | null) {
    this.root = root;
    this.db = db;
    this.lock = lock;
  }

  static exists(root: string): boolean {
    return existsSync(join(root, DATABASE_FILE));
  }

  static open(root: string, options: { create?: boolean; readOnly?: boolean } = {}): BackupStore {
    const databasePath = join(root, DATABASE_FILE);
    if (!existsSync(databasePath)) {
      if (!options.create) throw new ConflictError(`No imaptransfer backup found in ${root}`, { code: 'no-backup', details: { directory: root } });
      // Only the backup folder itself is created, never the folders above it: with an external
      // drive not plugged in, a new full backup would otherwise land on the system disk.
      if (!existsSync(root) && !existsSync(dirname(root))) {
        throw new ConflictError(`The folder above ${root} does not exist. Is the drive connected?`, { code: 'drive-missing', details: { directory: root } });
      }
      if (!existsSync(root)) mkdirSync(root);
      mkdirSync(join(root, MAIL_DIRECTORY), { recursive: true });
      writeFileSync(join(root, 'README.txt'), README);
    }
    const lock = options.readOnly ? null : BackupStore.lock(root);
    try {
      // A reader (the app showing the summary, `verify`) holds the database for a moment;
      // without a timeout every write in that moment fails with "database is locked".
      const db = new DatabaseSync(databasePath, { readOnly: options.readOnly ?? false, timeout: BUSY_TIMEOUT_MS });
      const version = Number((db.prepare('PRAGMA user_version').get() as Row).user_version);
      if (version > SCHEMA_VERSION) {
        db.close();
        throw new ConflictError('This backup was made with a newer version of imaptransfer', { code: 'newer-version', details: {} });
      }
      if (options.readOnly) {
        // Columns added since are missing; only a writing run (a backup) adds them.
        if (version < SCHEMA_VERSION) {
          db.close();
          throw new ConflictError('This backup was made with an older version of imaptransfer; run a backup into it once to update it', {
            code: 'older-version',
            details: {},
          });
        }
      } else {
        db.exec('PRAGMA foreign_keys = ON');
        migrate(db);
      }
      return new BackupStore(root, db, lock);
    } catch (error) {
      lock?.release();
      throw error;
    }
  }

  /**
   * Takes the lock file. A live lock is touched every half minute, so one that was not touched
   * for a while belongs to a process that died, on whichever computer: a process ID says
   * nothing on another host, and after a reboot it may belong to somebody else.
   */
  private static lock(root: string): LockHandle {
    const lockPath = join(root, LOCK_FILE);
    const token = randomUUID();
    const owner = JSON.stringify({ pid: process.pid, host: hostname(), token });
    const take = (): LockHandle => {
      writeFileSync(lockPath, owner);
      const heartbeat = setInterval(() => {
        try {
          utimesSync(lockPath, new Date(), new Date());
        } catch {
          // The backup folder is gone or unreachable; the next write will say so.
        }
      }, LOCK_HEARTBEAT_MS);
      heartbeat.unref();
      return {
        release: () => {
          clearInterval(heartbeat);
          try {
            // Only ever remove the own lock: a stale one may have been taken over meanwhile.
            if ((JSON.parse(readFileSync(lockPath, 'utf8')) as { token?: string }).token === token) rmSync(lockPath, { force: true });
          } catch {
            // Already gone.
          }
        },
      };
    };
    try {
      writeFileSync(lockPath, owner, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let holder: { pid?: number; host?: string } = {};
      try {
        holder = JSON.parse(readFileSync(lockPath, 'utf8')) as typeof holder;
      } catch {
        // Unreadable lock file: treat it as stale.
      }
      const age = Date.now() - statSync(lockPath).mtimeMs;
      const deadHere = holder.host === hostname() && (typeof holder.pid !== 'number' || !isProcessAlive(holder.pid));
      if (!deadHere && age < LOCK_STALE_MS) {
        throw new ConflictError(
          `Another imaptransfer process (${holder.host ?? 'unknown host'}, pid ${holder.pid ?? '?'}) is using this backup. ` +
            `If none is running, delete ${lockPath}.`,
          { code: 'in-use', details: { host: holder.host ?? '?', pid: String(holder.pid ?? '?'), lock: lockPath } },
        );
      }
      return take();
    }
    return take();
  }

  close(): void {
    try {
      this.db.close();
    } finally {
      this.lock?.release();
    }
  }

  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getMeta(name: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(name) as Row | undefined;
    return row ? String(row.value) : null;
  }

  setMeta(name: string, value: string): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(name, value);
  }

  /** Binds the backup to one account, so a second account never mixes into it. */
  claimAccount(account: { host: string; user: string }): void {
    const host = this.getMeta('account.host');
    const user = this.getMeta('account.user');
    const empty = Number((this.db.prepare('SELECT COUNT(*) AS count FROM messages').get() as Row).count) === 0;
    if (host === null || user === null || empty) {
      this.setMeta('account.host', account.host);
      this.setMeta('account.user', account.user);
      this.setMeta('created_at', new Date().toISOString());
      return;
    }
    if (host.toLowerCase() !== account.host.toLowerCase() || user.toLowerCase() !== account.user.toLowerCase()) {
      throw new ConflictError(`This folder holds the backup of ${user} on ${host}. Choose an empty folder for ${account.user}.`, {
        code: 'other-account',
        details: { user, host, account: account.user },
      });
    }
  }

  folders(): StoredFolder[] {
    return (this.db.prepare('SELECT * FROM folders ORDER BY id').all() as Row[]).map(toFolder);
  }

  /**
   * Records a folder of the account and gives it its directory. The directory exists even when
   * the folder is empty, so the backup shows the same folders as the account.
   */
  upsertFolder(folder: FolderInfo): StoredFolder {
    const existing = this.db.prepare('SELECT * FROM folders WHERE path = ?').get(folder.path) as Row | undefined;
    let stored: StoredFolder;
    if (existing) {
      this.db
        .prepare('UPDATE folders SET delimiter = ?, special_use = ?, role = ?, removed_at = NULL WHERE id = ?')
        .run(folder.delimiter, folder.specialUse, folder.role, Number(existing.id));
      stored = { ...toFolder(existing), delimiter: folder.delimiter, specialUse: folder.specialUse, role: folder.role, removed: false };
    } else {
      const taken = new Set((this.db.prepare('SELECT dir_key FROM folders').all() as Row[]).map((row) => String(row.dir_key)));
      const dir = uniquePath(folderDirectory(folder.path, folder.delimiter), (candidate) => taken.has(key(candidate)));
      const result = this.db
        .prepare('INSERT INTO folders (path, delimiter, special_use, role, dir, dir_key) VALUES (?, ?, ?, ?, ?, ?)')
        .run(folder.path, folder.delimiter, folder.specialUse, folder.role, dir, key(dir));
      stored = { ...folder, id: Number(result.lastInsertRowid), uidValidity: null, uidNext: null, dir, removed: false };
    }
    mkdirSync(join(this.root, MAIL_DIRECTORY, stored.dir), { recursive: true });
    return stored;
  }

  folderByPath(path: string): StoredFolder | undefined {
    const row = this.db.prepare('SELECT * FROM folders WHERE path = ?').get(path) as Row | undefined;
    return row ? toFolder(row) : undefined;
  }

  setUidValidity(folderId: number, uidValidity: string): void {
    this.db.prepare('UPDATE folders SET uid_validity = ? WHERE id = ?').run(uidValidity, folderId);
  }

  setUidNext(folderId: number, uidNext: number): void {
    this.db.prepare('UPDATE folders SET uid_next = ? WHERE id = ?').run(uidNext, folderId);
  }

  /** Whether the backup already holds the message with this server-wide ID (Gmail's X-GM-MSGID). */
  hasEmailId(emailId: string): boolean {
    return this.db.prepare('SELECT 1 FROM messages WHERE email_id = ? LIMIT 1').get(emailId) !== undefined;
  }

  /** The server renumbered the folder: forget all UIDs, messages get re-linked by fingerprint. */
  resetUids(folderId: number): void {
    this.db.prepare('UPDATE memberships SET uid = NULL WHERE folder_id = ?').run(folderId);
  }

  activeUids(folderId: number): Map<number, ActiveMembership> {
    const rows = this.db
      .prepare('SELECT id, message_id, uid, flags FROM memberships WHERE folder_id = ? AND uid IS NOT NULL')
      .all(folderId) as Row[];
    return new Map(
      rows.map((row) => [Number(row.uid), { id: Number(row.id), messageId: Number(row.message_id), flags: JSON.parse(String(row.flags)) as string[] }]),
    );
  }

  findMessage(fingerprint: string): StoredMessage | undefined {
    const row = this.db.prepare('SELECT * FROM messages WHERE fingerprint = ?').get(fingerprint) as Row | undefined;
    return row ? toMessage(row) : undefined;
  }

  /** Links a message to a folder; reuses a link that lost its UID, so history is kept. */
  attach(folderId: number, messageId: number, uid: number, flags: string[]): void {
    const flagsJson = JSON.stringify(flags);
    this.db.prepare('UPDATE memberships SET uid = NULL WHERE folder_id = ? AND uid = ?').run(folderId, uid);
    const reusable = this.db
      .prepare(
        'SELECT id FROM memberships WHERE folder_id = ? AND message_id = ? AND uid IS NULL ORDER BY removed_at IS NOT NULL, id LIMIT 1',
      )
      .get(folderId, messageId) as Row | undefined;
    if (reusable) {
      this.db.prepare('UPDATE memberships SET uid = ?, flags = ?, removed_at = NULL WHERE id = ?').run(uid, flagsJson, Number(reusable.id));
    } else {
      this.db.prepare('INSERT INTO memberships (folder_id, message_id, uid, flags) VALUES (?, ?, ?, ?)').run(folderId, messageId, uid, flagsJson);
    }
  }

  updateFlags(membershipId: number, flags: string[]): void {
    this.db.prepare('UPDATE memberships SET flags = ? WHERE id = ?').run(JSON.stringify(flags), membershipId);
  }

  /** The message disappeared from the server. Its file stays: a backup keeps deleted mail. */
  markRemoved(membershipId: number): void {
    this.db.prepare('UPDATE memberships SET uid = NULL, removed_at = ? WHERE id = ?').run(new Date().toISOString(), membershipId);
  }

  /** The folder no longer exists on the server: all its messages count as removed there. */
  closeFolder(folderId: number): number {
    this.db.prepare('UPDATE folders SET removed_at = COALESCE(removed_at, ?) WHERE id = ?').run(new Date().toISOString(), folderId);
    const result = this.db
      .prepare('UPDATE memberships SET uid = NULL, removed_at = ? WHERE folder_id = ? AND removed_at IS NULL')
      .run(new Date().toISOString(), folderId);
    return Number(result.changes);
  }

  /** After a folder was scanned: links that did not get a UID back are gone from the server. */
  closeUnmatched(folderId: number): number {
    const result = this.db
      .prepare('UPDATE memberships SET removed_at = ? WHERE folder_id = ? AND uid IS NULL AND removed_at IS NULL')
      .run(new Date().toISOString(), folderId);
    return Number(result.changes);
  }

  activeCount(folderId: number): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM memberships WHERE folder_id = ? AND removed_at IS NULL').get(folderId) as Row;
    return Number(row.count);
  }

  /** Writes the .eml file, then records it in the index and links it to the folder in one step. */
  async writeMessage(input: {
    fingerprint: string;
    folder: StoredFolder;
    uid: number;
    flags: string[];
    content: Readable | Buffer;
    internalDate: Date | null;
    summary: HeaderSummary;
    emailId?: string | null;
    /** Called with the bytes written so far, for the progress of large messages. */
    onProgress?: (bytes: number) => void;
  }): Promise<StoredMessage> {
    const date = input.internalDate ?? (input.summary.date ? new Date(input.summary.date) : null);
    let file = `${input.folder.dir}/${messageFileName({ date, subject: input.summary.subject, fingerprint: input.fingerprint })}`;
    if (this.db.prepare('SELECT 1 FROM messages WHERE file_key = ?').get(key(file))) {
      file = `${input.folder.dir}/${messageFileName({ date, subject: input.summary.subject, fingerprint: input.fingerprint, hashLength: 64 })}`;
    }
    const absolute = join(this.root, MAIL_DIRECTORY, file);
    const partial = `${absolute}.part`;
    mkdirSync(dirname(absolute), { recursive: true });

    const hash = createHash('sha256');
    let size = 0;
    try {
      const handle = await open(partial, 'w');
      try {
        const chunks = Buffer.isBuffer(input.content) ? [input.content] : input.content;
        for await (const chunk of chunks) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          hash.update(buffer);
          size += buffer.length;
          await handle.write(buffer);
          input.onProgress?.(size);
        }
        // On disk before the index says so: after a power cut the index never points to an
        // empty file that no later run would download again.
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(partial, absolute);
      await syncDirectory(dirname(absolute));
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }

    const sha256 = hash.digest('hex');
    const id = this.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO messages (fingerprint, file, file_key, sha256, size, internal_date, header_date, subject, from_address, message_id_header, email_id, added_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.fingerprint,
          file,
          key(file),
          sha256,
          size,
          input.internalDate?.toISOString() ?? null,
          input.summary.date,
          input.summary.subject,
          input.summary.from,
          input.summary.messageId,
          input.emailId ?? null,
          new Date().toISOString(),
        );
      const messageId = Number(result.lastInsertRowid);
      this.attach(input.folder.id, messageId, input.uid, input.flags);
      return messageId;
    });
    return this.messageById(id);
  }

  private messageById(id: number): StoredMessage {
    return toMessage(this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Row);
  }

  messagePath(message: Pick<StoredMessage, 'file'>): string {
    return join(this.root, MAIL_DIRECTORY, message.file);
  }

  readMessage(message: Pick<StoredMessage, 'file'>): Promise<Buffer> {
    return readFile(this.messagePath(message));
  }

  allMessages(): StoredMessage[] {
    return (this.db.prepare('SELECT * FROM messages ORDER BY id').all() as Row[]).map(toMessage);
  }

  /**
   * Every message with the folders it belongs to, in the order folders were backed up. A folder
   * that held several copies of a message says how many; their flags are merged, those of
   * deleted copies only count when no copy is left.
   */
  restorableMessages(options: { includeRemoved?: boolean } = {}): RestorableMessage[] {
    const rows = this.db
      .prepare(
        `SELECT m.*, f.path AS folder_path, ms.flags AS membership_flags, ms.removed_at AS membership_removed
         FROM memberships ms
         JOIN messages m ON m.id = ms.message_id
         JOIN folders f ON f.id = ms.folder_id
         WHERE ms.removed_at IS NULL OR ?
         ORDER BY m.id, f.id, ms.removed_at IS NOT NULL`,
      )
      .all(options.includeRemoved ? 1 : 0) as Row[];
    const messages = new Map<number, RestorableMessage>();
    for (const row of rows) {
      const id = Number(row.id);
      let message = messages.get(id);
      if (!message) {
        message = { ...toMessage(row), placements: [] };
        messages.set(id, message);
      }
      const folder = String(row.folder_path);
      const flags = JSON.parse(String(row.membership_flags)) as string[];
      const removed = row.membership_removed !== null;
      let placement = message.placements.find((candidate) => candidate.folder === folder);
      if (!placement) {
        placement = { folder, flags: [], copies: 0, removed: true };
        message.placements.push(placement);
      }
      placement.copies++;
      if (removed && !placement.removed) continue;
      if (!removed && placement.removed) {
        placement.flags = [];
        placement.removed = false;
      }
      placement.flags = mergeFlags(placement.flags, flags);
    }
    return [...messages.values()];
  }

  /**
   * What left each folder of the account: per folder path, the fingerprints of messages that
   * were in it and of which no copy is left there. A message moved to another folder shows up
   * here under the folder it left. A sync takes these out of the target.
   */
  removedFrom(): Map<string, Set<string>> {
    const rows = this.db
      .prepare(
        `SELECT f.path AS folder_path, m.fingerprint AS fingerprint
         FROM memberships ms
         JOIN messages m ON m.id = ms.message_id
         JOIN folders f ON f.id = ms.folder_id
         GROUP BY ms.folder_id, ms.message_id
         HAVING SUM(ms.removed_at IS NULL) = 0`,
      )
      .all() as Row[];
    const removed = new Map<string, Set<string>>();
    for (const row of rows) {
      const folder = String(row.folder_path);
      let fingerprints = removed.get(folder);
      if (!fingerprints) {
        fingerprints = new Set();
        removed.set(folder, fingerprints);
      }
      fingerprints.add(String(row.fingerprint));
    }
    return removed;
  }

  /**
   * Marks a backup run as begun; `recordRun` ends it. A run that never gets that far (a crash, a
   * power cut) leaves the mark, so nobody takes its half-done state for a finished one.
   */
  beginRun(): void {
    this.setMeta(RUN_UNFINISHED, new Date().toISOString());
  }

  recordRun(report: Report): void {
    this.transaction(() => {
      this.db
        .prepare('INSERT INTO runs (kind, status, started_at, finished_at, report) VALUES (?, ?, ?, ?, ?)')
        .run(report.kind, report.status, report.startedAt, report.finishedAt, JSON.stringify(report));
      this.db.prepare('DELETE FROM meta WHERE key = ?').run(RUN_UNFINISHED);
    });
  }

  /** Whether the last backup run got through: recorded as completed, and none begun since. */
  lastRunCompleted(): boolean {
    return this.getMeta(RUN_UNFINISHED) === null && this.lastRunReport()?.status === 'completed';
  }

  /** The report of the last backup run, as it was recorded. */
  lastRunReport(): Report | null {
    const row = this.db.prepare('SELECT report FROM runs ORDER BY id DESC LIMIT 1').get() as Row | undefined;
    return row ? (JSON.parse(String(row.report)) as Report) : null;
  }

  summary(): BackupSummary {
    const counts = this.db.prepare('SELECT COUNT(*) AS messages, COALESCE(SUM(size), 0) AS bytes FROM messages').get() as Row;
    const folders = this.db.prepare('SELECT COUNT(*) AS count FROM folders').get() as Row;
    const lastRun = this.db.prepare('SELECT kind, status, finished_at FROM runs ORDER BY id DESC LIMIT 1').get() as Row | undefined;
    const host = this.getMeta('account.host');
    const user = this.getMeta('account.user');
    return {
      folders: Number(folders.count),
      messages: Number(counts.messages),
      bytes: Number(counts.bytes),
      lastRun: lastRun
        ? { kind: String(lastRun.kind) as Report['kind'], status: String(lastRun.status) as Report['status'], finishedAt: String(lastRun.finished_at) }
        : null,
      account: host !== null && user !== null ? { host, user } : null,
    };
  }
}
