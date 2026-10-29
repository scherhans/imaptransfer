import { createHash } from 'node:crypto';

export type Platform = 'mac' | 'windows' | 'linux';
export type Arch = 'arm64' | 'x64';
export type Kind = 'dmg' | 'exe' | 'AppImage' | 'deb';

/** Where the files of the current version live: on this site, next to the pages. */
export const DOWNLOADS = '/downloads/';

/** A place for one installer in the download section. */
export interface Slot {
  key: string;
  platform: Platform;
  arch: Arch;
  kind: Kind;
}

/** Every installer a version can have, in the order the page shows them: the most common first. */
export const SLOTS: readonly Slot[] = [
  { key: 'mac-arm64-dmg', platform: 'mac', arch: 'arm64', kind: 'dmg' },
  { key: 'mac-x64-dmg', platform: 'mac', arch: 'x64', kind: 'dmg' },
  { key: 'windows-x64-exe', platform: 'windows', arch: 'x64', kind: 'exe' },
  { key: 'windows-arm64-exe', platform: 'windows', arch: 'arm64', kind: 'exe' },
  { key: 'linux-x64-AppImage', platform: 'linux', arch: 'x64', kind: 'AppImage' },
  { key: 'linux-x64-deb', platform: 'linux', arch: 'x64', kind: 'deb' },
  { key: 'linux-arm64-AppImage', platform: 'linux', arch: 'arm64', kind: 'AppImage' },
  { key: 'linux-arm64-deb', platform: 'linux', arch: 'arm64', kind: 'deb' },
];

/** A slot with its file. */
export interface Download extends Slot {
  name: string;
  /** A path of the site, or "#example-…" in the preview. */
  url: string;
  size: number;
  sha256: string;
}

/** A file of the app's release folder, measured. */
export interface LocalFile {
  name: string;
  size: number;
  sha256: string;
}

export interface Release {
  version: string;
  /** ISO date of publication. */
  publishedAt: string;
  /** The installers, in slot order. Slots without a file stay empty on the page. */
  downloads: Download[];
  /**
   * Every file of the version that goes to /downloads/: the installers, and what the app's updater
   * reads (the zips, the blockmaps, latest*.yml). Empty in the preview.
   */
  files: LocalFile[];
  /** Made up for the preview: never published. */
  example: boolean;
}

/** Installer names as the app's electron-builder.yml writes them. */
const INSTALLER = /^imaptransfer-(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-(?<platform>mac|windows|linux)-(?<arch>arm64|aarch64|x64|x86_64|amd64)\.(?<kind>dmg|exe|AppImage|deb)$/;
const ARCH: Record<string, Arch> = { arm64: 'arm64', aarch64: 'arm64', x64: 'x64', x86_64: 'x64', amd64: 'x64' };
/** What the updater reads to learn the newest version: latest.yml, latest-mac.yml, latest-linux-arm64.yml. */
const FEED = /^latest(?:-[a-z0-9-]+)?\.yml$/;

const rank = (key: string) => SLOTS.findIndex((slot) => slot.key === key);

export function parseInstaller(name: string): { version: string; slot: Slot } | null {
  const groups = INSTALLER.exec(name)?.groups;
  if (!groups?.version) return null;
  const slot = SLOTS[rank(`${groups.platform}-${ARCH[groups.arch ?? ''] ?? ''}-${groups.kind}`)];
  return slot ? { version: groups.version, slot } : null;
}

/** Orders versions like 0.2.0 < 0.10.0, and a pre-release before its release. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) => {
    const [main = '', pre] = version.split('-', 2);
    return { numbers: main.split('.').map(Number), pre };
  };
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < 3; index++) {
    const difference = (left.numbers[index] ?? 0) - (right.numbers[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === undefined) return 1;
  if (right.pre === undefined) return -1;
  return left.pre.localeCompare(right.pre);
}

/** The newest version among the installers in a folder, or null when there is none. */
export function latestVersion(names: string[]): string | null {
  const versions = names.flatMap((name) => parseInstaller(name)?.version ?? []);
  return versions.sort(compareVersions).at(-1) ?? null;
}

export const isFeed = (name: string): boolean => FEED.test(name);

/** The version an updater feed announces ("version: 0.2.0"). */
export function feedVersion(text: string): string | null {
  return /^version:\s*['"]?([^'"\s]+)/m.exec(text)?.[1] ?? null;
}

/**
 * Whether a file of the release folder belongs to a version: its installers, zips and blockmaps
 * carry the version in their name, and an updater feed names it inside. Everything else in the
 * folder (unpacked apps, builder logs, older versions) stays out.
 */
export function belongsTo(version: string, name: string, feedText?: string): boolean {
  if (name.startsWith(`imaptransfer-${version}-`)) return true;
  return isFeed(name) && feedText !== undefined && feedVersion(feedText) === version;
}

/** The release the page offers, from the measured files of one version. */
export function releaseOf(version: string, files: LocalFile[], publishedAt: string): Release {
  const downloads = files.flatMap((file): Download[] => {
    const found = parseInstaller(file.name);
    if (!found || found.version !== version) return [];
    return [{ ...found.slot, name: file.name, url: `${DOWNLOADS}${file.name}`, size: file.size, sha256: file.sha256 }];
  });
  downloads.sort((a, b) => rank(a.key) - rank(b.key));
  return { version, publishedAt, downloads, files, example: false };
}

/** The checksum list next to the files, in the form `sha256sum --check` reads. */
export function checksumList(files: LocalFile[]): string {
  return [...files]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((file) => `${file.sha256}  ${file.name}\n`)
    .join('');
}

export function installerName(version: string, slot: Slot): string {
  return `imaptransfer-${version}-${slot.platform}-${slot.arch}.${slot.kind}`;
}

/**
 * A release to look at the page with every slot filled. Files found locally (a build in the app's
 * release folder) bring their real size and checksum, so the checker on the page can be tried with
 * them; the others get made-up values. Never published: the page shows a banner.
 */
export function exampleRelease(version: string, local: Map<string, { size: number; sha256: string }>, publishedAt = new Date().toISOString()): Release {
  const downloads = SLOTS.map((slot, index): Download => {
    const name = installerName(version, slot);
    const found = local.get(name);
    return {
      ...slot,
      name,
      url: `#example-${name}`,
      size: found?.size ?? 118_000_000 + index * 1_700_000,
      sha256: found?.sha256 ?? createHash('sha256').update(`example ${name}`).digest('hex'),
    };
  });
  return { version, publishedAt, downloads, files: [], example: true };
}
