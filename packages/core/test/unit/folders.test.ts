import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ListResponse } from 'imapflow';
import { folderFromListEntry, mapFolders, sortFolders, transferableFolders, type AccountLayout, type ListedFolder } from '../../src/folders.ts';

function entry(path: string, options: Partial<ListResponse> = {}): ListResponse {
  return {
    path,
    pathAsListed: path,
    name: path.split('/').pop() ?? path,
    delimiter: '/',
    parent: [],
    parentPath: '',
    flags: new Set(),
    listed: true,
    subscribed: true,
    ...options,
  };
}

function folder(path: string, specialUse: string | null = null, role: ListedFolder['role'] = 'normal', delimiter = '/'): ListedFolder {
  return { path, delimiter, specialUse, role, selectable: true, messages: null, uidNext: null, uidValidity: null };
}

function layout(folders: ListedFolder[], options: Partial<AccountLayout> = {}): AccountLayout {
  return { folders, prefix: '', delimiter: '/', gmail: false, uidplus: true, ...options };
}

const gmailFolders = [
  folder('INBOX', '\\Inbox'),
  folder('Arbeit'),
  folder('Arbeit/Projekte'),
  folder('[Gmail]/Alle Nachrichten', '\\All', 'all'),
  folder('[Gmail]/Gesendet', '\\Sent'),
  folder('[Gmail]/Markiert', '\\Flagged', 'view'),
  folder('[Gmail]/Papierkorb', '\\Trash'),
];

describe('folderFromListEntry', () => {
  it('only treats server-marked folders as views', () => {
    assert.equal(folderFromListEntry(entry('[Gmail]/Markiert', { specialUse: '\\Flagged', specialUseSource: 'extension' })).role, 'view');
    assert.equal(folderFromListEntry(entry('Starred', { specialUse: '\\Flagged', specialUseSource: 'name' })).role, 'normal');
    assert.equal(folderFromListEntry(entry('[Gmail]/Wichtig', { flags: new Set(['\\Important']) })).role, 'view');
    assert.equal(folderFromListEntry(entry('[Gmail]/All Mail', { specialUse: '\\All', specialUseSource: 'extension' })).role, 'all');
    assert.equal(folderFromListEntry(entry('inbox')).specialUse, '\\Inbox');
    assert.equal(folderFromListEntry(entry('[Gmail]', { flags: new Set(['\\Noselect']) })).selectable, false);
  });
});

describe('sortFolders', () => {
  it('puts the inbox first, user folders next and All Mail last', () => {
    const sorted = sortFolders(gmailFolders).map((item) => item.path);
    assert.deepEqual(sorted, [
      'INBOX',
      '[Gmail]/Markiert',
      'Arbeit',
      'Arbeit/Projekte',
      '[Gmail]/Gesendet',
      '[Gmail]/Papierkorb',
      '[Gmail]/Alle Nachrichten',
    ]);
  });

  it('leaves out views and excluded folders', () => {
    const paths = transferableFolders(gmailFolders, ['[Gmail]/Papierkorb']).map((item) => item.path);
    assert.equal(paths.includes('[Gmail]/Markiert'), false);
    assert.equal(paths.includes('[Gmail]/Papierkorb'), false);
  });
});

