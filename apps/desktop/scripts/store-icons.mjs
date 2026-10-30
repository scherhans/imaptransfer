// The tiles of the Microsoft Store package from build/icon.svg, drawn by Chromium into build/appx/.
// Without them electron-builder would pack its own sample images.
//
//   pnpm --filter imaptransfer-desktop store-icons
//
// Inside VS Code's terminal, unset ELECTRON_RUN_AS_NODE first (see CONTRIBUTING.md).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const build = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');
const TILES = {
  'StoreLogo.png': [50, 50],
  'Square44x44Logo.png': [44, 44],
  'Square150x150Logo.png': [150, 150],
  'Wide310x150Logo.png': [310, 150],
};
const SCALE = 4;

/** The icon drawn four times too large with a transparent background, centred, then scaled down. */
async function render(svg, width, height) {
  const window = new BrowserWindow({
    show: false,
    width: width * SCALE,
    height: height * SCALE,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  });
  const size = Math.min(width, height) * SCALE;
  const html = `<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:transparent"><img id="i" width="${size}" height="${size}" src="data:image/svg+xml;base64,${svg}"></body></html>`;
  await window.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await window.webContents.executeJavaScript(`document.getElementById('i').decode().then(() => true)`);
  await new Promise((done) => setTimeout(done, 300));
  const image = await window.webContents.capturePage();
  window.destroy();
  return image.resize({ width, height, quality: 'best' }).toPNG();
}

// Each tile has its own window; without this, Electron quits as soon as the first one is closed.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const svg = readFileSync(join(build, 'icon.svg')).toString('base64');
  mkdirSync(join(build, 'appx'), { recursive: true });
  for (const [name, [width, height]] of Object.entries(TILES)) {
    writeFileSync(join(build, 'appx', name), await render(svg, width, height));
    console.log(`Wrote build/appx/${name}`);
  }
  app.exit(0);
});
