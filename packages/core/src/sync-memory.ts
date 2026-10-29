import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AccountConfig } from './types.ts';

const SCHEMA_VERSION = 1;
const BUSY_TIMEOUT_MS = 10_000;

const TABLES = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS seen (
  folder TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  PRIMARY KEY (folder, fingerprint)
) WITHOUT ROWID;
`;

/** The two accounts a memory belongs to. */
export interface SyncPair {
  source: Pick<AccountConfig, 'user' | 'host'>;
  target: Pick<AccountConfig, 'user' | 'host'>;
}

type Row = Record<string, unknown>;

const ownerOf = (pair: SyncPair): Record<string, string> => ({
  'source.user': pair.source.user.toLowerCase(),
  'source.host': pair.source.host.toLowerCase(),
  'target.user': pair.target.user.toLowerCase(),
  'target.host': pair.target.host.toLowerCase(),
});

/** Set once the memory holds what a run saw: from then on a sync can tell what left the source. */
const REMEMBERED = 'remembered.at';

function metaOf(db: DatabaseSync): Map<string, string> {
  return new Map((db.prepare('SELECT key, value FROM meta').all() as Row[]).map((row) => [String(row.key), String(row.value)]));
}

const belongsTo = (meta: Map<string, string>, pair: SyncPair) => Object.entries(ownerOf(pair)).every(([key, value]) => meta.get(key) === value);

/**
 * What a migration saw in the source account, folder by folder: the fingerprints of the messages
 * each folder held. A sync compares it with the source as it is now: a message the memory knows
 * and the folder no longer holds was deleted or moved there since, and leaves the target too.
 * Mail the memory never saw, such as mail that arrived in the target itself, is never touched.
 *
 * One memory belongs to one pair of accounts. Opened for another pair, it starts afresh: what one
 * source held says nothing about another, and deleting by it would hit the wrong mail.
 */
export class SyncMemory {
  private readonly db: DatabaseSync;
  /** The file held the memory of another pair of accounts; it starts afresh. */
  readonly reset: boolean;

  private constructor(db: DatabaseSync, reset: boolean) {
    this.db = db;
    this.reset = reset;
  }

  /** Opens the memory for this pair of accounts, and creates it with its folder when missing. */
  static open(file: string, pair: SyncPair): SyncMemory {
    mkdirSync(dirname(file), { recursive: true });
    const db = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS });
    try {
      const version = Number((db.prepare('PRAGMA user_version').get() as Row).user_version);
      if (version > SCHEMA_VERSION) throw new Error(`The sync memory ${file} was written by a newer version of imaptransfer`);
      db.exec(TABLES);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      const meta = metaOf(db);
      let reset = false;
      if (!belongsTo(meta, pair)) {
        reset = meta.size > 0;
        db.exec('BEGIN');
        try {
          db.exec('DELETE FROM seen');
          db.exec('DELETE FROM meta');
          const insert = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
          for (const [key, value] of Object.entries(ownerOf(pair))) insert.run(key, value);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      }
      return new SyncMemory(db, reset);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  /** Whether the file holds what an earlier run of this pair saw, without changing anything. */
  static knows(file: string, pair: SyncPair): boolean {
    if (!existsSync(file)) return false;
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(file, { readOnly: true, timeout: BUSY_TIMEOUT_MS });
      const meta = metaOf(db);
      return belongsTo(meta, pair) && meta.has(REMEMBERED);
    } catch {
      // Damaged or from a newer version: nothing a plan can rely on.
      return false;
    } finally {
      db?.close();
    }
  }

  /** Whether an earlier run already recorded what it saw. */
  get remembers(): boolean {
    return metaOf(this.db).has(REMEMBERED);
  }

  /** The fingerprints the folder held, as far as the memory knows. */
  seen(folder: string): Set<string> {
    const rows = this.db.prepare('SELECT fingerprint FROM seen WHERE folder = ?').all(folder) as Row[];
    return new Set(rows.map((row) => String(row.fingerprint)));
  }

  /** Replaces what the memory holds for these folders, all of them at once or none. */
  remember(folders: Map<string, Set<string>>): void {
    this.db.exec('BEGIN');
    try {
      const clear = this.db.prepare('DELETE FROM seen WHERE folder = ?');
      const insert = this.db.prepare('INSERT OR IGNORE INTO seen (folder, fingerprint) VALUES (?, ?)');
      for (const [folder, fingerprints] of folders) {
        clear.run(folder);
        for (const fingerprint of fingerprints) insert.run(folder, fingerprint);
      }
      this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(REMEMBERED, new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
