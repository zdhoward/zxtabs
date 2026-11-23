// Runs on Ultimate Guitar pages. The toolbar popup's "Reader view" switch turns the reader on
// for every UG tab page; the Reader button and the R key open it on one page. Everything is
// drawn in a shadow root so UG's styles and ours never mix, and UG's own page is hidden while
// the reader is open.

import css from './styles.css?inline';
import { Reader } from './reader.ts';
import { storage } from './storage.ts';
import { isTabPage, readCurrentSong } from './ug.ts';

const FONTS = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap';
const OPEN_ATTR = 'data-zxtabs-open';

function mount(): ShadowRoot {
  // Page-level rules: fonts (@font-face inside a shadow root is ignored) and hiding UG's page
  // while the reader covers it. Our host hangs off <html>, outside <body>, so it stays visible.
  if (!document.querySelector('[data-zxtabs]')) {
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: FONTS });
    link.dataset.zxtabs = '';
    const hide = document.createElement('style');
    hide.dataset.zxtabs = '';
    hide.textContent = `html[${OPEN_ATTR}] { overflow: hidden !important }
html[${OPEN_ATTR}] body { visibility: hidden !important }`;
    document.head.append(link, hide);
  }
  const host = document.createElement('div');
  host.id = 'zxtabs';
  document.documentElement.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  root.append(style);
  return root;
}

const root = mount();
const launch = document.createElement('button');
launch.className = 'launch';
launch.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 5v14M12 5v14M19 5v14"/></svg>Reader <kbd>R</kbd>`;
launch.title = 'Open this song in the ZXTabs reader';
root.append(launch);

let reader: Reader | null = null;
let opening: Promise<void> | null = null;
/** Bumped on every close, so an open that is still loading knows it was cancelled. */
let generation = 0;

function flash(text: string) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  root.append(t);
  setTimeout(() => t.remove(), 3500);
}

function open(): Promise<void> {
  if (reader || !isTabPage()) return Promise.resolve();
  return (opening ??= load().finally(() => { opening = null; }));
}

async function load() {
  const gen = generation;
  try {
    const song = await readCurrentSong();
    if (gen !== generation) return;
    if (!song) { flash('ZXTabs could not find the song text on this page.'); return; }
    const saved = await storage.songSettings(song.id);
    if (gen !== generation) return;
    reader = new Reader({ root, song, saved, onSave: (s) => storage.saveSongSettings(song.id, s), onClose: close });
    document.documentElement.setAttribute(OPEN_ATTR, '');
    sync();
  } catch (e) {
    console.error('[ZXTabs]', e);
    flash('ZXTabs could not open this song.');
  }
}

function close() {
  generation++;
  if (!reader) return;
  reader.destroy();
  reader = null;
  document.documentElement.removeAttribute(OPEN_ATTR);
  sync();
}

/** Show the button only on tab pages while the reader is closed. */
function sync() { launch.hidden = !!reader || !isTabPage(); }

launch.addEventListener('click', () => open());

window.addEventListener('keydown', (e) => {
  if (reader || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'r' && e.key !== 'R')) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  e.preventDefault();
  open();
});

// UG can switch songs without reloading the page; follow along.
let url = location.href;
setInterval(async () => {
  if (location.href === url) return;
  url = location.href;
  const wasOpen = !!reader;
  close();
  sync(); // close() skips this when nothing was open
  if (isTabPage() && (wasOpen || (await storage.global()).autoOpen)) open();
}, 800);

if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
  // The popup asks whether the reader is open here, and switches it on or off.
  chrome.runtime.onMessage.addListener((msg: any, _sender: unknown, reply: (r: unknown) => void) => {
    const state = () => reply({ open: !!reader, tabPage: isTabPage() });
    if (msg?.type === 'zxtabs:state') { state(); return; }
    if (msg?.type === 'zxtabs:set') {
      if (msg.open) { open().then(state); return true; }
      close(); state();
    }
  });
  // Turning Reader view on or off applies to every open UG tab.
  chrome.storage.onChanged.addListener((changes: any, area: string) => {
    if (area !== 'local' || !changes.global) return;
    if (changes.global.newValue?.autoOpen === false) close();
    else open();
  });
}

sync();
storage.global().then((g) => { if (g.autoOpen) open(); });
