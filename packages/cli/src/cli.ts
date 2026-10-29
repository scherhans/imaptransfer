import {
  authorizeInteractive,
  backupAccount,
  CancelledError,
  exportMbox,
  findDuplicates,
  inspectAccount,
  microsoftProvider,
  migrateAccount,
  planMigration,
  planRestore,
  PROVIDERS,
  removeDuplicates,
  restoreBackup,
  verifyBackup,
  VERSION,
  type Report,
  type TransferPlan,
} from '@imaptransfer/core';
import { Argument, Command, CommanderError, Option } from 'commander';
import { addAccountOptions, resolveAccount, UsageError, writeTokenFile } from './account.ts';
import { openInBrowser } from './browser.ts';
import { exitCode, finishProgress, printDuplicatePlan, printPlan, printReport, progressPrinter } from './output.ts';
import { defaultSyncState } from './state.ts';

/** Ctrl+C stops gracefully at the next message; a second Ctrl+C quits at once. */
function cancellation(): AbortSignal {
  const controller = new AbortController();
  process.once('SIGINT', () => {
    process.stderr.write('\nStopping after the current message … (Ctrl+C again to quit immediately)\n');
    controller.abort();
    process.once('SIGINT', () => process.exit(130));
  });
  return controller.signal;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
/** Exits once everything written has left the process: a pipe takes stdout asynchronously. */
function exitAfterOutput(code: number): void {
  process.stdout.write('', () => process.exit(code));
}

function finish(report: Report, json: boolean): void {
  finishProgress();
  if (json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  exitAfterOutput(exitCode(report));
}

/** A dry run's plan, as a table or as JSON for scripts. */
function printDryRun(plan: TransferPlan, json: boolean, sync: boolean): void {
  if (json) console.log(JSON.stringify(plan, null, 2));
  else printPlan(plan, sync);
}

const program = new Command()
  .name('imaptransfer')
  .description('Back up, restore and migrate IMAP mail accounts.')
  .version(VERSION)
  .showHelpAfterError()
  // Wrong arguments are exit code 64, like every other usage error; help and version are 0.
  .exitOverride();

addAccountOptions(
  program
    .command('backup')
    .description('back up an account into a folder; later runs only fetch what is new')
    .argument('<directory>', 'backup folder (one per account)')
    .option('--exclude <folder>', 'leave out a folder (repeatable)', collect, [])
    .option('--json', 'print the report as JSON')
    .option('--quiet', 'no progress output'),
).action(async (directory: string, options: Record<string, unknown>) => {
  const account = await resolveAccount(options);
  const report = await backupAccount(account, directory, {
    excludeFolders: options.exclude as string[],
    signal: cancellation(),
    onProgress: progressPrinter(Boolean(options.quiet)),
  });
  finish(report, Boolean(options.json));
});

addAccountOptions(
  program
    .command('restore')
    .description('upload a backup into an account; mail that is already there is skipped')
    .argument('<directory>', 'backup folder')
    .option('--include-deleted', 'also restore mail that was deleted in the account after the backup')
    .option(
      '--sync',
      'sync the account with the backup, one way: mail deleted or moved in the backed-up account after the backup also leaves the target (into the trash), read/flagged state follows the backup; mail the backup never held stays',
    )
    .option('--exclude <folder>', 'leave out a backup folder (repeatable)', collect, [])
    .option('--dry-run', 'only show where each folder would go')
    .option('--json', 'print the report as JSON')
    .option('--quiet', 'no progress output'),
  '',
  'the target account',
).action(async (directory: string, options: Record<string, unknown>) => {
  const sync = Boolean(options.sync);
  if (sync && options.includeDeleted) throw new UsageError('--sync and --include-deleted do not go together: a sync takes deleted mail out of the account.');
  const account = await resolveAccount(options);
  const filters = { excludeFolders: options.exclude as string[], includeRemoved: Boolean(options.includeDeleted) };
  if (options.dryRun) {
    printDryRun(await planRestore(directory, account, filters), Boolean(options.json), sync);
    return;
  }
  const report = await restoreBackup(directory, account, { ...filters, sync, signal: cancellation(), onProgress: progressPrinter(Boolean(options.quiet)) });
  finish(report, Boolean(options.json));
});

const migrate = program
  .command('migrate')
  .description('copy every folder of one account into another, server to server; the source account is only read, nothing there is deleted or changed')
  .option('--exclude <folder>', 'leave out a source folder (repeatable)', collect, [])
  .option(
    '--sync',
    'keep the target in step with the source, one way: what left the source since the last run also leaves the target (into the trash), read/flagged state follows the source; mail only the target has stays',
  )
  .option('--sync-state <file>', 'where syncs of these two accounts remember what the source held (default: one file per pair in your data folder)')
  .option('--dry-run', 'only show where each folder would go')
  .option('--json', 'print the report as JSON')
  .option('--quiet', 'no progress output');
addAccountOptions(migrate, 'from', 'the source account');
addAccountOptions(migrate, 'to', 'the target account');
migrate.action(async (options: Record<string, unknown>) => {
  const from = await resolveAccount(options, 'from');
  const to = await resolveAccount(options, 'to');
  const sync = Boolean(options.sync);
  // A run without --sync only keeps the memory when asked to; a sync always has one.
  const memory = (options.syncState as string | undefined) ?? (sync ? defaultSyncState(from, to) : undefined);
  if (options.dryRun) {
    printDryRun(await planMigration(from, to, { excludeFolders: options.exclude as string[], ...(memory ? { memory } : {}) }), Boolean(options.json), sync);
    return;
  }
  const report = await migrateAccount(from, to, {
    excludeFolders: options.exclude as string[],
    sync,
    ...(memory ? { memory } : {}),
    signal: cancellation(),
    onProgress: progressPrinter(Boolean(options.quiet)),
  });
  finish(report, Boolean(options.json));
});

addAccountOptions(
  program
    .command('dedupe')
    .description('move exact copies of a message within one folder to the trash; one copy of each stays')
    .option('--exclude <folder>', 'leave a folder as it is (repeatable)', collect, [])
    .option('--dry-run', 'test run: list the copies in each folder without changing anything')
    .option('--json', 'print the report (or the test run) as JSON')
    .option('--quiet', 'no progress output'),
).action(async (options: Record<string, unknown>) => {
  const account = await resolveAccount(options);
  if (options.dryRun) {
    const plan = await findDuplicates(account, { excludeFolders: options.exclude as string[] });
    if (options.json) console.log(JSON.stringify(plan, null, 2));
    else printDuplicatePlan(plan);
    return;
  }
  const report = await removeDuplicates(account, {
    excludeFolders: options.exclude as string[],
    signal: cancellation(),
    onProgress: progressPrinter(Boolean(options.quiet)),
  });
  finish(report, Boolean(options.json));
});

addAccountOptions(program.command('folders').description('list the folders of an account with message counts')).action(
  async (options: Record<string, unknown>) => {
    const layout = await inspectAccount(await resolveAccount(options));
    for (const folder of layout.folders) {
      const notes = [folder.specialUse, folder.role !== 'normal' ? `${folder.role}, ${folder.role === 'view' ? 'skipped' : 'only unique mail restored'}` : null, folder.selectable ? null : 'not selectable']
        .filter(Boolean)
        .join(', ');
      console.log(`${String(folder.messages ?? '-').padStart(7)}  ${folder.path}${notes ? `  (${notes})` : ''}`);
    }
    console.log(`\nGmail: ${layout.gmail ? 'yes' : 'no'}, server-side copy (UIDPLUS): ${layout.uidplus ? 'yes' : 'no'}`);
  },
);

program
  .command('verify')
  .description('check every file of a backup against its checksum')
  .argument('<directory>', 'backup folder')
  .action(async (directory: string) => {
    const report = await verifyBackup(directory, { signal: cancellation(), onProgress: progressPrinter(false) });
    finishProgress();
    console.log(`${report.ok} of ${report.messages} messages are intact.`);
    for (const file of report.missing) console.log(`  missing: ${file}`);
    for (const file of report.damaged) console.log(`  damaged: ${file}`);
    exitAfterOutput(report.missing.length + report.damaged.length > 0 ? 1 : report.cancelled ? 130 : 0);
  });

program
  .command('export-mbox')
  .description('write one .mbox file per folder, for Thunderbird, Apple Mail and others')
  .argument('<directory>', 'backup folder')
  .argument('<output>', 'folder for the .mbox files')
  .option('--include-deleted', 'also export mail that was deleted in the account after the backup')
  .action(async (directory: string, output: string, options: { includeDeleted?: boolean }) => {
    const report = await exportMbox(directory, output, {
      includeRemoved: Boolean(options.includeDeleted),
      signal: cancellation(),
      onProgress: progressPrinter(false),
    });
    finishProgress();
    console.log(`${report.messages} messages written to ${report.files.length} files in ${output}.`);
    exitAfterOutput(report.cancelled ? 130 : 0);
  });

program
  .command('login')
  .description('sign in with Microsoft (Outlook.com, Hotmail, Microsoft 365) and save the sign-in to a file')
  .addArgument(new Argument('<provider>', 'only "microsoft" is supported').choices(['microsoft']))
  .requiredOption('--token-file <path>', 'where to save the sign-in (keep this file private)')
  .addOption(new Option('--client-id <id>', 'Azure app registration client ID').env('IMAPTRANSFER_MICROSOFT_CLIENT_ID'))
  .option('--tenant <tenant>', 'Azure tenant', 'common')
  .option('--user <address>', 'pre-fill the address on the sign-in page')
  .action(async (_provider: string, options: { tokenFile: string; clientId?: string; tenant: string; user?: string }) => {
    if (!options.clientId) {
      throw new UsageError(
        'Microsoft sign-in needs an app registration. Set IMAPTRANSFER_MICROSOFT_CLIENT_ID or pass --client-id (see docs/microsoft-oauth.md).',
      );
    }
    const provider = microsoftProvider(options.clientId, options.tenant);
    const tokens = await authorizeInteractive(provider, {
      ...(options.user ? { loginHint: options.user } : {}),
      signal: cancellation(),
      openBrowser: (url) => {
        console.error(`Opening the Microsoft sign-in page. If no browser opens, visit:\n${url}\n`);
        openInBrowser(url);
      },
    });
    writeTokenFile(options.tokenFile, { provider: 'microsoft', clientId: options.clientId, tenant: options.tenant, ...tokens });
    console.log(`Signed in${tokens.email ? ` as ${tokens.email}` : ''}. Saved to ${options.tokenFile}.`);
  });

program
  .command('providers')
  .description('list the providers imaptransfer knows')
  .action(() => {
    for (const provider of PROVIDERS) {
      const auth = provider.auth === 'oauth-microsoft' ? 'Microsoft sign-in' : provider.auth === 'app-password' ? 'app password' : 'password';
      console.log(`${provider.id.padEnd(12)} ${provider.name.padEnd(40)} ${provider.host}:${provider.port}  ${auth}`);
    }
  });

try {
  await program.parseAsync();
} catch (error) {
  finishProgress();
  if (error instanceof CommanderError) {
    // commander already printed its message; help and version are not errors.
    exitAfterOutput(error.exitCode === 0 ? 0 : 64);
  } else if (error instanceof UsageError) {
    console.error(`imaptransfer: ${error.message}`);
    exitAfterOutput(64);
  } else if (error instanceof CancelledError) {
    exitAfterOutput(130);
  } else {
    console.error(`imaptransfer: ${error instanceof Error ? error.message : String(error)}`);
    exitAfterOutput(1);
  }
}
