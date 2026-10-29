import { DUPLICATE_PROBLEMS, roundRemaining, SYNC_PROBLEMS, type DuplicatePlan, type Phase, type ProgressEvent, type Report, type TransferPlan } from '@imaptransfer/core';

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function table(rows: string[][], alignRight: Set<number>): string {
  const widths = rows[0]?.map((_, column) => Math.max(...rows.map((row) => [...(row[column] ?? '')].length))) ?? [];
  return rows
    .map((row) =>
      row
        .map((cell, column) => {
          const pad = ' '.repeat((widths[column] ?? 0) - [...cell].length);
          return alignRight.has(column) ? pad + cell : cell + pad;
        })
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

const PHASES: Record<Phase, string> = {
  connect: 'Connecting',
  scan: 'Reading folders',
  transfer: 'Transferring',
  copy: 'Copying between folders',
  sync: 'Taking out of the target what left the source',
  clean: 'Cleaning up copies',
  finish: 'Finishing',
};

export function formatRemaining(seconds: number | null): string {
  const time = roundRemaining(seconds);
  switch (time.kind) {
    case 'calculating':
      return 'estimating time left';
    case 'under-a-minute':
      return 'less than a minute left';
    case 'minutes':
      return `about ${time.minutes} min left`;
    case 'hours':
      return time.minutes > 0 ? `about ${time.hours} h ${time.minutes} min left` : `about ${time.hours} h left`;
  }
}

type ProgressUpdate = Extract<ProgressEvent, { type: 'progress' }>;
type MessageUpdate = Extract<ProgressEvent, { type: 'message' }>;

/** Live progress: one updating line on a terminal, plain lines in logs (cron). */
export function progressPrinter(quiet: boolean): (event: ProgressEvent) => void {
  const tty = process.stderr.isTTY === true;
  let folder = '';
  let lastLine = '';
  let progress: ProgressUpdate | null = null;
  let current: MessageUpdate | null = null;
  const write = (line: string) => {
    if (tty) {
      process.stderr.write(`\r\x1b[2K${line.slice(0, (process.stderr.columns ?? 100) - 1)}`);
      lastLine = line;
    } else {
      process.stderr.write(`${line}\n`);
    }
  };
  const newline = () => {
    if (tty && lastLine) {
      process.stderr.write('\n');
      lastLine = '';
    }
  };
  const redraw = () => {
    if (!tty || !progress) return;
    const percent = progress.total > 0 ? Math.floor((progress.done / progress.total) * 100) : 0;
    const parts = [`${percent}%`, `${progress.done}/${progress.total} messages`, formatBytes(progress.bytes)];
    if (progress.remainingMessages > 0) parts.push(formatRemaining(progress.remainingSeconds));
    if (current) {
      const arrow = current.direction === 'download' ? '↓' : '↑';
      parts.push(`${arrow} ${formatBytes(current.transferred)}/${formatBytes(current.size)}${current.subject ? ` "${current.subject}"` : ''}`);
    } else {
      parts.push(folder);
    }
    write(parts.join('  '));
  };
  return (event) => {
    if (quiet) return;
    switch (event.type) {
      case 'phase':
        if (event.phase !== 'finish') write(`${PHASES[event.phase] ?? event.phase} …`);
        break;
      case 'folder':
        folder = `${event.path} (${event.index + 1}/${event.count})`;
        if (!tty) write(`  ${folder}`);
        break;
      case 'progress':
        progress = event;
        redraw();
        break;
      case 'message':
        current = event.finished ? null : event;
        redraw();
        break;
      case 'warning':
        newline();
        process.stderr.write(`  ! ${event.folder ? `${event.folder}: ` : ''}${event.subject ? `"${event.subject}": ` : ''}${event.message}\n`);
        break;
      case 'retry':
        newline();
        process.stderr.write(`  ~ Connection problem (${event.reason}), retrying in ${Math.round(event.delayMs / 1000)}s (attempt ${event.attempt + 1})\n`);
        break;
    }
  };
}

export function finishProgress(): void {
  if (process.stderr.isTTY) process.stderr.write('\r\x1b[2K');
}

const TITLES: Record<Report['kind'], string> = { backup: 'Backup', restore: 'Restore', migrate: 'Migration', dedupe: 'Cleanup' };
const ERROR_HINTS: Record<string, string> = {
  auth: 'The server refused the login. Check user name and password (or app password).',
  tls: 'The secure connection failed. Check host and port, or use --insecure for a self-signed certificate.',
  connection: 'The server could not be reached. Check host, port and network.',
  quota: 'The provider limits how much can be transferred per day. Run the same command again later; it continues where it stopped.',
  throttle: 'The server kept asking to slow down. Run the same command again later; it continues where it stopped.',
  storage: 'The disk or the backup folder cannot take more (full, read-only or unreachable). Make room or reconnect it, then run the same command again.',
};

export function printReport(report: Report): void {
  const duration = formatDuration(Date.parse(report.finishedAt) - Date.parse(report.startedAt));
  const status = report.status === 'completed' ? 'completed' : report.status === 'cancelled' ? 'stopped' : 'failed';
  console.log(`${TITLES[report.kind]} ${status} after ${duration}.`);
  if (report.error) {
    console.log(`  ${report.error.message}`);
    const hint = ERROR_HINTS[report.error.kind];
    if (hint) console.log(`  ${hint}`);
  }
  if (report.kind === 'dedupe') {
    printCleanup(report);
    return;
  }
  if (report.folders.length > 0) {
    const transfer = report.kind !== 'backup';
    // Only a sync takes mail out of the target; the column is there once it did.
    const removed = report.totals.removed > 0;
    const header = transfer
      ? ['Folder', 'Target', 'Messages', 'New', 'Present', 'Failed', ...(removed ? ['Removed'] : [])]
      : ['Folder', 'On server', 'In backup', 'New', 'Present', 'Failed'];
    const rows = report.folders.map((folder) =>
      transfer
        ? [
            folder.path,
            folder.target ?? '',
            String(folder.sourceCount),
            String(folder.transferred),
            String(folder.skipped),
            String(folder.failed),
            ...(removed ? [String(folder.removed)] : []),
          ]
        : [folder.path, String(folder.sourceCount), String(folder.targetCount ?? ''), String(folder.transferred), String(folder.skipped), String(folder.failed)],
    );
    console.log('');
    console.log(table([header, ...rows], new Set([2, 3, 4, 5].concat(transfer ? (removed ? [6] : []) : [1]))));
  }
  const { totals } = report;
  if (report.folders.length === 0 && report.status !== 'completed') return;
  console.log('');
  const note = totals.deduplicated > 0 ? `, ${totals.deduplicated} found in several folders and transferred once` : '';
  const removedNote = totals.removed > 0 ? `, ${totals.removed} that left the source taken out of the target` : '';
  console.log(`${totals.transferred} new (${formatBytes(totals.bytes)}), ${totals.skipped} already present, ${totals.failed} failed${note}${removedNote}.`);
  if (report.kind === 'migrate') console.log('The source account was only read: nothing there was deleted or changed.');
  printSkippedFolders(report);
  if (report.failures.length > 0) {
    console.log('\nNot transferred:');
    for (const failure of report.failures.slice(0, 50)) {
      console.log(`  ${failure.folder}: "${failure.subject ?? '(no subject)'}"${failure.date ? ` (${failure.date.slice(0, 10)})` : ''}: ${failure.reason}`);
    }
    if (report.failures.length > 50) console.log(`  … and ${report.failures.length - 50} more (use --json for the full list)`);
  }
}

function printSkippedFolders(report: Report): void {
  const skippedFolders = report.folders.filter((folder) => folder.error);
  if (skippedFolders.length > 0) {
    console.log('\nFolders skipped (the next run tries again):');
    for (const folder of skippedFolders) console.log(`  ${folder.path}: ${folder.error}`);
  }
}

function copiesWent(trash: string | null): string {
  return `moved to ${trash ?? 'the trash'}`;
}

function printCleanup(report: Report): void {
  const cleaned = report.folders.filter((folder) => folder.transferred > 0 || folder.error);
  if (cleaned.length > 0) {
    const rows = cleaned.map((folder) => [folder.path, String(folder.sourceCount), String(folder.transferred)]);
    console.log('');
    console.log(table([['Folder', 'Messages', 'Copies removed'], ...rows], new Set([1, 2])));
  }
  if (report.status !== 'completed' && report.folders.length === 0) return;
  console.log('');
  console.log(
    report.totals.transferred > 0
      ? `${report.totals.transferred} copies ${copiesWent(report.folders.find((folder) => folder.transferred > 0)?.target ?? null)}; one of each stays.`
      : 'No copies found.',
  );
  printSkippedFolders(report);
}

/** How many messages with copies a test run lists per folder; --json has them all. */
const LISTED_PER_FOLDER = 10;

export function printDuplicatePlan(plan: DuplicatePlan): void {
  const affected = plan.folders.filter((folder) => folder.duplicates > 0);
  if (affected.length > 0) {
    console.log(table([['Folder', 'Messages', 'Copies'], ...affected.map((folder) => [folder.path, String(folder.messages), String(folder.duplicates)])], new Set([1, 2])));
    for (const folder of affected) {
      console.log(`\n${folder.path}:`);
      for (const message of folder.duplicated.slice(0, LISTED_PER_FOLDER)) {
        console.log(`  ${message.copies}x  ${message.date?.slice(0, 10) ?? '          '}  ${message.subject ?? '(no subject)'}${message.from ? `  (${message.from})` : ''}`);
      }
      const more = folder.duplicated.length - LISTED_PER_FOLDER;
      if (more > 0) console.log(`  … and ${more} more (use --json for the full list)`);
    }
    console.log('');
  }
  console.log(plan.duplicates > 0 ? `${plan.duplicates} copies would be ${copiesWent(plan.trash)}; one of each stays.` : 'No copies found.');
  if (plan.similar > 0) console.log(`${plan.similar} messages look like another one but differ in size; they stay as they are.`);
  if (plan.problem) console.log(`Cleanup is not possible here: ${DUPLICATE_PROBLEMS[plan.problem]}`);
  console.log('Test run: nothing was changed. Run without --dry-run to clean up.');
}

export function printPlan(plan: TransferPlan, sync = false): void {
  const rows = plan.mappings.map((mapping) => [mapping.source, '→', mapping.target + (mapping.exists ? '' : '  (new)'), String(mapping.messages)]);
  console.log(table([['Source', '', 'Target', 'Messages'], ...rows], new Set([3])));
  console.log(`\n${plan.messages} messages.`);
  if (sync) {
    if (plan.target.syncProblem) console.log(`A sync is not possible here: ${SYNC_PROBLEMS[plan.target.syncProblem]}`);
    else if (!plan.history) console.log('First sync: it remembers what the source holds and takes nothing out of the target yet. From the next sync on, what left the source leaves the target too.');
    else if (plan.removed > 0) console.log(`${plan.removed} messages were deleted in the account after the backup; the sync moves them to the trash where the target has them.`);
  } else if (plan.removed > 0) {
    console.log(`${plan.removed} more messages were deleted in the account after the backup; add --include-deleted to restore them too.`);
  }
  console.log('Nothing was changed (dry run).');
}

export function exitCode(report: Report): number {
  if (report.status === 'cancelled') return 130;
  if (report.status === 'failed') return 1;
  return report.totals.failed > 0 ? 2 : 0;
}
