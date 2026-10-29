// The website's raster icons from its SVGs, drawn by Chromium: favicon.ico with 16, 32 and 48 px for
// everyone who asks for /favicon.ico, and apple-touch-icon.png with 180 px for the home screen.
//
//   pnpm --filter imaptransfer-desktop website-icons
//
// Inside VS Code's terminal, unset ELECTRON_RUN_AS_NODE first (see CONTRIBUTING.md).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const website = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'website');
const RENDER = 512;

/** The SVG drawn at RENDER px with a transparent background, then scaled to each size. */
async function render(svgFile, sizes) {
  const svg = readFileSync(svgFile).toString('base64');
  const window = new BrowserWindow({ show: false, width: RENDER, height: RENDER, useContentSize: true, frame: false, transparent: true, backgroundColor: '#00000000' });
  const html = `<!doctype html><html><body style="margin:0;background:transparent"><img id="i" src="data:image/svg+xml;base64,${svg}" width="${RENDER}" height="${RENDER}" style="display:block"></body></html>`;
  await window.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await window.webContents.executeJavaScript(`document.getElementById('i').decode().then(() => true)`);
  await new Promise((done) => setTimeout(done, 300));
  const image = await window.webContents.capturePage();
  window.destroy();
  return sizes.map((size) => ({ size, png: image.resize({ width: size, height: size, quality: 'best' }).toPNG() }));
}

/** An ICO file that holds PNG images, as every current browser and Windows read them. */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

// Each icon has its own window; without this, Electron quits as soon as the first one is closed.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  try {
    const favicon = await render(join(website, 'assets', 'favicon.svg'), [16, 32, 48]);
    writeFileSync(join(website, 'public', 'favicon.ico'), ico(favicon));
    const [touch] = await render(join(website, 'icons', 'touch-icon.svg'), [180]);
    writeFileSync(join(website, 'public', 'apple-touch-icon.png'), touch.png);
    console.log(`Icons in ${join(website, 'public')}`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
