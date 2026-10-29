import assert from 'node:assert/strict';
import { basename, dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { defaultSyncState, stateDirectory } from '../src/state.ts';

describe('sync state', () => {
  it('lives where each system keeps data of a program', () => {
    assert.equal(stateDirectory({}, 'darwin', '/Users/anna'), join('/Users/anna', 'Library', 'Application Support', 'imaptransfer'));
    assert.equal(stateDirectory({}, 'linux', '/home/anna'), join('/home/anna', '.local', 'state', 'imaptransfer'));
    assert.equal(stateDirectory({ XDG_STATE_HOME: '/srv/state' }, 'linux', '/home/anna'), join('/srv/state', 'imaptransfer'));
    assert.equal(stateDirectory({ LOCALAPPDATA: 'C:/Users/anna/AppData/Local' }, 'win32', 'C:/Users/anna'), join('C:/Users/anna/AppData/Local', 'imaptransfer'));
  });

  it('gives every pair of accounts its own file, whatever the case', () => {
    const from = { user: 'anna@firma.de', host: 'mail.agenturserver.de' };
    const to = { user: 'anna@firma.de', host: 'imap.ionos.de' };
    const file = defaultSyncState(from, to, '/state');
    // The system's own separator: /state/sync/… here, \state\sync\… on Windows.
    assert.equal(dirname(file), join('/state', 'sync'));
    assert.match(basename(file), /^[0-9a-f]{16}\.db$/);
    assert.equal(defaultSyncState({ user: 'Anna@Firma.de', host: 'MAIL.agenturserver.de' }, to, '/state'), file);
    assert.notEqual(defaultSyncState(to, from, '/state'), file);
  });
});
