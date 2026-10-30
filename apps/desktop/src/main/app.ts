import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, nativeTheme, Notification, powerSaveBlocker, shell, systemPreferences } from 'electron';
import type { JobState } from '../shared/api';
import { AccountStore } from './accounts';
import { registerIpc } from './ipc';
import { JobRunner } from './jobs';
import { installMenu } from './menu';
import { SettingsStore } from './settings';
import { setLanguage, texts, type JobName } from './texts';
import { followUpdateChoice } from './updater';

const here = dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | null = null;
let powerBlocker: number | null = null;

// A second start only brings the running window to the front (see 'second-instance').
if (!app.requestSingleInstanceLock()) app.exit(0);

// macOS adds items of its own to an app's menus (dictation and emoji under Edit, full screen
// under Window). They must be switched off before the app has finished launching.
if (process.platform === 'darwin') {
  systemPreferences.setUserDefault('NSDisabledDictationMenuItem', 'boolean', true);
  systemPreferences.setUserDefault('NSDisabledCharacterPaletteMenuItem', 'boolean', true);
  systemPreferences.setUserDefault('NSFullScreenMenuItemEverywhere', 'boolean', false);
}

/** The window's color before the page has painted, matching the stylesheet's background. */
function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#1b1b1d' : '#f7f6f3';
}

/** Set once the user chose to stop the running job and quit. */
let quitting = false;

/** Asks whether a running job may be stopped; true when the user wants to quit. */
function confirmStop(parent: BrowserWindow | null): boolean {
  const text = texts();
  const options: Electron.MessageBoxSyncOptions = {
    type: 'warning',
    buttons: [text.keepRunning, text.stopAndQuit],
    defaultId: 0,
    cancelId: 0,
    message: text.stopQuestion,
    detail: text.stopDetail,
  };
  return (parent ? dialog.showMessageBoxSync(parent, options) : dialog.showMessageBoxSync(options)) === 1;
}

function createWindow(): BrowserWindow {
  const created = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 880,
    minHeight: 580,
    show: false,
    title: 'IMAP Transfer',
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // Developer tools belong to development, not in front of users.
      devTools: !app.isPackaged,
    },
  });
  created.once('ready-to-show', () => created.show());

  // The window only ever shows the app itself; links open in the browser.
  created.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  created.webContents.on('will-navigate', (event, url) => {
    if (url !== created.webContents.getURL()) event.preventDefault();
  });

  created.on('close', (event) => {
    if (!jobs.running || quitting) return;
    event.preventDefault();
    if (!confirmStop(created)) return;
    // Quit only once the job has stopped: it still closes the connection and records the run.
    quitting = true;
    jobs.cancel();
    void jobs.whenIdle().then(() => {
      created.destroy();
      app.quit();
    });
  });
  created.on('closed', () => {
    window = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) void created.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void created.loadFile(join(here, '../renderer/index.html'));
  return created;
}

function finishedNotice(state: JobState): void {
  if (window?.isFocused() || !Notification.isSupported() || state.status === 'running') return;
  const text = texts();
  const request = state.request;
  const job: JobName = (request.kind === 'restore' || request.kind === 'migrate') && request.sync ? 'sync' : request.kind;
  const name = job === 'sync' ? text.sync : (text.jobs[job] ?? text.jobs.backup);
  const outcome = text.otherGender?.jobs.includes(job) ? text.otherGender.outcome : text.outcome;
  new Notification({ title: `${name} ${outcome[state.status]}`, body: 'IMAP Transfer' }).show();
}

// The app was called "imaptransfer" before it got its name; its data folder moved with it.
// Accounts from the old folder are taken along once, the old folder stays untouched.
const userData = app.getPath('userData');
const previousUserData = join(dirname(userData), 'imaptransfer');
if (!existsSync(join(userData, 'accounts.json')) && existsSync(join(previousUserData, 'accounts.json'))) {
  mkdirSync(userData, { recursive: true });
  copyFileSync(join(previousUserData, 'accounts.json'), join(userData, 'accounts.json'));
}
const accounts = new AccountStore(join(userData, 'accounts.json'));
const jobs = new JobRunner(accounts, {
  publish(state) {
    window?.webContents.send('jobs:update', state);
    const { done, total } = state.progress;
    window?.setProgressBar(state.status === 'running' ? (total > 0 ? done / total : 2) : -1);
  },
  started() {
    // Long backups must not stop because the computer goes to sleep.
    powerBlocker = powerSaveBlocker.start('prevent-app-suspension');
  },
  finished(state) {
    if (powerBlocker !== null) powerSaveBlocker.stop(powerBlocker);
    powerBlocker = null;
    window?.setProgressBar(-1);
    finishedNotice(state);
  },
  accountsChanged() {
    window?.webContents.send('accounts:changed');
  },
}, join(userData, 'sync'));

const settings = new SettingsStore(join(userData, 'settings.json'));

/** Applies the look, the language and the update choice: once at the start, then whenever the user changes them. */
function applySettings(): void {
  const { theme, language, updateCheck } = settings.current;
  // Native parts (dialogs, title bar, menus) and the window's `prefers-color-scheme` follow
  // `themeSource`, so the stylesheet needs no second switch.
  nativeTheme.themeSource = theme;
  window?.setBackgroundColor(windowBackground());
  setLanguage(language);
  if (app.isReady()) {
    installMenu();
    followUpdateChoice(updateCheck === true);
  }
}
applySettings();
nativeTheme.on('updated', () => window?.setBackgroundColor(windowBackground()));

registerIpc(accounts, jobs, settings, applySettings);

app.on('second-instance', () => {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Cmd+Q, a logout or a shutdown with a job running and no window to ask in.
app.on('before-quit', (event) => {
  if (!jobs.running || quitting) return;
  event.preventDefault();
  if (!confirmStop(window)) return;
  quitting = true;
  jobs.cancel();
  void jobs.whenIdle().then(() => app.quit());
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) window = createWindow();
});

void app.whenReady().then(() => {
  installMenu();
  window = createWindow();
  followUpdateChoice(settings.current.updateCheck === true);
});
