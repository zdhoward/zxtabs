// Build the reader's sheet HTML from a parsed song. Pure: no DOM access, so it is testable.

import { inlineRuns, layoutChordLine, prefersFlats, runsWidth, transposeKey, type Run } from './chords.ts';
import type { ParsedSong } from './parse.ts';
import type { ReaderSettings, Song } from './types.ts';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const runsHTML = (runs: Run[]) => runs.map((r) => (r.chord ? `<span class="ch">${esc(r.text)}</span>` : esc(r.text))).join('');

export interface Sheet {
  html: string;
  /** Widest line in characters; a column must be at least this wide. */
  maxChars: number;
}

export function renderSheet(song: Song, parsed: ParsedSong, s: Pick<ReaderSettings, 'tr' | 'chords' | 'tabs'>): Sheet {
  const key = transposeKey(song.key, s.tr);
  const flats = prefersFlats(key);
  let maxChars = 0;
  const line = (runs: Run[]) => {
    maxChars = Math.max(maxChars, runsWidth(runs));
    return `<span class="ln">${runsHTML(runs) || ' '}</span>`;
  };
  const label = (l: string | null) => (l ? `<div class="sec-label">${esc(l)}</div>` : '');

  const meta = [
    key && `<span>Key <b>${esc(key)}</b></span>`,
    song.capo ? `<span>Capo <b>${song.capo}</b></span>` : '',
    song.tuning && `<span>Tuning <b>${esc(song.tuning)}</b></span>`,
  ].filter(Boolean).join('');
  let html = `<header class="song-head"><h1>${esc(song.title)}</h1><div class="by">${esc(song.artist)}</div>${meta ? `<div class="meta">${meta}</div>` : ''}</header>`;

  if (s.chords) {
    for (const sec of parsed.sections) {
      if (!sec.song.length) continue;
      let inner = '';
      for (const b of sec.song) {
        if (b.kind === 'gap') { inner += '<div class="gap"></div>'; continue; }
        inner += '<div class="block">';
        if (b.kind === 'pair' || b.kind === 'chords') inner += line(layoutChordLine(b.chords, s.tr, flats));
        if (b.kind === 'pair') inner += line([{ text: b.lyric, chord: false }]);
        if (b.kind === 'text') inner += line(inlineRuns(b.line, s.tr, flats));
        inner += '</div>';
      }
      html += `<section class="sec">${label(sec.label)}${inner}</section>`;
    }
  }

  if (s.tabs) {
    let rest = '';
    parsed.sections.forEach((sec, i) => {
      sec.rest.forEach((b, j) => {
        // Label a section once; its later blocks follow as paragraphs.
        const name = j > 0 ? null : sec.label ?? (i === 0 && parsed.sections.length > 1 ? 'Notes' : 'Tab');
        rest += `<section class="sec">${label(name)}<div class="block rest">${b.lines.map((l) => line(inlineRuns(l, s.tr, flats))).join('')}</div></section>`;
      });
    });
    if (rest) html += `<div class="tabs-head">Tabs &amp; notes</div>${rest}`;
  }

  if (!s.chords && !s.tabs) html += '<p class="note">Nothing to show. Turn on Chords or Tabs.</p>';
  return { html, maxChars };
}
