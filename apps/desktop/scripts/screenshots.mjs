// Screenshots of the built app, light and at twice their size, with example data only: accounts on
// example.* servers, no provider, no real mail. No mail server is involved either; plans, test runs
// and job states are fixed answers.
//
//   pnpm build
//   pnpm --filter imaptransfer-desktop screenshots docs          docs/screenshots/, English
//   pnpm --filter imaptransfer-desktop screenshots website en    apps/website/assets/img/en/
//   pnpm --filter imaptransfer-desktop screenshots website de    apps/website/assets/img/de/
//
// Inside VS Code's terminal, unset ELECTRON_RUN_AS_NODE first (see CONTRIBUTING.md).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const [target = '', lang = 'en'] = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
if (!['docs', 'website'].includes(target) || !['en', 'de'].includes(lang) || (target === 'docs' && lang !== 'en')) {
  console.error('Usage: screenshots docs | screenshots website <en|de>');
  process.exit(2);
}
const docs = target === 'docs';
const de = lang === 'de';
const out = docs ? join(root, 'docs', 'screenshots') : join(root, 'apps', 'website', 'assets', 'img', lang);
const { roundRemaining } = await import(join(root, 'packages', 'core', 'dist', 'estimate.js'));

const data = mkdtempSync(join(tmpdir(), 'imaptransfer-screenshots-'));
app.setPath('userData', join(data, 'user'));
app.setPath('documents', join(data, 'documents'));
app.commandLine.appendSwitch('lang', de ? 'de-DE' : 'en-US');
app.commandLine.appendSwitch('use-mock-keychain');
app.commandLine.appendSwitch('password-store', 'basic');
mkdirSync(join(data, 'user'), { recursive: true });
writeFileSync(join(data, 'user', 'settings.json'), JSON.stringify({ version: 1, theme: 'light', language: lang, accountOrder: 'address' }));

/** The same address at two servers, as before a move, and a third account. */
const OLD = { user: 'kontakt@example.org', host: 'imap.example.net' };
const NEW = { user: 'kontakt@example.org', host: 'mail.example.org' };
const OTHER = { user: 'anna@example.com', host: 'mail.example.com' };

const words = de
  ? { archive: 'Archiv', invoices: 'Rechnungen', sent: 'Gesendet', sentTarget: 'Gesendete Elemente', cont: 'Weiter', cancel: 'Abbrechen' }
  : { archive: 'Archive', invoices: 'Invoices', sent: 'Sent', sentTarget: 'Sent Items', quote: 'Quote for the kitchen', shipped: 'Your order has shipped', plan: 'Floor plan ground floor.pdf', cont: 'Continue', test: 'Start test run', cancel: 'Cancel', trash: 'Trash' };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let window;
const js = (code) => window.webContents.executeJavaScript(code);
async function waitFor(code, timeout = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await js(code)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${code}`);
}

/** Photographs the whole window, or one element with a margin of `pad` pixels around it. */
async function shot(name, selector = null, pad = 0) {
  // A focus ring from a dialog opening is no part of the picture.
  await js(`document.activeElement?.blur()`);
  await sleep(600);
  let rect;
  if (selector) {
    const box = await js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
    rect = { x: Math.max(0, Math.floor(box.x - pad)), y: Math.max(0, Math.floor(box.y - pad)), width: Math.ceil(box.width + 2 * pad), height: Math.ceil(box.height + 2 * pad) };
  }
  const image = await window.webContents.capturePage(rect);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${name}.png`), image.toPNG());
  return image;
}

const save = (draft) => js(`window.imaptransfer.accounts.save(${JSON.stringify({ port: 993, secure: true, allowSelfSigned: false, auth: 'password', password: 'x', providerId: null, ...draft })})`);
const click = (label) => js(`(() => { const scope = document.querySelector('dialog[open]') ?? document; const b = [...scope.querySelectorAll('button, summary')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(label)})); if (!b) throw new Error('no button ' + ${JSON.stringify(label)}); b.click(); return true; })()`);
const folder = (path, count) => ({ path, target: null, sourceCount: count, targetCount: count, transferred: count, skipped: 0, failed: 0, removed: 0, error: null });

const mappings = [
  { source: 'INBOX', target: 'INBOX', exists: true, role: 'normal', messages: 412 },
  { source: words.archive, target: words.archive, exists: true, role: 'normal', messages: 1873 },
  { source: `${words.archive}/2023`, target: `${words.archive}/2023`, exists: false, role: 'normal', messages: 655 },
  { source: words.invoices, target: words.invoices, exists: false, role: 'normal', messages: 238 },
  { source: words.sent, target: words.sentTarget, exists: true, role: 'normal', messages: 340 },
];
const inbox = {
  path: 'INBOX', messages: 412, duplicates: 3, similar: 0,
  duplicated: [
    { subject: words.quote, from: 'Holz & Form <info@example.net>', date: '2024-05-14T09:12:00.000Z', size: 48_211, copies: 3 },
    { subject: words.shipped, from: 'Shop <service@example.net>', date: '2024-06-02T16:40:00.000Z', size: 21_904, copies: 2 },
  ],
};
// The test run shows a second, clean folder.
const duplicates = {
  folders: [inbox, { path: words.archive, messages: 1873, duplicates: 0, similar: 0, duplicated: [] }],
  duplicates: 3, similar: 0, trash: words.trash, gmail: false, problem: null,
};

