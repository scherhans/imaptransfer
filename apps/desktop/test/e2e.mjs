// End-to-end test of the built desktop app against GreenMail. It drives the real window like a
// user: pick language and look, add an account, back it up, check the backup, migrate it,
// restore it and clean up duplicate mail.
//
//   pnpm --filter imaptransfer-desktop build
//   node scripts/with-greenmail.mjs pnpm --filter imaptransfer-desktop test:e2e
//
// SHOTS=<folder> saves a screenshot of every step; E2E_LANG=en-US and THEME=light switch the
// language and appearance. Inside VS Code, unset ELECTRON_RUN_AS_NODE first.
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, Menu, nativeTheme } from 'electron';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(desktop, '..', '..');
const imapsPort = Number(process.env.GREENMAIL_IMAPS_PORT ?? 3993);
const shots = process.env.SHOTS ?? null;
const lang = process.env.E2E_LANG ?? 'de-DE';
const german = lang.startsWith('de');

const data = mkdtempSync(join(tmpdir(), 'imaptransfer-e2e-'));
app.setPath('userData', join(data, 'user'));
app.setPath('documents', join(data, 'documents'));
app.commandLine.appendSwitch('lang', lang);
// Test key stores: nothing from this test lands in the real Keychain or keyring.
app.commandLine.appendSwitch('use-mock-keychain');
app.commandLine.appendSwitch('password-store', 'basic');
if (process.platform === 'linux' && process.env.CI) app.commandLine.appendSwitch('no-sandbox');
// THEME=light|dark starts the app with that look, as if the user had picked it before.
const settingsFile = join(data, 'user', 'settings.json');
if (process.env.THEME) {
  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify({ version: 1, theme: process.env.THEME, language: 'system' }));
}

// Stands in for the native folder picker, which a test cannot click.
let nextDirectory = null;
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [nextDirectory] });

// E2E_NAMES=a,b,c gives the three accounts readable names (for documentation screenshots);
// that needs a fresh GreenMail, because every name is an account there.
const stamp = Date.now();
const [source, target, restored] = process.env.E2E_NAMES?.split(',') ?? [`e2e-src-${stamp}`, `e2e-dst-${stamp}`, `e2e-restore-${stamp}`];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let window;

async function connectAs(user) {
  const { ImapFlow } = await import(join(root, 'packages/core/node_modules/imapflow/dist/esm/imap-flow.js'));
  const client = new ImapFlow({ host: '127.0.0.1', port: imapsPort, secure: true, tls: { rejectUnauthorized: false }, auth: { user, pass: 'x' }, logger: false });
  await client.connect();
  return client;
}

async function seed() {
  const client = await connectAs(source);
  let number = 0;
  for (const [folder, count] of Object.entries({ INBOX: 180, Rechnungen: 60, 'Rechnungen.2024': 30, Sent: 30 })) {
    if (folder !== 'INBOX') await client.mailboxCreate(folder);
    for (let index = 0; index < count; index++, number++) {
      const raw = `Message-ID: <e2e${number}@test>\r\nDate: Mon, 03 Jun 2024 10:${String(index % 60).padStart(2, '0')}:00 +0200\r\nFrom: Anna <anna@example.com>\r\nSubject: Testmail ${number} in ${folder}\r\n\r\n${'Inhalt '.repeat(400)}\r\n`;
      await client.append(folder, raw, index % 3 ? ['\\Seen'] : [], new Date(Date.UTC(2024, index % 12, 1 + (index % 27))));
    }
  }
  // One large message, after the inbox: by then there is a time estimate, and its download
  // takes long enough for the second progress bar.
  await client.mailboxCreate('Anhänge');
  const attachment = `Message-ID: <e2e-large@test>\r\nDate: Tue, 04 Jun 2024 09:00:00 +0200\r\nFrom: Anna <anna@example.com>\r\nSubject: Fotos vom Sommerfest\r\n\r\n${'Bilddaten '.repeat(420_000)}\r\n`;
  await client.append('Anhänge', attachment, ['\\Seen'], new Date(Date.UTC(2024, 5, 4)));
  await client.logout();
}

