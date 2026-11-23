// Reading the song from an Ultimate Guitar tab page.
// UG embeds the page's data as JSON in <div class="js-store" data-content="...">:
//   store.page.data.tab                    song_name, artist_name, type, id, tab_url
//   store.page.data.tab_view.meta          capo, tonality, tuning.name
//   store.page.data.tab_view.wiki_tab      content (the song text in UG markup)

import type { Song } from './types.ts';

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Build a Song from UG's page data, or null when the page has no song text. */
export function songFromStore(data: any): Song | null {
  const tab = data?.tab;
  const view = data?.tab_view;
  const content = view?.wiki_tab?.content;
  if (!tab || typeof content !== 'string' || !content.trim()) return null;
  const meta = view.meta ?? {};
  const capo = Number(meta.capo);
  return {
    id: String(tab.id ?? str(tab.tab_url, 500)),
    title: str(tab.song_name) || 'Untitled',
    artist: str(tab.artist_name) || 'Unknown artist',
    type: str(tab.type, 40) || undefined,
    key: str(meta.tonality, 12) || str(tab.tonality_name, 12) || undefined,
    capo: Number.isFinite(capo) && capo > 0 && capo <= 24 ? capo : undefined,
    tuning: str(meta.tuning?.name, 60) || undefined,
    content,
  };
}

/** The page data inside a document, plus the tab URL it describes. */
function storeData(doc: Document): any {
  const el = doc.querySelector<HTMLElement>('.js-store');
  if (!el?.dataset.content) return null;
  try { return JSON.parse(el.dataset.content).store.page.data; } catch { return null; }
}

const samePage = (data: any, url: string) => {
  try { return new URL(data.tab.tab_url).pathname === new URL(url).pathname; } catch { return false; }
};

/**
 * Read the song for the current page. UG can change pages without a full reload, which leaves
 * the embedded data describing the previous song; in that case fetch the page fresh.
 */
export async function readCurrentSong(doc: Document = document, url = location.href): Promise<Song | null> {
  const data = storeData(doc);
  if (data && samePage(data, url)) return songFromStore(data);
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return null;
  const fresh = new DOMParser().parseFromString(await res.text(), 'text/html');
  return songFromStore(storeData(fresh));
}

/** Tab pages look like /tab/<artist>/<song>-<type>-<id>. */
export const isTabPage = (url = location.href) => /^\/tab\/[^/]+\/[^/]+/.test(new URL(url).pathname);
