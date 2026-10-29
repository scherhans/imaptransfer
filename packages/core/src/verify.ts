import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { Job } from './job.ts';
import { BackupStore } from './store/store.ts';
import type { JobOptions } from './types.ts';

export interface VerifyReport {
  messages: number;
  ok: number;
  missing: string[];
  damaged: string[];
  cancelled: boolean;
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Reads every file of a backup and compares it with the checksum taken when it was saved. */
export async function verifyBackup(directory: string, options: JobOptions = {}): Promise<VerifyReport> {
  const job = new Job('backup', options);
  const store = BackupStore.open(directory, { readOnly: true });
  const report: VerifyReport = { messages: 0, ok: 0, missing: [], damaged: [], cancelled: false };
  try {
    const messages = store.allMessages();
    report.messages = messages.length;
    job.setTotal(messages.length);
    for (const message of messages) {
      if (job.aborted) {
        report.cancelled = true;
        break;
      }
      try {
        if ((await sha256Of(store.messagePath(message))) === message.sha256) report.ok++;
        else report.damaged.push(message.file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        report.missing.push(message.file);
      }
      job.advance(1, message.size);
    }
    return report;
  } finally {
    store.close();
  }
}
