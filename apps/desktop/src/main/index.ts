import { app } from 'electron';

// node:sqlite still announces itself as experimental; the filter must be in place before the
// engine (and with it node:sqlite) is loaded, so the rest of the app is imported afterwards.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === 'string' ? warning : warning.message;
  if (/SQLite is an experimental feature/.test(text)) return;
  (emitWarning as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

// A promise nobody handles (a failed update download, a notification) must never turn into
// Electron's error dialog in the middle of a backup.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

// Not awaited: Electron only becomes ready once the entry module has finished evaluating.
import('./app').catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
