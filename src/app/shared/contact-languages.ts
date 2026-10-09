/**
 * Contact-language sample filter ("Current L2 = Russian").
 *
 * Which language an L2 origin level stands for is an attribute of the
 * *sample* (`Sample.contact_languages: [{language, level}]`), so this narrows
 * which samples are searched — a sibling of the country filter. A filter is a
 * token "<level>:<language>" (level an L2 level or "any"), the same format
 * the URL (`l2=`) and the server (`contact_languages`, see
 * roma-server data/origin_languages.py) use. Several tokens match a sample
 * that has any one of them.
 */

export const L2_LEVELS = ['Current-L2', 'Recent-L2', 'Old-L2'] as const;
export const ANY_LEVEL = 'any';

export interface ContactLanguageFilter {
  level: string;     // one of L2_LEVELS, or ANY_LEVEL
  language: string;
}

export function contactLanguageToken(level: string, language: string): string {
  return `${level}:${language}`;
}

export function parseContactLanguageToken(token: string): ContactLanguageFilter | null {
  const i = token.indexOf(':');
  if (i < 0) return null;
  const level = token.slice(0, i).trim();
  const language = token.slice(i + 1).trim();
  if (!language || !(level === ANY_LEVEL || (L2_LEVELS as readonly string[]).includes(level))) return null;
  return { level, language };
}

export function contactLanguageLabel(token: string): string {
  const f = parseContactLanguageToken(token);
  if (!f) return token;
  return `${f.level === ANY_LEVEL ? 'Any L2' : f.level}: ${f.language}`;
}

function entries(sample: any): { language: string; level: string }[] {
  return (Array.isArray(sample?.contact_languages) ? sample.contact_languages : [])
    .filter((e: any) => e && typeof e.language === 'string' && e.language.trim())
    .map((e: any) => ({ language: e.language.trim(), level: e.level ?? '' }));
}

/** True when `tokens` is empty or the sample lists any of them. */
export function sampleMatchesContactLanguages(sample: any, tokens: string[]): boolean {
  const filters = tokens.map(parseContactLanguageToken).filter((f): f is ContactLanguageFilter => !!f);
  if (filters.length === 0) return true;
  return entries(sample).some(e => filters.some(f =>
    e.language.toLowerCase() === f.language.toLowerCase() && (f.level === ANY_LEVEL || e.level === f.level)
  ));
}

/** Languages the samples list at `level` (or any L2 level), with sample counts, A–Z. */
export function contactLanguageOptions(samples: any[], level: string): { language: string; count: number }[] {
  const counts = new Map<string, { language: string; count: number }>();
  for (const s of samples ?? []) {
    const seen = new Set<string>();
    for (const e of entries(s)) {
      if (level !== ANY_LEVEL && e.level !== level) continue;
      const key = e.language.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const row = counts.get(key);
      if (row) row.count++;
      else counts.set(key, { language: e.language, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => a.language.localeCompare(b.language));
}
