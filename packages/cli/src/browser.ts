import { spawn } from 'node:child_process';

/** Opens a URL in the default browser; the caller prints it too, in case nothing opens. */
export function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', `"${url}"`]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser available, e.g. on a server: the printed URL is enough.
  }
}
