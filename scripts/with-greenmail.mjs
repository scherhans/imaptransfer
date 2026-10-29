#!/usr/bin/env node
// Starts GreenMail (an in-memory test mail server) and runs a command against it.
//   node scripts/with-greenmail.mjs                  → keeps the server running until Ctrl+C
//   node scripts/with-greenmail.mjs pnpm test:…      → runs the command, then stops the server
// IMAP on 127.0.0.1:3143, IMAPS on 127.0.0.1:3993. Any user name and password is accepted.
// Set GREENMAIL_EXTERNAL=1 when a server is already running (CI service container).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '2.1.15';
const BASE = `https://repo1.maven.org/maven2/com/icegreen/greenmail-standalone/${VERSION}/greenmail-standalone-${VERSION}.jar`;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jar = join(root, '.cache', 'greenmail', `greenmail-standalone-${VERSION}.jar`);

async function download() {
  if (existsSync(jar)) return;
  mkdirSync(dirname(jar), { recursive: true });
  console.log(`Downloading GreenMail ${VERSION} …`);
  const [content, expected] = await Promise.all([
    fetch(BASE).then((response) => {
      if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
      return response.arrayBuffer();
    }),
    fetch(`${BASE}.sha1`).then((response) => response.text()),
  ]);
  const actual = createHash('sha1').update(Buffer.from(content)).digest('hex');
  if (actual !== expected.trim().split(/\s+/)[0]) throw new Error('GreenMail checksum mismatch, download discarded');
  writeFileSync(jar, Buffer.from(content));
}

function isOpen(port) {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port, exited, timeoutMs = 30_000) {
  const started = Date.now();
  while (!(await isOpen(port))) {
    if (exited()) throw new Error('GreenMail stopped right after starting (is Java installed?)');
    if (Date.now() - started > timeoutMs) throw new Error(`GreenMail did not open port ${port}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.once('exit', (code) => resolve(code ?? 1));
    // A command that cannot even start (typo, missing binary) must still stop the server.
    child.once('error', (error) => {
      console.error(`Could not run ${command}: ${error.message}`);
      resolve(1);
    });
  });
}

/** Stops GreenMail and waits until it has released its ports, so a next run starts clean. */
function stopServer(server) {
  if (!server || server.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    server.once('exit', resolve);
    server.kill();
  });
}

const [command, ...args] = process.argv.slice(2);
let server = null;
let exited = false;
if (!process.env.GREENMAIL_EXTERNAL) {
  if ((await isOpen(3143)) || (await isOpen(3993))) {
    console.error('Port 3143 or 3993 is already in use. Stop the other server, or set GREENMAIL_EXTERNAL=1 to use it.');
    process.exit(1);
  }
  await download();
  server = spawn(
    'java',
    [
      '-Dgreenmail.setup.test.imap',
      '-Dgreenmail.setup.test.imaps',
      '-Dgreenmail.hostname=127.0.0.1',
      '-Dgreenmail.auth.disabled',
      // No "-Dgreenmail.verbose": GreenMail turns logging of every command on when the
      // property is present at all, even as "=false".
      '-jar',
      jar,
    ],
    { stdio: command ? 'ignore' : 'inherit' },
  );
  server.once('exit', () => {
    exited = true;
  });
  const stop = () => stopServer(server).then(() => process.exit(130));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
await waitForPort(3143, () => exited);
await waitForPort(3993, () => exited);

if (!command) {
  console.log('GreenMail is running: IMAP 127.0.0.1:3143, IMAPS 127.0.0.1:3993. Stop with Ctrl+C.');
} else {
  const code = await run(command, args);
  await stopServer(server);
  process.exit(code);
}
