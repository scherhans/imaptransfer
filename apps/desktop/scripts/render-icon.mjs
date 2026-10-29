// Renders build/icon.svg into build/icon.png (1024 × 1024). electron-builder derives the
// macOS, Windows and Linux icons from that PNG. Run with: pnpm --filter imaptransfer-desktop icon
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const build = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');
const svg = readFileSync(join(build, 'icon.svg'), 'utf8');
const html = `<!doctype html><html><head><style>html,body{margin:0;overflow:hidden;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`;

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    webPreferences: { offscreen: true },
  });
  window.webContents.setZoomFactor(1);
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = (await window.webContents.capturePage()).resize({ width: 1024, height: 1024, quality: 'best' });
  writeFileSync(join(build, 'icon.png'), image.toPNG());
  console.log(`Wrote ${join(build, 'icon.png')}`);
  app.exit(0);
});
