import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { folderDirectory, messageFileName, safeName, uniquePath } from '../../src/store/paths.ts';

describe('safeName', () => {
  it('replaces characters that Windows does not allow', () => {
    assert.equal(safeName('Re: a/b\\c*d?e"f<g>h|i'), 'Re_ a_b_c_d_e_f_g_h_i');
  });

  it('protects reserved device names and trailing dots', () => {
    assert.equal(safeName('CON'), '_CON');
    assert.equal(safeName('nul.txt'), '_nul.txt');
    assert.equal(safeName('Ordner. . '), 'Ordner');
    assert.equal(safeName('...'), '_');
    assert.equal(safeName(''), '_');
  });

  it('cuts long names by bytes without splitting characters', () => {
    const name = safeName('😀'.repeat(100), 10);
    assert.equal(name, '😀😀');
    assert.ok(Buffer.byteLength(safeName('ü'.repeat(300))) <= 200);
  });
});

describe('folderDirectory', () => {
  it('turns folder levels into directory levels', () => {
    assert.equal(folderDirectory('INBOX.Archiv.2024', '.'), 'INBOX/Archiv/2024');
    assert.equal(folderDirectory('[Gmail]/Gesendet', '/'), '[Gmail]/Gesendet');
    assert.equal(folderDirectory('a:b', ''), 'a_b');
  });
});

describe('messageFileName', () => {
  it('is sortable by date and readable', () => {
    const name = messageFileName({ date: new Date('2024-05-03T10:00:00Z'), subject: 'Rechnung: Mai', fingerprint: 'abcdef0123456789' });
    assert.equal(name, '2024-05-03_Rechnung_ Mai_abcdef0123.eml');
  });

  it('stays below 255 bytes even for a subject full of emoji', () => {
    const name = messageFileName({ date: new Date('2024-05-03T10:00:00Z'), subject: '🎉'.repeat(200), fingerprint: 'ab'.repeat(32), hashLength: 64 });
    assert.ok(Buffer.byteLength(name) <= 255, `${Buffer.byteLength(name)} bytes`);
  });

  it('handles missing date and subject', () => {
    assert.equal(messageFileName({ date: null, subject: null, fingerprint: 'ff'.repeat(32) }), '0000-00-00_no-subject_ffffffffff.eml');
  });
});

describe('uniquePath', () => {
  it('numbers taken names', () => {
    const taken = new Set(['a', 'a (2)']);
    assert.equal(uniquePath('a', (path) => taken.has(path)), 'a (3)');
    assert.equal(uniquePath('b', (path) => taken.has(path)), 'b');
  });
});
