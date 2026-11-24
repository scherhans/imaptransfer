import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import { texts } from './texts';

/**
 * The application menu, kept to what the app has. On macOS: the app menu, Edit (without it,
 * copy and paste do not work in text fields) and Window. No Help menu: the app has no help
 * book, and macOS would put a search field there that finds nothing. No View menu: reload,
 * zoom and developer tools are for development. On Windows and Linux there is no menu bar.
 */
export function installMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  app.setAboutPanelOptions({
    applicationName: 'IMAP Transfer',
    applicationVersion: app.getVersion(),
    copyright: 'Copyright © 2026 Sebastian Scherhans and contributors',
    credits: 'github.com/scherhans/imaptransfer',
  });
  const text = texts().menu;
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: text.about },
        { type: 'separator' },
        { role: 'hide', label: text.hide },
        { role: 'hideOthers', label: text.hideOthers },
        { role: 'unhide', label: text.showAll },
        { type: 'separator' },
        { role: 'quit', label: text.quit },
      ],
    },
    {
      label: text.edit,
      submenu: [
        { role: 'undo', label: text.undo },
        { role: 'redo', label: text.redo },
        { type: 'separator' },
        { role: 'cut', label: text.cut },
        { role: 'copy', label: text.copy },
        { role: 'paste', label: text.paste },
        { role: 'selectAll', label: text.selectAll },
      ],
    },
    {
      // No `role: 'window'`: macOS would add the window list and tab items to it.
      label: text.window,
      submenu: [
        { role: 'minimize', label: text.minimize },
        { role: 'close', label: text.close },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
