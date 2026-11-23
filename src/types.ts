/** How one song is displayed. Saved per song. */
export interface ReaderSettings {
  /** Pick the column count that gives the largest text in this window. */
  autoCols: boolean;
  /** Column count used when autoCols is off. */
  cols: number;
  /** Shrink or grow the text so the whole song fits on screen. */
  fit: boolean;
  /** Text size in px used when fit is off. */
  size: number;
  /** Transpose in semitones. */
  tr: number;
  /** Show lyrics with chords. */
  chords: boolean;
  /** Show everything else (tablature, chord shapes, notes) after the song. */
  tabs: boolean;
}

/** Settings shared by every song. */
export interface GlobalSettings {
  /**
   * Reader view is on: every UG tab page opens in the reader. Set from the toolbar popup;
   * stored as "global" in chrome.storage.local (public/popup.js writes the same key).
   */
  autoOpen: boolean;
}

/** A song read from an Ultimate Guitar tab page. */
export interface Song {
  /** UG's tab id; settings are stored under it. */
  id: string;
  title: string;
  artist: string;
  key?: string;
  capo?: number;
  tuning?: string;
  /** UG tab type, e.g. "Chords", "Tabs". */
  type?: string;
  /** Song text in UG markup ([ch]..[/ch], [tab]..[/tab], [Section]). */
  content: string;
}
