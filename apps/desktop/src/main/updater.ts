import { app, Notification } from 'electron';
import electronUpdater from 'electron-updater';
import { texts } from './texts';

/** The Microsoft Store updates its own package; electron-updater cannot, and the app stays out of it. */
export const updatesBuiltIn = !process.windowsStore && !process.env.IMAPTRANSFER_DISABLE_UPDATES;

let started = false;

/**
 * Follows the user's choice. The first yes looks for a newer release on GitHub and installs it on
 * the next quit; a later no drops that install. Nothing reaches GitHub before that yes. Only signed,
 * packaged builds can update themselves; development runs skip this. Nothing in here may reject
 * unhandled: a failed download (no network, an unsigned macOS build) is simply tried again on the
 * next start.
 */
export function followUpdateChoice(enabled: boolean): void {
  if (!app.isPackaged || !updatesBuiltIn || (!enabled && !started)) return;
  const { autoUpdater } = electronUpdater;
  autoUpdater.autoInstallOnAppQuit = enabled;
  if (!enabled || started) return;
  started = true;
  autoUpdater.autoDownload = true;
  autoUpdater.on('error', () => {
    // No network or no release yet: try again on the next start.
  });
  autoUpdater.on('update-downloaded', (info) => {
    if (!Notification.isSupported()) return;
    new Notification({ title: 'IMAP Transfer', body: texts().updateDownloaded(info.version) }).show();
  });
  void autoUpdater
    .checkForUpdates()
    .then((result) => result?.downloadPromise?.catch(() => undefined))
    .catch(() => undefined);
}
