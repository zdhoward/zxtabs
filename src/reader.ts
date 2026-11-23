// The full-screen reader: the song in N columns, a toolbar that fades while you play,
// keyboard shortcuts, and fit-to-screen sizing.

import { parseSong, type ParsedSong } from './parse.ts';
import { renderSheet } from './render.ts';
import type { ReaderSettings, Song } from './types.ts';

const MIN = 11, MAX = 40, MAX_COLS = 9;
const IDLE_MS = 2500;

const svg = (d: string, w = 2) =>
  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  minus: svg('<path d="M5 12h14"/>', 2.2),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 2.2),
  full: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
};

export function defaultSettings(p: ParsedSong): ReaderSettings {
  return {
    autoCols: true, cols: 4, fit: true, size: 16, tr: 0,
    chords: p.hasChords || !p.hasRest,
    tabs: !p.hasChords && p.hasRest,
  };
}

export interface ReaderOptions {
  root: ShadowRoot;
  song: Song;
  saved?: Partial<ReaderSettings>;
  onSave: (s: ReaderSettings) => void;
  onClose: () => void;
}

export class Reader {
  private o: ReaderOptions;
  private parsed: ParsedSong;
  private s: ReaderSettings;
  private el: HTMLElement;
  private sheet: HTMLElement;
  private maxChars = 0;
  /** Character width as a fraction of font size, measured from the real font. */
  private charRatio = 0.6;
  private shownCols = 4;
  private shownSize = 16;
  private idleTimer = 0;
  private saveTimer = 0;
  private frame = 0;
  private off: Array<() => void> = [];

