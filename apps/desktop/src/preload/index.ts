import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DuplicateSearchProgress, ImaptransferApi, JobState } from '../shared/api';

const api: ImaptransferApi = {
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    defaultBackupDirectory: (name) => ipcRenderer.invoke('app:defaultBackupDirectory', name),
    updateSettings: (change) => ipcRenderer.invoke('app:updateSettings', change),
  },
  providers: () => ipcRenderer.invoke('providers'),
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    save: (draft) => ipcRenderer.invoke('accounts:save', draft),
    remove: (id) => ipcRenderer.invoke('accounts:remove', id),
    test: (draft) => ipcRenderer.invoke('accounts:test', draft),
    folders: (id) => ipcRenderer.invoke('accounts:folders', id),
    signInMicrosoft: (loginHint) => ipcRenderer.invoke('accounts:signInMicrosoft', loginHint),
    setBackupDirectory: (id, directory) => ipcRenderer.invoke('accounts:setBackupDirectory', id, directory),
  },
  backups: {
    inspect: (directory) => ipcRenderer.invoke('backups:inspect', directory),
  },
  jobs: {
    start: (request) => ipcRenderer.invoke('jobs:start', request),
    cancel: () => ipcRenderer.invoke('jobs:cancel'),
    current: () => ipcRenderer.invoke('jobs:current'),
    dismiss: () => ipcRenderer.invoke('jobs:dismiss'),
    plan: (request) => ipcRenderer.invoke('jobs:plan', request),
    findDuplicates: (accountId) => ipcRenderer.invoke('jobs:findDuplicates', accountId),
    cancelFindDuplicates: () => ipcRenderer.invoke('jobs:cancelFindDuplicates'),
    onDuplicateProgress(listener) {
      const handler = (_event: IpcRendererEvent, progress: DuplicateSearchProgress) => listener(progress);
      ipcRenderer.on('jobs:duplicateProgress', handler);
      return () => ipcRenderer.removeListener('jobs:duplicateProgress', handler);
    },
    onUpdate(listener) {
      const handler = (_event: IpcRendererEvent, state: JobState) => listener(state);
      ipcRenderer.on('jobs:update', handler);
      return () => ipcRenderer.removeListener('jobs:update', handler);
    },
    onAccountsChanged(listener) {
      const handler = () => listener();
      ipcRenderer.on('accounts:changed', handler);
      return () => ipcRenderer.removeListener('accounts:changed', handler);
    },
  },
  dialogs: {
    chooseDirectory: (options) => ipcRenderer.invoke('dialogs:chooseDirectory', options),
  },
  shell: {
    openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },
};

contextBridge.exposeInMainWorld('imaptransfer', api);
