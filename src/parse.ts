// Turn UG song text into sections. Each section splits into two parts:
//   song: chord lines, the lyric under each chord line, and other lyric lines
//   rest: everything else (tablature, chord shapes, strumming notation, notes)
// Lines are classified by what they look like, not by UG's [tab] markers: UG wraps ordinary
// chord+lyric pairs in [tab]..[/tab] too.

import { chordSegments, isChord, type Seg } from './chords.ts';

export type SongBlock =
  | { kind: 'pair'; chords: Seg[]; lyric: string }
  | { kind: 'chords'; chords: Seg[] }
  /** A lyric line; may contain inline [ch] chords. */
  | { kind: 'text'; line: string }
  /** A paragraph break inside a section. */
  | { kind: 'gap' };

/** Consecutive lines of tablature/notation, kept together as written. May contain [ch] tags. */
export interface RestBlock { lines: string[] }

export interface Section {
  label: string | null;
  song: SongBlock[];
  rest: RestBlock[];
}

export interface ParsedSong {
  sections: Section[];
  /** Any chord lines or lyric lines at all. */
  hasSong: boolean;
  /** Any chords in the song part (a pure tablature page has none). */
  hasChords: boolean;
  /** Any tablature, chord shapes or notes. */
  hasRest: boolean;
}

type LineKind = 'blank' | 'header' | 'chords' | 'inline' | 'rest' | 'text';

const CH = /\[ch\](.*?)\[\/ch\]/g;
const HEADER = /^\s*\[([^\][]+)\]\s*(.{0,40})$/;
/** Text that may sit on a chord line besides chords: bars, repeats, dashes. */
const CHORD_LINE_EXTRAS = /^[\s|\-x×\d().\/:*~%]*$/i;
const SEPARATOR = /^(?:\||\/|-+|x?\d+x?|\(x?\d+x?\)|\*+|%|:?\|\|?:?)$/i;

function headerOf(line: string): string | null {
  const m = line.match(HEADER);
  if (!m || m[1] === 'ch' || m[1] === 'tab' || m[1].startsWith('/') || m[2].includes('[ch]')) return null;
  return (m[1] + (m[2].trim() ? ' ' + m[2].trim() : '')).trim();
}

function isChordLine(line: string, plain: boolean): boolean {
  if (line.includes('[ch]')) {
    // Besides tagged chords, allow bars and repeats, and untagged chord-like tokens such as N.C.
    const left = line.replace(CH, ' ').trim().split(/\s+/).filter(Boolean);
    return left.every((t) => CHORD_LINE_EXTRAS.test(t) || isChord(t));
  }
  if (!plain) return false;
  const tokens = line.trim().split(/\s+/).filter((t) => !SEPARATOR.test(t));
  return tokens.length > 0 && tokens.every(isChord);
}

/** Tablature, chord shapes and other notation: symbols and digits rather than words. */
function isNotation(line: string): boolean {
  const s = line.replace(CH, '$1');
  const visible = s.replace(/\s/g, '');
  if (!visible) return false;
  if (/^\s*[a-gA-G][#b]?\s*[|:]?[-–\d|]{3}/.test(s) && /-{2,}/.test(s)) return true; // e|--3--
  if (/(?:^|\s)[xX0-9]{6}(?:\s|$)/.test(s)) return true; // chord shape: x02033
  if (/(?:^|\s)[xX\d]{1,2}(?:-[xX\d]{1,2}){5}(?:\(|\s|$)/.test(s)) return true; // chord shape: x-3-2-0-3-3
  const letters = (visible.match(/[a-zA-Z]/g) ?? []).length;
  return /[-–=_~]{3,}|\|/.test(s) && letters / visible.length < 0.5;
}

function classify(line: string, plain: boolean): LineKind {
  if (!line.trim()) return 'blank';
  if (headerOf(line) !== null) return 'header';
  if (isChordLine(line, plain)) return 'chords';
  if (isNotation(line)) return 'rest';
  if (line.includes('[ch]')) return 'inline';
  return 'text';
}

export function parseSong(content: string): ParsedSong {
  const lines = content.replace(/\r/g, '').replace(/\[\/?tab\]/g, '').split('\n');
  const plain = !content.includes('[ch]');
  const kinds = lines.map((l) => classify(l, plain));
  const hasHeaders = kinds.includes('header');

  const sections: Section[] = [];
  let cur: Section = { label: null, song: [], rest: [] };
  sections.push(cur);
  // Free text before the first [Section] is a note about the tab, not lyrics.
  let preamble = hasHeaders;
  let restGroup: RestBlock | null = null;
  let gap = false;

  const addSong = (b: SongBlock) => {
    if (gap && cur.song.length && cur.song[cur.song.length - 1].kind !== 'gap') cur.song.push({ kind: 'gap' });
    gap = false;
    restGroup = null;
    cur.song.push(b);
  };
  const addRest = (line: string) => {
    if (!restGroup) { restGroup = { lines: [] }; cur.rest.push(restGroup); }
    restGroup.lines.push(line);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kind = kinds[i];
    const next = kinds[i + 1];

    if (kind === 'header') {
      cur = { label: headerOf(line), song: [], rest: [] };
      sections.push(cur);
      preamble = false; restGroup = null; gap = false;
      continue;
    }
    if (kind === 'blank') { gap = true; restGroup = null; continue; }

    if (kind === 'chords') {
      if (next === 'rest') addRest(line); // chord names written over a tab staff
      else if (next === 'text') { addSong({ kind: 'pair', chords: chordSegments(line), lyric: lines[++i] }); }
      else addSong({ kind: 'chords', chords: chordSegments(line) });
      continue;
    }
    if (kind === 'rest' || ((kind === 'text' || kind === 'inline') && preamble)) {
      addRest(line);
      continue;
    }
    addSong({ kind: 'text', line });
  }

  // Sections before the first one with chords that hold no chords themselves but do hold
  // notation are notes about the tab (chord shape lists and the like): move their text to rest.
  const hasChordBlock = (s: Section) => s.song.some((b) => b.kind === 'pair' || b.kind === 'chords' || (b.kind === 'text' && b.line.includes('[ch]')));
  const firstChords = sections.findIndex(hasChordBlock);
  for (const s of sections.slice(0, Math.max(firstChords, 0))) {
    if (!s.rest.length || !s.song.length) continue;
    const text = s.song.filter((b) => b.kind === 'text').map((b) => (b as { line: string }).line);
    if (text.length) s.rest.push({ lines: text });
    s.song = [];
  }

  for (const s of sections) while (s.song.length && s.song[s.song.length - 1].kind === 'gap') s.song.pop();
  const kept = sections.filter((s) => s.song.length || s.rest.length);
  return {
    sections: kept,
    hasSong: kept.some((s) => s.song.length > 0),
    hasChords: kept.some((s) => s.song.some((b) => b.kind === 'pair' || b.kind === 'chords' || (b.kind === 'text' && b.line.includes('[ch]')))),
    hasRest: kept.some((s) => s.rest.length > 0),
  };
}
