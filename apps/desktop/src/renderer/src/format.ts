import type { Conflict, ErrorKind, RoundedTime, RunError } from '@imaptransfer/core';
import { CONFLICT_MARK } from '../../shared/api';
import { i18n } from './i18n';

const locale = () => i18n.global.locale.value;

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(locale()).format(value);
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}

/** The day of an ISO date, as people write it here: 09.04.2018. */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium' }).format(new Date(iso));
}

export function formatRelative(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'minute');
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${rest} s`;
  return `${rest} s`;
}

/** The remaining time as the main process rounded it, in the words of the current language. */
export function formatRemainingTime(time: RoundedTime): string {
  const t = i18n.global.t;
  switch (time.kind) {
    case 'calculating':
      return t('job.remaining.calculating');
    case 'under-a-minute':
      return t('job.remaining.underMinute');
    case 'minutes':
      return t('job.remaining.minutes', { n: time.minutes }, time.minutes);
    case 'hours':
      return time.minutes > 0
        ? t('job.remaining.hoursMinutes', { hours: time.hours, minutes: time.minutes })
        : t('job.remaining.hours', { n: time.hours }, time.hours);
  }
}

export function messageCount(count: number): string {
  return i18n.global.t('common.messages', { n: formatNumber(count) }, count);
}

export function folderCount(count: number): string {
  return i18n.global.t('common.folders', { n: formatNumber(count) }, count);
}

/** Errors from the main process arrive as "Error invoking remote method 'x': Error: text". */
export function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const text = raw.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
  return text.startsWith(CONFLICT_MARK) ? conflictText(JSON.parse(text.slice(CONFLICT_MARK.length)) as Conflict) : text;
}

export function explainError(kind: ErrorKind, message: string): string {
  return i18n.global.t(`errors.${kind}`, { message });
}

/** A known conflict, such as a backup folder of another account, in the user's language. */
export function conflictText(conflict: Conflict): string {
  return i18n.global.t(`conflicts.${conflict.code}`, conflict.details);
}

/** Why a run ended, in the user's language. */
export function runErrorText(error: RunError): string {
  return error.conflict ? conflictText(error.conflict) : explainError(error.kind, error.message);
}
