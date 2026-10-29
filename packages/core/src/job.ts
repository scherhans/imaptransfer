import { CancelledError, classifyError, conflictOf, describeError } from './errors.ts';
import { TimeEstimate } from './estimate.ts';
import type { Failure, FolderReport, JobOptions, ProgressEvent, Report } from './types.ts';

const PROGRESS_INTERVAL_MS = 100;
/** From this size on, a message gets its own progress: it takes noticeably long on its own. */
export const LARGE_MESSAGE_BYTES = 1024 * 1024;

export interface MessageProgress {
  update(transferred: number): void;
  finish(): void;
}

/** Shared state of one running backup, restore or migration: cancellation, progress and report. */
export class Job {
  readonly kind: Report['kind'];
  readonly signal: AbortSignal | undefined;
  private readonly onProgress: ((event: ProgressEvent) => void) | undefined;
  private readonly startedAt = new Date();
  private readonly folders = new Map<string, FolderReport>();
  private readonly failures: Failure[] = [];
  private total = 0;
  private done = 0;
  private bytes = 0;
  private deduplicated = 0;
  private lastProgressAt = 0;
  private readonly estimate = new TimeEstimate();
  private readonly work = { messages: 0, bytes: 0 };
  private lastTransferAt: number | null = null;
  /** Shared steps not yet charged: so many messages still carry this many seconds each. */
  private readonly overhead = { seconds: 0, messages: 0 };

  constructor(kind: Report['kind'], options: JobOptions) {
    this.kind = kind;
    this.signal = options.signal;
    this.onProgress = options.onProgress;
  }

  get aborted(): boolean {
    return this.signal?.aborted ?? false;
  }

  throwIfAborted(): void {
    if (this.aborted) throw new CancelledError();
  }

  emit(event: ProgressEvent): void {
    try {
      this.onProgress?.(event);
    } catch {
      // A failing progress listener must not break the transfer.
    }
  }

  warn(message: string, details: { folder?: string; subject?: string | null } = {}): void {
    this.emit({
      type: 'warning',
      message,
      ...(details.folder ? { folder: details.folder } : {}),
      ...(details.subject ? { subject: details.subject } : {}),
    });
  }

  setTotal(total: number): void {
    this.total = total;
    this.emitProgress(true);
  }

  addToTotal(count: number): void {
    this.total += count;
  }

  advance(count = 1, bytes = 0): void {
    this.done += count;
    this.bytes += bytes;
    this.emitProgress(this.done >= this.total);
  }

  countDeduplicated(count = 1): void {
    this.deduplicated += count;
  }

  /** Messages that will have to cross the network, and their size: the base of the time estimate. */
  addWork(messages: number, bytes: number): void {
    this.work.messages += messages;
    this.work.bytes += bytes;
    this.emitProgress(false);
  }

  /** Planned work that is done, turned out to be unnecessary, or failed. */
  reduceWork(messages: number, bytes: number): void {
    this.work.messages = Math.max(0, this.work.messages - messages);
    this.work.bytes = Math.max(0, this.work.bytes - bytes);
    this.emitProgress(false);
  }

  /** Starts timing transfers; the scan before does not count as transfer time. */
  startTransferClock(): void {
    this.lastTransferAt = Date.now();
  }

  /**
   * Time a step took for several messages at once, like fetching the headers of a batch. It is
   * spread over those messages instead of making the next one look slow. Without messages
   * (a folder with nothing new) the time is simply left out of the estimate.
   */
  spreadOverhead(seconds: number, messages: number): void {
    if (this.lastTransferAt === null || !(seconds > 0)) return;
    this.lastTransferAt += seconds * 1000;
    if (messages <= 0) return;
    const total = this.overhead.seconds * this.overhead.messages + seconds;
    this.overhead.messages += messages;
    this.overhead.seconds = total / this.overhead.messages;
  }

  /** A message crossed the network: the time since the previous one teaches the estimate. */
  recordTransfer(bytes: number): void {
    const now = Date.now();
    if (this.lastTransferAt !== null) {
      let seconds = Math.max(0, (now - this.lastTransferAt) / 1000);
      if (this.overhead.messages > 0) {
        seconds += this.overhead.seconds;
        this.overhead.messages--;
      }
      this.estimate.record(bytes, seconds);
    }
    this.lastTransferAt = now;
  }

