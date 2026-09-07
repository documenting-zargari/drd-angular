const DIACRITIC_MARKS_RE = /[\u0300-\u036f]/g;
const COMBINING_MARK_RE = /[\u0300-\u036f]/;

/** Lowercases and strips diacritics (e.g. "řom" -> "rom") for accent-insensitive matching. */
export function foldText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(DIACRITIC_MARKS_RE, '');
}

export interface Kwic {
  left: string;
  match: string;
  right: string;
  /** true when `needle` was found in `text` (otherwise the whole string is `left`). */
  hit: boolean;
}

/**
 * Split `text` around the first occurrence of `needle` for keyword-in-context
 * display. Matching is accent- and case-insensitive (via the same folding as
 * foldText) so the highlight lands even when the server matched a folded form;
 * the returned substrings preserve the original casing/diacritics of `text`.
 *
 * foldText drops combining marks, so folded offsets don't line up with the
 * source. We fold char-by-char over NFD(text) and keep a folded-index ->
 * NFD-index map to slice the original back out.
 */
export function kwicSplit(text: string, needle: string): Kwic {
  const src = text ?? '';
  const q = (needle ?? '').trim();
  if (!q) return { left: src, match: '', right: '', hit: false };

  const nfd = src.normalize('NFD');
  let folded = '';
  const map: number[] = []; // map[i] = index in `nfd` of folded char i
  for (let i = 0; i < nfd.length; i++) {
    const ch = nfd[i];
    if (COMBINING_MARK_RE.test(ch)) continue; // combining diacritic
    for (const lc of ch.toLowerCase()) {
      folded += lc;
      map.push(i);
    }
  }

  const foldedNeedle = foldText(q);
  const fIdx = folded.indexOf(foldedNeedle);
  if (fIdx === -1) return { left: src, match: '', right: '', hit: false };

  const start = map[fIdx];
  const endFolded = fIdx + foldedNeedle.length;
  const end = endFolded < map.length ? map[endFolded] : nfd.length;

  return {
    left: nfd.slice(0, start).normalize('NFC'),
    match: nfd.slice(start, end).normalize('NFC'),
    right: nfd.slice(end).normalize('NFC'),
    hit: true,
  };
}