/** A proxy that slows every server answer a little, so the progress view can be seen. */
function slowProxy() {
  return new Promise((resolve) => {
    const server = createServer((client) => {
      const upstream = connect(imapsPort, '127.0.0.1');
      upstream.on('data', (chunk) => {
        upstream.pause();
        setTimeout(() => {
          client.write(chunk);
          upstream.resume();
        }, 25);
      });
      client.on('data', (chunk) => upstream.write(chunk));
      for (const [a, b] of [[client, upstream], [upstream, client]]) {
        a.on('error', () => b.destroy());
        a.on('close', () => b.destroy());
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

const js = (code) => window.webContents.executeJavaScript(code);

async function shot(name) {
  if (!shots) return;
  await sleep(250);
  mkdirSync(shots, { recursive: true });
  writeFileSync(join(shots, `${name}.png`), (await capture()).toPNG());
}

/**
 * The window as a picture. Under Xvfb on the CI runners, Chromium sometimes has no frame ready yet
 * and fails with UnknownVizError; a moment later it has one.
 */
async function capture(attempts = 10) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await window.webContents.capturePage();
    } catch (error) {
      if (attempt >= attempts || !String(error).includes('UnknownVizError')) throw error;
      await sleep(300);
    }
  }
}

async function waitFor(code, timeout = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await js(code)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${code}`);
}

// The report's headline, or its error. Not any notice on the page: the sidebar warns about a missing
// keyring on Linux runners, and the running job shows a notice while it reconnects.
const waitForResult = () => waitFor(`!!document.querySelector('.panel .notice.headline, .panel .notice.error:not(.small)')`, 120_000);

/** Clicks a button by its label; while a dialog is open, only in it, like a user can. */
function click(label) {
  return js(`(() => {
    const scope = document.querySelector('dialog[open]') ?? document;
    const button = [...scope.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(label)}));
    if (!button) throw new Error('No button ' + ${JSON.stringify(label)});
    button.click();
    return true;
  })()`);
}

function fill(selector, value) {
  return js(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element.value = ${JSON.stringify(value)};
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    return true;
  })()`);
}

async function addAccountDirectly(user) {
  await js(`window.imaptransfer.accounts.save(${JSON.stringify({ user, host: '127.0.0.1', port: imapsPort, secure: true, allowSelfSigned: true, providerId: null, auth: 'password', password: 'x' })})`);
  window.webContents.send('accounts:changed');
  await sleep(400);
}