  constructor(o: ReaderOptions) {
    this.o = o;
    this.parsed = parseSong(o.song.content);
    this.s = { ...defaultSettings(this.parsed), ...o.saved };
    if (!this.parsed.hasRest) this.s.tabs = false;
    if (!this.parsed.hasSong) this.s.chords = false;
    if (!this.s.chords && !this.s.tabs) this.s.chords = true;

    this.el = document.createElement('div');
    this.el.className = 'zx reader';
    this.el.innerHTML = `
      <article class="sheet" tabindex="-1"></article>
      <div class="bar" role="toolbar" aria-label="Reader controls">
        <div class="grp"><button class="ib" data-a="close" title="Back to Ultimate Guitar (Esc)" aria-label="Close reader">${ICON.back}</button></div>
        <div class="grp">
          <span class="lbl">Columns</span>
          <button class="tog" data-a="auto" title="Pick the column count that fits this window best (A)">Auto</button>
          <button class="ib" data-a="colDn" title="Fewer columns (1–9)" aria-label="Fewer columns">${ICON.minus}</button>
          <span class="val" data-v="cols"></span>
          <button class="ib" data-a="colUp" title="More columns (1–9)" aria-label="More columns">${ICON.plus}</button>
        </div>
        <div class="grp">
          <button class="tog" data-a="chords" title="Lyrics with chords (C)">Chords</button>
          <button class="tog" data-a="tabs" title="Tablature and notes, after the song (T)">Tabs</button>
        </div>
        <div class="grp">
          <button class="tog" data-a="fit" title="Fit the whole song on screen">Fit</button>
          <button class="ib" data-a="szDn" title="Smaller text (-)" aria-label="Smaller text">${ICON.minus}</button>
          <span class="val" data-v="size"></span>
          <button class="ib" data-a="szUp" title="Larger text (=)" aria-label="Larger text">${ICON.plus}</button>
        </div>
        <div class="grp">
          <span class="lbl">Transpose</span>
          <button class="ib" data-a="trDn" title="Transpose down ([)" aria-label="Transpose down">${ICON.minus}</button>
          <span class="val" data-v="tr"></span>
          <button class="ib" data-a="trUp" title="Transpose up (])" aria-label="Transpose up">${ICON.plus}</button>
        </div>
        <div class="grp">
          <button class="ib" data-a="full" title="Fullscreen (F)" aria-label="Fullscreen">${ICON.full}</button>
        </div>
      </div>`;
    this.sheet = this.el.querySelector('.sheet')!;
    o.root.append(this.el);

    this.el.querySelector('.bar')!.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button[data-a]');
      if (b) this.act(b.dataset.a!);
    });
    this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent), true);
    this.listen(window, 'resize', () => this.schedule());
    this.listen(this.el, 'mousemove', () => this.wake());

    this.measureChar();
    this.render();
    this.wake();
    this.sheet.focus({ preventScroll: true });
    document.fonts?.ready.then(() => { this.measureChar(); this.layout(); });
  }

  destroy() {
    clearTimeout(this.idleTimer);
    cancelAnimationFrame(this.frame);
    this.flushSave();
    this.off.forEach((f) => f());
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    this.el.remove();
  }

  private listen(t: EventTarget, type: string, fn: (e: Event) => void, capture = false) {
    t.addEventListener(type, fn, capture);
    this.off.push(() => t.removeEventListener(type, fn, capture));
  }

  // ---------- actions ----------

  private set(patch: Partial<ReaderSettings>) {
    const rerender = 'tr' in patch || 'chords' in patch || 'tabs' in patch;
    Object.assign(this.s, patch);
    rerender ? this.render() : this.layout();
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), 400);
  }

  private flushSave() {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    this.o.onSave({ ...this.s });
  }

  private act(a: string) {
    const s = this.s;
    const clampCols = (n: number) => Math.min(MAX_COLS, Math.max(1, n));
    switch (a) {
      case 'close': return this.o.onClose();
      case 'auto': return this.set({ autoCols: !s.autoCols });
      case 'colDn': return this.set({ autoCols: false, cols: clampCols(this.shownCols - 1) });
      case 'colUp': return this.set({ autoCols: false, cols: clampCols(this.shownCols + 1) });
      // never let both views be off: switching one off brings the other on
      case 'chords': return this.set({ chords: !s.chords, tabs: s.chords && !s.tabs ? true : s.tabs });
      case 'tabs': return this.set({ tabs: !s.tabs, chords: s.tabs && !s.chords ? true : s.chords });
      case 'fit': return this.set({ fit: !s.fit, size: Math.round(this.shownSize) });
      case 'szDn': return this.set({ fit: false, size: Math.max(MIN, Math.round(this.shownSize) - 1) });
      case 'szUp': return this.set({ fit: false, size: Math.min(MAX, Math.round(this.shownSize) + 1) });
      case 'trDn': return this.set({ tr: s.tr <= -11 ? 0 : s.tr - 1 });
      case 'trUp': return this.set({ tr: s.tr >= 11 ? 0 : s.tr + 1 });
      case 'full':
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else (this.o.root.host as HTMLElement).requestFullscreen().catch(() => {});
        return;
    }
  }

  private onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    let a: string | null = null;
    if (/^[1-9]$/.test(k)) { this.set({ autoCols: false, cols: Number(k) }); a = ''; }
    else a = ({ a: 'auto', A: 'auto', c: 'chords', C: 'chords', t: 'tabs', T: 'tabs', f: 'full', F: 'full',
      '[': 'trDn', ']': 'trUp', '-': 'szDn', '=': 'szUp', '+': 'szUp', Escape: 'close' } as Record<string, string>)[k] ?? null;
    if (a === null) return;
    // keep UG's own shortcuts from firing underneath
    e.preventDefault();
    e.stopImmediatePropagation();
    if (a) this.act(a);
    this.wake();
  }

  private wake() {
    this.el.classList.remove('idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      if (!this.el.querySelector('.bar:hover, .bar:focus-within')) this.el.classList.add('idle');
    }, IDLE_MS);
  }

  // ---------- drawing ----------

  private render() {
    const out = renderSheet(this.o.song, this.parsed, this.s);
    this.sheet.innerHTML = out.html;
    this.maxChars = out.maxChars;
    this.layout();
  }

  private schedule() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.layout());
  }

  private measureChar() {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-size:100px';
    probe.textContent = '0'.repeat(50);
    this.sheet.append(probe);
    this.charRatio = probe.getBoundingClientRect().width / 50 / 100 || 0.6;
    probe.remove();
  }

  private innerWidth() {
    const cs = getComputedStyle(this.sheet);
    return this.sheet.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  }

  private gap() { return parseFloat(getComputedStyle(this.sheet).columnGap) || 44; }

  /** Does the whole song fit on screen at font size fs in n columns? */
  private fits(fs: number, n: number) {
    this.sheet.style.columnCount = String(n);
    this.sheet.style.fontSize = fs + 'px';
    const colW = (this.innerWidth() - this.gap() * (n - 1)) / n;
    return this.sheet.scrollWidth <= this.sheet.clientWidth + 1 && this.maxChars * this.charRatio * fs <= colW;
  }

  /** Largest font size that fits in n columns, or 0 if even MIN does not. */
  private bestSize(n: number) {
    if (!this.fits(MIN, n)) return 0;
    let lo = MIN, hi = MAX;
    while (hi - lo > 0.2) { const m = (lo + hi) / 2; if (this.fits(m, n)) lo = m; else hi = m; }
    return Math.floor(lo * 10) / 10;
  }

  /** Most columns whose width still holds the widest line at font size fs. */
  private maxColsFor(fs: number) {
    const g = this.gap();
    return Math.floor((this.innerWidth() + g) / (this.maxChars * this.charRatio * fs + g));
  }

  private layout() {
    const s = this.s;
    let n = s.cols, fs = s.size;
    // measure against the full window; pack() narrows the sheet again afterwards
    this.sheet.style.width = '';
    this.sheet.style.right = '';
    if (s.autoCols && s.fit) {
      // the column count that gives the biggest text; fewer columns win near-ties
      let best = 0;
      for (let k = 1; k <= MAX_COLS; k++) { const f = this.bestSize(k); if (f > best + 0.3) { best = f; n = k; } }
      // too small a window for the whole song: minimum size, as many columns as fit, scroll sideways
      if (best) fs = best; else { fs = MIN; n = MAX_COLS; }
    } else if (s.autoCols) {
      // your text size, the fewest columns that hold the whole song
      n = MAX_COLS;
      for (let k = 1; k <= MAX_COLS; k++) if (this.fits(s.size, k)) { n = k; break; }
    } else if (s.fit) {
      fs = this.bestSize(n) || MIN;
    }
    // never let a line spill into the next column
    n = Math.max(1, Math.min(n, this.maxColsFor(fs)));
    this.sheet.style.columnCount = String(n);
    this.sheet.style.fontSize = fs + 'px';
    this.pack(n, fs);
    this.shownCols = n;
    this.shownSize = fs;
    this.updateBar();
  }

  /**
   * Make each column only as wide as the widest line and keep the columns at the left, so
   * the eye has a short jump from one column to the next instead of crossing empty space.
   * Skipped when the song already runs past the window (it scrolls sideways at full width).
   */
  private pack(n: number, fs: number) {
    const full = this.sheet.clientWidth;
    if (this.sheet.scrollWidth > full + 1) return;
    const cs = getComputedStyle(this.sheet);
    const colW = Math.ceil(this.maxChars * this.charRatio * fs) + 2;
    const packed = n * colW + (n - 1) * this.gap() + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    if (packed >= full) return;
    this.sheet.style.right = 'auto';
    this.sheet.style.width = packed + 'px';
    // a narrower column can wrap the title and push content into an extra column: undo
    if (this.sheet.scrollWidth > this.sheet.clientWidth + 1) {
      this.sheet.style.width = '';
      this.sheet.style.right = '';
    }
  }

  private updateBar() {
    const s = this.s;
    const q = <T extends Element>(sel: string) => this.el.querySelector<T>(sel)!;
    q('[data-v="cols"]').textContent = String(this.shownCols);
    q('[data-v="size"]').textContent = String(Math.round(this.shownSize));
    q('[data-v="tr"]').textContent = (s.tr > 0 ? '+' : '') + s.tr;
    const press = (a: string, on: boolean) => q(`[data-a="${a}"]`).setAttribute('aria-pressed', String(on));
    press('auto', s.autoCols); press('chords', s.chords); press('tabs', s.tabs);
    press('fit', s.fit);
    q<HTMLButtonElement>('[data-a="colDn"]').disabled = this.shownCols <= 1;
    q<HTMLButtonElement>('[data-a="colUp"]').disabled = this.shownCols >= MAX_COLS;
    q<HTMLButtonElement>('[data-a="chords"]').disabled = !this.parsed.hasSong;
    q<HTMLButtonElement>('[data-a="tabs"]').disabled = !this.parsed.hasRest;
  }
}
