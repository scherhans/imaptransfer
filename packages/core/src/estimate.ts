/** A remaining time rounded the way people talk about it; exact minutes would only flicker. */
export type RoundedTime =
  | { kind: 'calculating' }
  | { kind: 'under-a-minute' }
  | { kind: 'minutes'; minutes: number }
  | { kind: 'hours'; hours: number; minutes: number };

export function roundRemaining(seconds: number | null): RoundedTime {
  if (seconds === null) return { kind: 'calculating' };
  if (seconds < 60) return { kind: 'under-a-minute' };
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return { kind: 'minutes', minutes: minutes < 10 ? minutes : Math.round(minutes / 5) * 5 };
  let hours = Math.floor(minutes / 60);
  let rest = Math.round((minutes % 60) / 10) * 10;
  if (rest === 60) {
    hours++;
    rest = 0;
  }
  return { kind: 'hours', hours, minutes: rest };
}

/** Memory of the estimate: older messages fade out, so a slower or faster phase shows soon. */
const DECAY = 0.98;
const MIN_SAMPLES = 5;
const MIN_SECONDS = 3;
/** Assumed until a large message shows the real bandwidth: 2 MB/s, a cautious broadband value. */
const DEFAULT_BYTES_PER_SECOND = 2_000_000;

/**
 * Learns how long a message takes, as a fixed time per message plus a time per byte. Many
 * small messages are slowed down by the round trips, a few large ones by the bandwidth; a
 * mailbox usually has both, so counting messages or bytes alone would be far off.
 *
 * Each sample is the time between two finished messages, so it includes everything around
 * the transfer: reading headers, switching folders, waiting after a dropped connection.
 */
export class TimeEstimate {
  private weight = 0;
  private sumSize = 0;
  private sumSeconds = 0;
  private sumSizeSquared = 0;
  private sumSizeSeconds = 0;
  private samples = 0;
  private measuredSeconds = 0;
  private streamedBytes = 0;
  private streamedSeconds = 0;

  /**
   * Bytes that flowed while a large message was on its way. This is the bandwidth alone,
   * without the round trips around each message.
   */
  recordStream(bytes: number, seconds: number): void {
    if (!(bytes > 0) || !(seconds > 0)) return;
    this.streamedBytes = this.streamedBytes * DECAY + bytes;
    this.streamedSeconds = this.streamedSeconds * DECAY + seconds;
  }

  private bytesPerSecond(): number {
    return this.streamedSeconds > 0.5 ? this.streamedBytes / this.streamedSeconds : DEFAULT_BYTES_PER_SECOND;
  }

  record(size: number, seconds: number): void {
    if (!(seconds >= 0) || !(size >= 0)) return;
    // One message that took far longer than expected (a pause after a dropped connection)
    // must not make every remaining message look that slow.
    if (this.samples >= MIN_SAMPLES) {
      const { perMessage, perByte } = this.model();
      seconds = Math.min(seconds, Math.max(1, 4 * (perMessage + size * perByte)));
    }
    this.weight = this.weight * DECAY + 1;
    this.sumSize = this.sumSize * DECAY + size;
    this.sumSeconds = this.sumSeconds * DECAY + seconds;
    this.sumSizeSquared = this.sumSizeSquared * DECAY + size * size;
    this.sumSizeSeconds = this.sumSizeSeconds * DECAY + size * seconds;
    this.samples++;
    this.measuredSeconds += seconds;
  }

  /** Seconds for the remaining work, or null while there is too little to go on. */
  remaining(messages: number, bytes: number): number | null {
    if (messages <= 0 && bytes <= 0) return 0;
    if (this.samples < MIN_SAMPLES || this.measuredSeconds < MIN_SECONDS) return null;
    const { perMessage, perByte } = this.model();
    return Math.max(0, messages * perMessage + bytes * perByte);
  }

  /** Least squares fit of seconds = perMessage + size × perByte over the weighted samples. */
  model(): { perMessage: number; perByte: number } {
    const meanSize = this.sumSize / this.weight;
    const meanSeconds = this.sumSeconds / this.weight;
    const variance = this.sumSizeSquared / this.weight - meanSize * meanSize;
    const covariance = this.sumSizeSeconds / this.weight - meanSize * meanSeconds;
    // The sizes must differ enough to tell round trips from bandwidth apart.
    if (meanSize > 0 && variance > (meanSize * 0.25) ** 2) {
      const perByte = covariance / variance;
      const perMessage = meanSeconds - perByte * meanSize;
      if (perByte >= 0 && perMessage >= 0) return { perMessage, perByte };
      if (perByte < 0) return { perMessage: meanSeconds, perByte: 0 };
      return { perMessage: 0, perByte: meanSeconds / meanSize };
    }
    // All messages about the same size: the samples cannot tell round trips from bandwidth.
    // Take the bandwidth seen during large messages (or a cautious default); the rest of the
    // time is round trips. Otherwise a few megabytes after many small messages would look as
    // slow as thousands of small messages.
    const perByte = 1 / this.bytesPerSecond();
    if (meanSize <= 0) return { perMessage: meanSeconds, perByte };
    const byteSeconds = Math.min(meanSeconds, perByte * meanSize);
    return { perMessage: meanSeconds - byteSeconds, perByte: byteSeconds / meanSize };
  }
}
