import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { CancelledError } from '@imaptransfer/core';

/** Asks for a password on the terminal without echoing it. */
export function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return Promise.reject(new Error('No password given and no terminal to ask for one. Use --password-env or --password-file.'));
  }
  let muted = false;
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (!muted) process.stderr.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve, reject) => {
    let answered = false;
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      process.stderr.write('\n');
      resolve(answer);
    });
    // readline swallows Ctrl+C at the prompt; without this the process would just hang on an
    // unsettled promise. Ctrl+D (end of input) means the same: no password, stop.
    rl.on('SIGINT', () => rl.close());
    rl.on('close', () => {
      if (answered) return;
      process.stderr.write('\n');
      reject(new CancelledError());
    });
    muted = true;
  });
}