async function main() {
  await import(join(root, 'apps', 'desktop', 'out', 'main', 'index.js'));
  while (!(window = BrowserWindow.getAllWindows()[0])) await sleep(100);
  ipcMain.removeHandler('jobs:plan');
  ipcMain.handle('jobs:plan', async () => ({ mappings, messages: 3518, removed: 0, target: { gmail: false, uidplus: true, syncProblem: null }, history: true }));
  ipcMain.removeHandler('jobs:findDuplicates');
  ipcMain.handle('jobs:findDuplicates', async () => duplicates);
  window.webContents.setBackgroundThrottling(false);
  window.setSize(1120, 760);
  await waitFor(`!!document.querySelector('.welcome')`);
  if (docs) await shot('welcome');

  await save(OLD);
  await save(NEW);
  await save(OTHER);
  window.webContents.send('accounts:changed');
  await waitFor(`document.querySelectorAll('.account').length === 3`);
  const list = await js(`window.imaptransfer.accounts.list()`);
  const source = list.find((account) => account.host === OLD.host).id;
  await js(`[...document.querySelectorAll('.account')].find((b) => b.textContent.includes(${JSON.stringify(OLD.host)})).click()`);
  await waitFor(`!!document.querySelector('.target select')`);
  // The migration target: the same address at the other server.
  await js(`(() => { const s = document.querySelector('.target select'); s.value = [...s.options].find((o) => o.textContent.includes(${JSON.stringify(NEW.host)})).value; s.dispatchEvent(new Event('change')); })()`);
  const whole = await shot(docs ? 'account' : 'app');
  // Phones get the top left: the sidebar with both addresses and their servers, large enough to read.
  if (!docs) writeFileSync(join(out, 'app-narrow.png'), whole.crop({ x: 0, y: 0, width: 760, height: 1100 }).toPNG());

  await click(words.cont);
  await waitFor(`!!document.querySelector('dialog .sync input')`);
  await js(`document.querySelector('dialog .sync input').click()`);
  await waitFor(`document.querySelector('dialog .sync input').checked`);
  await sleep(300);
  await shot(docs ? 'migrate-plan' : 'migrate', docs ? null : 'dialog[open]');
  await click(words.cancel);
  await sleep(300);

  // The website shows the app and the migration plan; the documentation goes on to the test run,
  // a running backup and its report.
  if (docs) await documentationRest(source);
  console.log(`Screenshots in ${out}`);
  app.exit(0);
}

async function documentationRest(source) {
  await click(words.test);
  await waitFor(`!!document.querySelector('dialog tbody tr')`);
  await shot('dedupe-test-run');
  await click(words.cancel);
  await sleep(300);

  const startedAt = new Date(Date.now() - 190_000).toISOString();
  const directory = `/Users/anna/Documents/IMAP Transfer/${OLD.user} (${OLD.host})`;
  const base = { id: 'screenshots', request: { kind: 'backup', accountId: source, directory, excludeFolders: [] }, warnings: [], retry: null, verify: null, mbox: null, error: null, startedAt };
  window.webContents.send('jobs:update', {
    ...base, status: 'running', phase: 'transfer', folder: { path: words.archive, index: 1, count: 5 },
    progress: { done: 1240, total: 3518, bytes: 612_000_000 },
    remaining: { messages: 2278, bytes: 988_000_000, time: roundRemaining(12 * 60 + 20) },
    current: { direction: 'download', subject: words.plan, size: 8_400_000, transferred: 3_150_000, startedAt: Date.now() - 4000 },
    report: null,
  });
  await waitFor(`!!document.querySelector('.panel .progress')`);
  await shot('backup-running');

  const folders = [folder('INBOX', 412), folder(words.archive, 1873), folder(`${words.archive}/2023`, 655), folder(words.invoices, 238), folder(words.sent, 340)];
  window.webContents.send('jobs:update', {
    ...base, status: 'completed', phase: 'finish', folder: null, progress: { done: 3518, total: 3518, bytes: 1_600_000_000 }, remaining: null, current: null,
    report: { kind: 'backup', status: 'completed', error: null, startedAt, finishedAt: new Date().toISOString(), folders,
      totals: { messages: 3518, transferred: 3518, skipped: 0, failed: 0, removed: 0, bytes: 1_600_000_000, deduplicated: 0 }, failures: [] },
  });
  await waitFor(`!!document.querySelector('.headline')`);
  await shot('backup-report');
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