  /** Progress of a single large message; null for messages too small to need it. */
  trackMessage(direction: 'download' | 'upload', subject: string | null, size: number): MessageProgress | null {
    if (size < LARGE_MESSAGE_BYTES) return null;
    let lastEmit = Date.now();
    let finished = false;
    // The first bytes include the round trip that started the transfer; the bandwidth is
    // measured from the second step on.
    let measuredFrom: { at: number; bytes: number } | null = null;
    const send = (transferred: number, done: boolean) =>
      this.emit({ type: 'message', direction, subject, size, transferred: Math.min(transferred, size), finished: done });
    send(0, false);
    return {
      update: (transferred) => {
        if (finished) return;
        const now = Date.now();
        if (measuredFrom && transferred > measuredFrom.bytes) {
          this.estimate.recordStream(transferred - measuredFrom.bytes, (now - measuredFrom.at) / 1000);
        }
        measuredFrom = { at: now, bytes: transferred };
        if (now - lastEmit < PROGRESS_INTERVAL_MS) return;
        lastEmit = now;
        send(transferred, false);
      },
      finish: () => {
        if (finished) return;
        finished = true;
        send(size, true);
      },
    };
  }

  folder(path: string, target: string | null = null): FolderReport {
    let report = this.folders.get(path);
    if (!report) {
      report = { path, target, sourceCount: 0, targetCount: null, transferred: 0, skipped: 0, failed: 0, removed: 0, error: null };
      this.folders.set(path, report);
    }
    return report;
  }

  /** Adds a message that could not be transferred to the report; counting is up to the caller. */
  recordFailure(failure: Failure): void {
    this.failures.push(failure);
  }

  /** A whole folder could not be processed; the job goes on with the next one. */
  folderFailed(path: string, reason: string, unprocessed: number): void {
    const report = this.folder(path);
    report.error = reason;
    report.failed += unprocessed;
    this.warn(reason, { folder: path });
  }

  finish(error?: unknown): Report {
    this.emitProgress(true);
    const folders = [...this.folders.values()];
    const sum = (key: 'transferred' | 'skipped' | 'failed' | 'removed') => folders.reduce((acc, folder) => acc + folder[key], 0);
    let status: Report['status'] = 'completed';
    let reportError: Report['error'] = null;
    if (error !== undefined) {
      const kind = this.aborted ? 'cancelled' : classifyError(error);
      status = kind === 'cancelled' ? 'cancelled' : 'failed';
      reportError = kind === 'cancelled' ? null : { kind, message: describeError(error), conflict: conflictOf(error) };
    }
    return {
      kind: this.kind,
      status,
      error: reportError,
      startedAt: this.startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      folders,
      totals: {
        messages: folders.reduce((acc, folder) => acc + folder.sourceCount, 0),
        transferred: sum('transferred'),
        skipped: sum('skipped'),
        failed: sum('failed'),
        removed: sum('removed'),
        bytes: this.bytes,
        deduplicated: this.deduplicated,
      },
      failures: this.failures,
    };
  }

  private emitProgress(force: boolean): void {
    const now = Date.now();
    if (!force && now - this.lastProgressAt < PROGRESS_INTERVAL_MS) return;
    this.lastProgressAt = now;
    this.emit({
      type: 'progress',
      done: this.done,
      total: this.total,
      bytes: this.bytes,
      remainingMessages: this.work.messages,
      remainingBytes: this.work.bytes,
      remainingSeconds: this.estimate.remaining(this.work.messages, this.work.bytes),
    });
  }
}

/**
 * Progress of one unit of work that may be repeated after a reconnect. A repeat starts counting
 * from zero again, but the job only moves forward once it passes what was already reported.
 */
export class RepeatableProgress {
  private readonly job: Job;
  private reported = 0;
  private done = 0;

  constructor(job: Job) {
    this.job = job;
  }

  restart(): void {
    this.done = 0;
  }

  /** Counts the unit as finished, e.g. a folder that had to be skipped. */
  complete(total: number): void {
    this.advance(Math.max(0, total - this.done));
  }

  advance(count = 1, bytes = 0): void {
    this.done += count;
    const delta = Math.max(0, this.done - this.reported);
    this.reported = Math.max(this.reported, this.done);
    this.job.advance(delta, bytes);
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
