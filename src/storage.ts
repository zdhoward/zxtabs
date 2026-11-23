// Saved settings: chrome.storage.local, or localStorage when the script runs outside the extension.

import type { GlobalSettings, ReaderSettings } from './types.ts';

const ext = typeof chrome !== 'undefined' && chrome.storage?.local;

async function get<T>(key: string): Promise<T | undefined> {
  if (ext) return (await chrome.storage.local.get(key))[key];
  try { const v = localStorage.getItem('zxtabs:' + key); return v ? JSON.parse(v) : undefined; } catch { return undefined; }
}

async function set(key: string, value: unknown): Promise<void> {
  if (ext) return chrome.storage.local.set({ [key]: value });
  try { localStorage.setItem('zxtabs:' + key, JSON.stringify(value)); } catch { /* storage blocked */ }
}

const DEFAULT_GLOBAL: GlobalSettings = { autoOpen: true };

export const storage = {
  songSettings: (id: string) => get<Partial<ReaderSettings>>('song:' + id),
  saveSongSettings: (id: string, s: ReaderSettings) => set('song:' + id, s),
  // Written only by the toolbar popup (public/popup.js).
  global: async (): Promise<GlobalSettings> => ({ ...DEFAULT_GLOBAL, ...(await get<GlobalSettings>('global')) }),
};