async function summary() {
  return js(`document.querySelector('.card p')?.textContent ?? ''`);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  await seed();
  const proxyPort = await slowProxy();
  await import(join(desktop, 'out/main/index.js'));
  while (!(window = BrowserWindow.getAllWindows()[0])) await sleep(100);
  // A covered window draws no frames, and Chromium fires a dialog's close event only with the next
  // frame: without this, the test stalls whenever another window lies on top.
  window.webContents.setBackgroundThrottling(false);
  window.setSize(1120, 760);
  await waitFor(`!!document.querySelector('.welcome') && !!document.querySelector('.update-notice')`);
  await shot('01-welcome');

  // The first start asks about the update check. The answer is kept, and the sidebar can change it.
  const updateChoice = () => JSON.parse(readFileSync(settingsFile, 'utf8')).updateCheck;
  await js(`document.querySelector('.update-notice input').click(); document.querySelector('.update-notice button').click(); true`);
  await waitFor(`!document.querySelector('.update-notice') && !!document.querySelector('.updates input')`);
  expect(updateChoice() === false, `The update choice was not kept: ${updateChoice()}`);
  await js(`document.querySelector('.updates input').click(); true`);
  await sleep(300);
  expect(updateChoice() === true, `The sidebar did not change the update choice: ${updateChoice()}`);

  // The menu holds only what the app has: no Help with an empty search, no View, no Zoom.
  if (process.platform === 'darwin') {
    const menus = Menu.getApplicationMenu().items.map((item) => item.label);
    expect(menus.length === 3 && menus[1] === (german ? 'Bearbeiten' : 'Edit'), `Menus: ${JSON.stringify(menus)}`);
  }

  // Another language, picked in the sidebar: the window and the menu follow at once.
  const addLabel = (inGerman) => (inGerman ? 'Konto hinzufügen' : 'Add account');
  await fill('.language select', german ? 'en' : 'de');
  await waitFor(`document.querySelector('.add').textContent.includes(${JSON.stringify(addLabel(!german))})`);
  if (process.platform === 'darwin') {
    const edit = Menu.getApplicationMenu().items[1].label;
    expect(edit === (german ? 'Edit' : 'Bearbeiten'), `The menu did not follow the language: ${edit}`);
  }
  await shot('01b-other-language');
  await fill('.language select', 'system');
  await waitFor(`document.querySelector('.add').textContent.includes(${JSON.stringify(addLabel(german))})`);

  // Light or dark, independent of the system; kept for the next start.
  const themeButton = (theme) => `document.querySelector('.theme button:nth-child(${['system', 'light', 'dark'].indexOf(theme) + 1})')`;
  const startTheme = process.env.THEME ?? 'system';
  const flipped = nativeTheme.shouldUseDarkColors ? 'light' : 'dark';
  await js(`${themeButton(flipped)}.click()`);
  await waitFor(`matchMedia('(prefers-color-scheme: dark)').matches === ${flipped === 'dark'} && ${themeButton(flipped)}.getAttribute('aria-pressed') === 'true'`);
  const saved = JSON.parse(readFileSync(settingsFile, 'utf8'));
  expect(saved.theme === flipped && saved.language === 'system', `Settings file: ${JSON.stringify(saved)}`);
  await shot('01c-other-theme');
  await js(`${themeButton(startTheme)}.click()`);
  await waitFor(`${themeButton(startTheme)}.getAttribute('aria-pressed') === 'true'`);

  // Add the account through the editor, the way a user does.
  await click(german ? 'Konto hinzufügen' : 'Add account');
  await waitFor(`!!document.querySelector('.editor')`);
  await fill('input[inputmode=email]', 'anna@gmx.de');
  await sleep(200);
  expect((await js(`document.querySelector('select.input').value`)) === 'gmx', 'GMX was not detected from the address');
  await shot('02-editor-provider-detected');
  await fill('select.input', '');
  await fill('input[inputmode=email]', source);
  await fill('.advanced .host input', '127.0.0.1');
  await fill('.advanced .port input', String(proxyPort));
  await js(`document.querySelector('.self-signed input').click()`);
  await fill('input[type=password]', 'secret');
  await click(german ? 'Verbindung testen' : 'Test connection');
  await waitFor(`!!document.querySelector('.notice.success')`);
  await shot('03-editor-tested');
  await click(german ? 'Speichern' : 'Save');
  await waitFor(`!!document.querySelector('.page h1')`);
  await shot('04-account');

  // Back up.
  const [account] = await js(`window.imaptransfer.accounts.list()`);
  await js(`window.imaptransfer.accounts.setBackupDirectory(${JSON.stringify(account.id)}, ${JSON.stringify(join(data, 'backup'))})`);
  window.webContents.send('accounts:changed');
  await sleep(300);
  await click(german ? 'Jetzt sichern' : 'Back up now');
  await waitFor(`(() => { const bar = document.querySelector('.progress > div'); return bar && parseFloat(bar.style.width) > 10; })()`);
  await shot('05-backup-running');
  // The large message gets its own bar, and by now there is an estimate of the time left.
  await waitFor(`!!document.querySelector('.current-message')`, 60_000);
  await shot('05b-backup-large-message');
  const remaining = await js(`document.querySelector('.remaining strong')?.textContent ?? ''`);
  expect(/\d|weniger|less/i.test(remaining), `No time estimate during the backup: "${remaining}"`);
  await waitForResult();
  await shot('06-backup-report');
  expect((await summary()).startsWith('301 '), `Backup: ${await summary()}`);
  await click(german ? 'Fertig' : 'Done');

  // Check the backup.
  await click(german ? 'Sicherung prüfen' : 'Check backup');
  await waitForResult();
  await shot('07-verify-report');
  expect(await js(`!!document.querySelector('.notice.success')`), 'The backup check found problems');
  await click(german ? 'Fertig' : 'Done');

  // Migrate into a second account.
  await addAccountDirectly(target);
  await click(german ? 'Weiter' : 'Continue');
  await waitFor(`!!document.querySelector('dialog table')`, 30_000);
  await shot('08-migrate-plan');
  await click(german ? 'Starten' : 'Start');
  await waitForResult();
  await shot('09-migrate-report');
  expect((await summary()).startsWith('301 '), `Migration: ${await summary()}`);
  await click(german ? 'Fertig' : 'Done');

  // Delete one message in the account and back up again: the backup keeps it, and the restore
  // plan has to say that it only comes back on request.
  const client = await connectAs(source);
  const lock = await client.getMailboxLock('INBOX');
  await client.messageDelete('1');
  lock.release();
  await client.logout();
  await js(`[...document.querySelectorAll('.account')].find((b) => b.textContent.includes(${JSON.stringify(source)})).click()`);
  await sleep(300);
  await click(german ? 'Jetzt sichern' : 'Back up now');
  await waitForResult();
  await click(german ? 'Fertig' : 'Done');

  // A new, empty folder for an account that has a backup elsewhere: the backup starts there
  // afresh. Only the folder of the last backup counts as a drive that may be missing.
  const fresh = join(data, 'backup-fresh');
  mkdirSync(fresh);
  nextDirectory = fresh;
  await click(german ? 'Ändern' : 'Change');
  await waitFor(`document.body.textContent.includes(${JSON.stringify(german ? 'In diesem Ordner liegt noch keine Sicherung' : 'This folder holds no backup yet')})`);
  await shot('10a-new-backup-folder');
  await click(german ? 'Jetzt sichern' : 'Back up now');
  await waitForResult();
  expect((await summary()).startsWith('300 '), `Backup into a new folder: ${await summary()}`);
  await click(german ? 'Fertig' : 'Done');
  // That folder gone, as with a drive unplugged: the app stops instead of starting anew, and
  // says so in the window's language.
  renameSync(fresh, `${fresh}-away`);
  await click(german ? 'Jetzt sichern' : 'Back up now');
  await waitFor(`!!document.querySelector('.notice.error')`);
  const missing = await js(`[...document.querySelectorAll('.notice.error')].map((notice) => notice.textContent).join(' ')`);
  expect(missing.includes(german ? 'Ist das Laufwerk angeschlossen?' : 'Is the drive connected?'), `Missing backup folder: ${missing}`);
  await shot('10b-backup-folder-missing');
  await click(german ? 'Fertig' : 'Done');
  renameSync(`${fresh}-away`, fresh);

  // Restore the backup into a third account.
  await addAccountDirectly(restored);
  await js(`[...document.querySelectorAll('.account')].find((b) => b.textContent.includes(${JSON.stringify(restored)})).click()`);
  await sleep(300);
  nextDirectory = join(data, 'backup');
  await click(german ? 'Sicherung auswählen' : 'Choose backup');
  await waitFor(`!!document.querySelector('dialog table')`, 30_000);
  await shot('10-restore-plan');
  const hint = await js(`[...document.querySelectorAll('dialog .notice')].map((notice) => notice.textContent).join(' ')`);
  expect((german ? /eine Mail, die im Konto inzwischen gelöscht wurde/ : /one message that has since been deleted/).test(hint), `No hint about deleted mail: "${hint}"`);
  await click(german ? 'Starten' : 'Start');
  await waitForResult();
  await shot('11-restore-report');
  expect((await summary()).startsWith('300 '), `Restore: ${await summary()}`);
  await click(german ? 'Fertig' : 'Done');

  // Two extra copies of one message, as an interrupted sync leaves them: the cleanup finds
  // them, keeps the original and puts the copies into the trash.
  const restoredClient = await connectAs(restored);
  await restoredClient.mailboxCreate('Trash');
  const inbox = await restoredClient.getMailboxLock('INBOX');
  const original = await restoredClient.fetchOne('1', { source: true, flags: true, internalDate: true });
  inbox.release();
  for (let copy = 0; copy < 2; copy++) await restoredClient.append('INBOX', original.source, [...original.flags], original.internalDate);
  // Through the slow proxy from here on, so the test run takes long enough to watch and stop.
  const restoredId = (await js(`window.imaptransfer.accounts.list()`)).find((account) => account.user === restored).id;
  await js(`window.imaptransfer.accounts.save(${JSON.stringify({ id: restoredId, user: restored, host: '127.0.0.1', port: proxyPort, secure: true, allowSelfSigned: true, providerId: null, auth: 'password' })})`);
  // A test run can be stopped while it reads.
  await click(german ? 'Testlauf starten' : 'Start test run');
  await waitFor(`!!document.querySelector('dialog .searching .checked')`);
  await shot('12a-dedupe-searching');
  await click(german ? 'Abbrechen' : 'Cancel');
  // Gone only after its close event, a moment after it closed.
  await waitFor(`!document.querySelector('dialog')`);
  // First a test run: it lists what would happen and changes nothing. On the way it tells
  // which folder it reads and how many mails it has checked.
  await js(`(() => {
    window.searching = [];
    new MutationObserver(() => {
      const text = document.querySelector('dialog .searching')?.textContent;
      if (text) window.searching.push(text);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
    return true;
  })()`);
  await click(german ? 'Testlauf starten' : 'Start test run');
  await waitFor(`!!document.querySelector('dialog tbody tr')`, 30_000);
  const searching = await js(`window.searching`);
  expect(
    searching.some((text) => text.includes('INBOX') && (german ? /\d+ von \d+ Mails geprüft/ : /\d+ of \d+ messages checked/).test(text)),
    `No progress during the test run: ${JSON.stringify(searching.slice(-3))}`,
  );
  expect(await js(`!!document.querySelector('dialog .test-run')`), 'The test run does not say that nothing was changed');
  // Cells after the checkbox: folder, messages, duplicates (the last cell is the "show" button).
  const rows = await js(`[...document.querySelectorAll('dialog tbody tr')].map((row) => [...row.querySelectorAll('td')].slice(1, 4).map((cell) => cell.textContent.trim()))`);
  expect(JSON.stringify(rows) === JSON.stringify([['INBOX', '181', '2']]), `Duplicate plan: ${JSON.stringify(rows)}`);
  await shot('12-dedupe-test-run');
  // The affected messages of a folder have a page of their own inside the dialog.
  await click(german ? 'Mails anzeigen' : 'Show messages');
  await waitFor(`!!document.querySelector('dialog .affected tbody tr')`);
  const listed = await js(`document.querySelector('dialog .affected').textContent`);
  expect(listed.includes('3×') && listed.includes('Testmail 1 in INBOX'), `Affected messages: ${listed}`);
  await shot('12b-dedupe-messages');
  await click(german ? '← Zurück' : '← Back');
  await waitFor(`!!document.querySelector('dialog tbody tr input[type=checkbox]')`);
  const untouched = await restoredClient.status('INBOX', { messages: true });
  expect(untouched.messages === 181, `The test run changed the mailbox: ${untouched.messages}`);
  await click(german ? 'Jetzt aufräumen' : 'Clean up now');
  await waitFor(`!document.querySelector('dialog[open]')`);
  await waitForResult();
  await shot('13-dedupe-report');
  expect((await summary()).startsWith(german ? '2 Kopien' : 'Moved 2 copies'), `Cleanup: ${await summary()}`);
  const counts = await Promise.all(['INBOX', 'Trash'].map(async (path) => (await restoredClient.status(path, { messages: true })).messages));
  await restoredClient.logout();
  expect(JSON.stringify(counts) === '[179,2]', `After the cleanup: ${JSON.stringify(counts)}`);
}

// Not awaited: Electron only becomes ready after this entry module has finished evaluating.
main()
  .then(() => {
    console.log('E2E passed');
  })
  .catch(async (error) => {
    console.error('E2E failed:', error);
    await shot('99-failure').catch(() => undefined);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(data, { recursive: true, force: true });
    app.exit(process.exitCode ?? 0);
  });
