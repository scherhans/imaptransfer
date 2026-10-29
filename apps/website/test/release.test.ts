import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { belongsTo, checksumList, compareVersions, exampleRelease, latestVersion, parseInstaller, releaseOf, SLOTS, type LocalFile } from '../src/release.ts';

const hex = (char: string) => char.repeat(64);
const file = (name: string, char = 'a'): LocalFile => ({ name, size: 120_000_000, sha256: hex(char) });

describe('parseInstaller', () => {
  it('reads version and slot from the names electron-builder writes, in every spelling of the processor', () => {
    assert.deepEqual(parseInstaller('imaptransfer-0.2.0-mac-arm64.dmg'), { version: '0.2.0', slot: SLOTS[0] });
    assert.equal(parseInstaller('imaptransfer-0.2.0-linux-x86_64.AppImage')?.slot.key, 'linux-x64-AppImage');
    assert.equal(parseInstaller('imaptransfer-0.2.0-linux-amd64.deb')?.slot.key, 'linux-x64-deb');
    assert.equal(parseInstaller('imaptransfer-0.2.0-linux-aarch64.AppImage')?.slot.key, 'linux-arm64-AppImage');
    assert.equal(parseInstaller('imaptransfer-1.0.0-rc.1-windows-arm64.exe')?.version, '1.0.0-rc.1');
  });

  it('leaves out what the updater needs but nobody installs', () => {
    for (const name of ['imaptransfer-0.2.0-mac-arm64.zip', 'imaptransfer-0.2.0-mac-arm64.dmg.blockmap', 'latest-mac.yml', 'builder-debug.yml']) {
      assert.equal(parseInstaller(name), null, name);
    }
  });
});

describe('versions', () => {
  it('count numerically and put a pre-release before its release', () => {
    assert.ok(compareVersions('0.10.0', '0.2.0') > 0);
    assert.ok(compareVersions('1.0.0-rc.1', '1.0.0') < 0);
    assert.equal(compareVersions('0.2.0', '0.2.0'), 0);
  });

  it('pick the newest version in a release folder, or none', () => {
    const names = ['imaptransfer-0.2.0-mac-arm64.dmg', 'imaptransfer-0.10.0-mac-arm64.dmg', 'imaptransfer-0.10.0-rc.1-mac-arm64.dmg', 'latest-mac.yml'];
    assert.equal(latestVersion(names), '0.10.0');
    assert.equal(latestVersion(['builder-debug.yml', 'latest.yml']), null);
  });
});

describe('belongsTo', () => {
  it('takes the files of one version and the updater feeds that announce it, nothing else', () => {
    assert.ok(belongsTo('0.2.0', 'imaptransfer-0.2.0-mac-arm64.dmg'));
    assert.ok(belongsTo('0.2.0', 'imaptransfer-0.2.0-mac-arm64.zip'));
    assert.ok(belongsTo('0.2.0', 'imaptransfer-0.2.0-mac-arm64.dmg.blockmap'));
    assert.ok(belongsTo('0.2.0', 'latest-mac.yml', 'version: 0.2.0\nfiles: []\n'));
    assert.ok(belongsTo('0.2.0', 'latest-linux-arm64.yml', "version: '0.2.0'\n"));
    assert.ok(!belongsTo('0.2.0', 'latest.yml', 'version: 0.1.0\n'));
    assert.ok(!belongsTo('0.2.0', 'latest.yml'));
    assert.ok(!belongsTo('0.2.0', 'imaptransfer-0.1.0-mac-arm64.dmg'));
    assert.ok(!belongsTo('0.2.0', 'builder-debug.yml', 'version: 0.2.0\n'));
  });
});

describe('releaseOf', () => {
  it('offers the installers in slot order from this site, and keeps every file for /downloads/', () => {
    const files = [
      file('imaptransfer-0.2.0-linux-arm64.deb', '1'),
      file('imaptransfer-0.2.0-mac-arm64.zip', '2'),
      file('latest-mac.yml', '3'),
      file('imaptransfer-0.2.0-windows-x64.exe', '4'),
      file('imaptransfer-0.2.0-mac-arm64.dmg', '5'),
    ];
    const release = releaseOf('0.2.0', files, '2026-10-29T08:30:00.000Z');
    assert.deepEqual(
      release.downloads.map((download) => download.key),
      ['mac-arm64-dmg', 'windows-x64-exe', 'linux-arm64-deb'],
    );
    assert.equal(release.downloads[0]?.url, '/downloads/imaptransfer-0.2.0-mac-arm64.dmg');
    assert.equal(release.downloads[0]?.sha256, hex('5'));
    assert.equal(release.files.length, files.length);
    assert.equal(release.example, false);
  });
});

describe('checksumList', () => {
  it('writes the form sha256sum --check reads, sorted by name', () => {
    assert.equal(
      checksumList([file('b.exe', 'b'), file('a.dmg', 'a')]),
      `${hex('a')}  a.dmg\n${hex('b')}  b.exe\n`,
    );
  });
});

describe('exampleRelease', () => {
  it('fills every slot, with the real checksum of a file built here', () => {
    const name = 'imaptransfer-0.2.0-mac-arm64.dmg';
    const release = exampleRelease('0.2.0', new Map([[name, { size: 1, sha256: hex('d') }]]), '2026-10-29T00:00:00Z');
    assert.equal(release.example, true);
    assert.equal(release.downloads.length, SLOTS.length);
    assert.equal(release.downloads.find((download) => download.name === name)?.sha256, hex('d'));
    assert.ok(release.downloads.every((download) => download.url.startsWith('#example-')));
    assert.deepEqual(release.files, []);
  });
});