describe('mapFolders', () => {
  it('maps Gmail to a classic server with namespace prefix', () => {
    const target = layout(
      [folder('INBOX', '\\Inbox', 'normal', '.'), folder('INBOX.Sent', '\\Sent', 'normal', '.'), folder('INBOX.Trash', '\\Trash', 'normal', '.')],
      { prefix: 'INBOX.', delimiter: '.' },
    );
    const mapping = Object.fromEntries(mapFolders(gmailFolders, { prefix: '', gmail: true }, target).map((item) => [item.source, item]));
    assert.equal(mapping['INBOX']?.target, 'INBOX');
    assert.equal(mapping['Arbeit/Projekte']?.target, 'INBOX.Arbeit.Projekte');
    assert.equal(mapping['Arbeit/Projekte']?.exists, false);
    assert.equal(mapping['[Gmail]/Gesendet']?.target, 'INBOX.Sent');
    assert.equal(mapping['[Gmail]/Gesendet']?.exists, true);
    assert.equal(mapping['[Gmail]/Papierkorb']?.target, 'INBOX.Trash');
    assert.equal(mapping['[Gmail]/Alle Nachrichten']?.target, 'INBOX.Archive');
    assert.equal(mapping['[Gmail]/Markiert'], undefined);
  });

  it('maps a classic server to Gmail', () => {
    const source = [folder('INBOX', '\\Inbox', 'normal', '.'), folder('INBOX.Sent', '\\Sent', 'normal', '.'), folder('INBOX.Kunden.A', null, 'normal', '.')];
    const mapping = Object.fromEntries(mapFolders(source, { prefix: 'INBOX.', gmail: false }, layout(gmailFolders, { gmail: true })).map((item) => [item.source, item.target]));
    assert.equal(mapping['INBOX.Sent'], '[Gmail]/Gesendet');
    assert.equal(mapping['INBOX.Kunden.A'], 'Kunden/A');
  });

  it('uses the archive of the target for All Mail when it has no All folder', () => {
    const target = layout([folder('INBOX', '\\Inbox'), folder('Archiv', '\\Archive')]);
    const [all] = mapFolders([folder('[Gmail]/All Mail', '\\All', 'all')], { prefix: '', gmail: true }, target);
    assert.equal(all?.target, 'Archiv');
  });

  it('maps only the first source folder of a special kind onto the target special folder', () => {
    const source = [folder('Sent', '\\Sent'), folder('Sent Items', '\\Sent')];
    const target = layout([folder('INBOX', '\\Inbox'), folder('Gesendet', '\\Sent')]);
    const mapping = mapFolders(source, { prefix: '', gmail: false }, target).map((item) => item.target);
    assert.deepEqual(mapping.sort(), ['Gesendet', 'Sent Items']);
  });

  it('moves subfolders along with a renamed special folder', () => {
    const source = [folder('Sent', '\\Sent'), folder('Sent/2023'), folder('Sent/2023/Q1')];
    const target = layout([folder('INBOX', '\\Inbox', 'normal', '.'), folder('Gesendet', '\\Sent', 'normal', '.')], { delimiter: '.' });
    const mapping = mapFolders(source, { prefix: '', gmail: false }, target).map((item) => [item.source, item.target]);
    assert.deepEqual(Object.fromEntries(mapping), { Sent: 'Gesendet', 'Sent/2023': 'Gesendet.2023', 'Sent/2023/Q1': 'Gesendet.2023.Q1' });
  });

  it('uses the spelling of a folder the target already has', () => {
    // Exchange, Gmail and Dovecot on a case-insensitive disk treat "Projects" and "projects"
    // as one folder: creating the other spelling fails, and the mail belongs in the existing one.
    const target = layout([folder('INBOX', '\\Inbox'), folder('projects'), folder('Kunden/Müller'.normalize('NFD'))]);
    const mapping = Object.fromEntries(mapFolders([folder('Projects'), folder('Kunden/Müller'), folder('New')], { prefix: '', gmail: false }, target).map((item) => [item.source, item]));
    assert.deepEqual([mapping['Projects']?.target, mapping['Projects']?.exists], ['projects', true]);
    assert.deepEqual([mapping['Kunden/Müller']?.target, mapping['Kunden/Müller']?.exists], ['Kunden/Müller'.normalize('NFD'), true]);
    assert.deepEqual([mapping['New']?.target, mapping['New']?.exists], ['New', false]);
  });

  it('replaces the target delimiter inside folder names', () => {
    const source = [folder('Kunden/Meier.Müller', null)];
    const target = layout([folder('INBOX', '\\Inbox', 'normal', '.')], { delimiter: '.' });
    assert.equal(mapFolders(source, { prefix: '', gmail: false }, target)[0]?.target, 'Kunden.Meier_Müller');
  });
});
