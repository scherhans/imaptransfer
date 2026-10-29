import { once } from 'node:events';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { finished } from 'node:stream/promises';
import { Job } from './job.ts';
import { BackupStore } from './store/store.ts';
import type { JobOptions } from './types.ts';

export interface MboxExportOptions extends JobOptions {
  /** Also export mail that was deleted in the account after it had been backed up. */
  includeRemoved?: boolean;
}

export interface MboxExportReport {
  files: string[];
  messages: number;
  cancelled: boolean;
}

const ASCTIME_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ASCTIME_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function asctime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${ASCTIME_DAYS[date.getUTCDay()]} ${ASCTIME_MONTHS[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, ' ')} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ${date.getUTCFullYear()}`;
}

/**
 * Turns one message into an mboxrd entry: a "From " separator line, a Status header for read
 * mail, Unix line endings and every line starting with ">*From " quoted once more.
 */
export function toMboxEntry(content: Buffer, options: { date: Date | null; seen: boolean }): string {
  const text = content.toString('latin1').replace(/\r\n/g, '\n');
  const quoted = text.replace(/^(>*From )/gm, '>$1');
  const status = options.seen ? 'Status: RO\n' : '';
  const body = quoted.endsWith('\n') ? quoted : `${quoted}\n`;
  return `From MAILER-DAEMON ${asctime(options.date ?? new Date(0))}\n${status}${body}\n`;
}

/** Writes one .mbox file per folder, for import into Thunderbird, Apple Mail and others. */
export async function exportMbox(directory: string, outputDirectory: string, options: MboxExportOptions = {}): Promise<MboxExportReport> {
  const job = new Job('backup', options);
  const store = BackupStore.open(directory, { readOnly: true });
  const report: MboxExportReport = { files: [], messages: 0, cancelled: false };
  try {
    const folders = new Map(store.folders().map((folder) => [folder.path, folder]));
    const messages = store.restorableMessages({ includeRemoved: options.includeRemoved ?? false });
    const byFolder = new Map<string, { message: (typeof messages)[number]; seen: boolean }[]>();
    for (const message of messages) {
      // Like a restore: "All Mail" only for messages that are in no other folder.
      const inRealFolder = message.placements.some((placement) => folders.get(placement.folder)?.role === 'normal');
      for (const placement of message.placements) {
        const role = folders.get(placement.folder)?.role;
        if (role === 'view' || (role === 'all' && inRealFolder)) continue;
        const list = byFolder.get(placement.folder) ?? [];
        // Every copy, as the folder held it.
        for (let copy = 0; copy < placement.copies; copy++) list.push({ message, seen: placement.flags.some((flag) => flag.toLowerCase() === '\\seen') });
        byFolder.set(placement.folder, list);
      }
    }
    job.setTotal([...byFolder.values()].reduce((sum, list) => sum + list.length, 0));

    for (const [path, entries] of byFolder) {
      const folder = folders.get(path);
      if (!folder) continue;
      const file = join(outputDirectory, `${folder.dir}.mbox`);
      mkdirSync(dirname(file), { recursive: true });
      const out = createWriteStream(file, { encoding: 'latin1' });
      try {
        for (const { message, seen } of entries) {
          if (job.aborted) break;
          let content: Buffer;
          try {
            content = await store.readMessage(message);
          } catch (error) {
            // A file someone deleted from the backup: the export goes on, like `verify` does.
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            job.warn(`Missing in the backup: ${message.file}`, { folder: path, subject: message.subject });
            job.advance();
            continue;
          }
          const date = message.internalDate ? new Date(message.internalDate) : null;
          if (!out.write(toMboxEntry(content, { date, seen }), 'latin1')) {
            await once(out, 'drain');
          }
          report.messages++;
          job.advance(1, content.length);
        }
      } finally {
        out.end();
      }
      await finished(out);
      report.files.push(file);
      if (job.aborted) {
        report.cancelled = true;
        break;
      }
    }
    return report;
  } finally {
    store.close();
  }
}
