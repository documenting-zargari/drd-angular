const DIACRITIC_MARKS_RE = /[\u0300-\u036f]/g;

/** Lowercases and strips diacritics (e.g. "řom" -> "rom") for accent-insensitive matching. */
export function foldText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(DIACRITIC_MARKS_RE, '');
}
