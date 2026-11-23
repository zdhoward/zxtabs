// Chord names: recognising them, transposing them, and laying out a chord line.

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const INDEX: Record<string, number> = {
  Cb: 11, C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, 'B#': 0,
};

const QUALITY = String.raw`(?:maj|min|mi|m|M|dim|aug|sus|add|°|ø|\+|-)?`;
const EXT = String.raw`(?:(?:maj|min|dim|aug|sus|add|no|b|#|\+|-|M)?\d{1,2}|sus|aug|dim|alt|\([^)]*\))*`;
const CHORD_RE = new RegExp(String.raw`^[A-G](?:#|b)?${QUALITY}${EXT}(?:\/[A-G](?:#|b)?)?$`);

/** True when a whitespace-separated token is a chord name, e.g. "Am7", "D/F#", "(Cadd9)". */
export function isChord(token: string): boolean {
  const t = token.replace(/^\(|\)$|\*+$/g, '');
  return t === 'N.C.' || CHORD_RE.test(t);
}

/** Keys usually written with flats; used to pick Bb over A# when transposing. */
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm']);

function shiftNote(note: string, steps: number, flats: boolean): string {
  const i = INDEX[note];
  if (i === undefined) return note;
  return (flats ? FLATS : SHARPS)[(((i + steps) % 12) + 12) % 12];
}

/** Transpose a chord name by `steps` semitones, including a slash bass note. */
export function transposeChord(chord: string, steps: number, flats = false): string {
  if (!steps) return chord;
  return chord
    .replace(/^(\(?)([A-G][#b]?)/, (_, p: string, n: string) => p + shiftNote(n, steps, flats))
    .replace(/\/([A-G][#b]?)/, (_, n: string) => '/' + shiftNote(n, steps, flats));
}

/** Transpose a key such as "F#m"; returns undefined for no key. */
export function transposeKey(key: string | undefined, steps: number): string | undefined {
  if (!key) return key;
  const out = transposeChord(key, steps, false);
  return FLAT_KEYS.has(transposeChord(key, steps, true)) ? transposeChord(key, steps, true) : out;
}

/** Whether chords in this (already transposed) key read better with flats. */
export function prefersFlats(key: string | undefined): boolean {
  return !!key && FLAT_KEYS.has(key);
}

/** One piece of a chord line: a chord, or other text such as "x2" or "|", at its column. */
export interface Seg { col: number; text: string; chord: boolean }

/**
 * Split a chord line into positioned pieces. Accepts UG markup ("[ch]G[/ch]   [ch]D[/ch]")
 * or plain text ("G   D"); columns are counted on the visible text.
 */
export function chordSegments(line: string): Seg[] {
  const segs: Seg[] = [];
  let col = 0;
  const pushText = (s: string) => {
    for (const m of s.matchAll(/\S+/g)) segs.push({ col: col + m.index, text: m[0], chord: isChord(m[0]) });
    col += s.length;
  };
  let last = 0;
  for (const m of line.matchAll(/\[ch\](.*?)\[\/ch\]/g)) {
    pushText(line.slice(last, m.index));
    segs.push({ col, text: m[1], chord: true });
    col += m[1].length;
    last = m.index + m[0].length;
  }
  pushText(line.slice(last));
  return segs;
}

/** A run of text to draw; chord runs are coloured. */
export interface Run { text: string; chord: boolean }

/**
 * Lay out a chord line after transposing. Each chord keeps its original column so it stays
 * over the right syllable; a chord that grew (E -> F#) pushes the next one right by the
 * overlap, always leaving one space between them.
 */
export function layoutChordLine(segs: Seg[], steps: number, flats: boolean): Run[] {
  const runs: Run[] = [];
  let cursor = 0;
  for (const s of segs) {
    const text = s.chord ? transposeChord(s.text, steps, flats) : s.text;
    const at = cursor === 0 ? s.col : Math.max(s.col, cursor + 1);
    if (at > cursor) runs.push({ text: ' '.repeat(at - cursor), chord: false });
    runs.push({ text, chord: s.chord });
    cursor = at + text.length;
  }
  return runs;
}

/** Visible width of a list of runs, in characters. */
export const runsWidth = (runs: Run[]) => runs.reduce((n, r) => n + r.text.length, 0);

/** Pieces of a lyric line that has chords written inline ("[ch]G[/ch]Today is..."). */
export function inlineRuns(line: string, steps: number, flats: boolean): Run[] {
  const runs: Run[] = [];
  let last = 0;
  for (const m of line.matchAll(/\[ch\](.*?)\[\/ch\]/g)) {
    if (m.index > last) runs.push({ text: line.slice(last, m.index), chord: false });
    runs.push({ text: transposeChord(m[1], steps, flats), chord: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) runs.push({ text: line.slice(last), chord: false });
  return runs;
}
