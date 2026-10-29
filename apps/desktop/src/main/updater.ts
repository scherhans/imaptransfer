import { app, Notification } from 'electron';
import electronUpdater from 'electron-updater';
import { texts } from './texts';

/**
 * Looks for a newer release on GitHub and installs it on the next quit. Only signed, packaged
 * builds can update themselves; development runs skip this. Nothing in here may reject
 * unhandled: a failed download (no network, an unsigned macOS build) is simply tried again on
 * the next start.
 */
export function checkForUpdates(): void {
  if (!app.isPackaged || process.env.IMAPTRANSFER_DISABLE_UPDATES) return;
  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
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
