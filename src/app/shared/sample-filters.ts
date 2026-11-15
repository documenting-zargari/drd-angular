/**
 * Sample filters shared by every cross-sample search (Search, Tables search
 * mode, Phrases search, Concordance): narrow which samples are searched by
 * country, contact language (L2), dialect group, source type and migrant
 * status.
 *
 * The server applies them (roma-server data/sample_scope.py); the client only
 * keeps them in the URL, sends them along, and uses `sampleMatchesFilters`
 * to narrow sample *pickers* to the same set. URL params: countries, l2,
 * groups (CSV), source (one Sample.source_type value) and migrant
 * (exclude; absent = all).
 */
import { resolveCountry } from './country-codes';
import { contactLanguageLabel, sampleMatchesContactLanguages } from './contact-languages';

export type MigrantMode = 'all' | 'exclude';

/** Value for "no country / no dialect group recorded". */
export const NO_VALUE = '__none__';

/** Sample.source_type values (the stored spelling, "Questionaire" included). */
export const SOURCE_TYPES: { value: string; label: string }[] = [
  { value: 'RMS Questionaire', label: 'RMS questionnaire' },
  { value: 'Published Source', label: 'Published source' },
  { value: 'External Fieldwork', label: 'External fieldwork' },
];

export interface SampleFilters {
  countries: string[];
  l2: string[];
  groups: string[];
  /** One Sample.source_type value, or null for all (types are exclusive). */
  source: string | null;
  migrant: MigrantMode;
}

export const EMPTY_SAMPLE_FILTERS: SampleFilters = { countries: [], l2: [], groups: [], source: null, migrant: 'all' };

export const SAMPLE_FILTER_PARAMS = ['countries', 'l2', 'groups', 'source', 'migrant'] as const;

/** URL patch that clears every filter param. */
export const NO_SAMPLE_FILTER_PARAMS: Record<typeof SAMPLE_FILTER_PARAMS[number], null> = {
  countries: null, l2: null, groups: null, source: null, migrant: null,
};

function csv(raw: string | null): string[] {
  return (raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

/** Filters from URL params (`get` is e.g. ParamMap.get). */
export function sampleFiltersFromParams(get: (key: string) => string | null): SampleFilters {
  const migrant = get('migrant');
  const source = get('source');
  return {
    countries: csv(get('countries')).map(c => (c === NO_VALUE ? c : c.toUpperCase())),
    l2: csv(get('l2')),
    groups: csv(get('groups')),
    source: SOURCE_TYPES.some(t => t.value === source) ? source : null,
    // '0' is the pre-2026-11 "exclude migrant samples" toggle value.
    migrant: migrant === 'exclude' || migrant === '0' ? 'exclude' : 'all',
  };
}

/** URL patch for `filters` (null clears a param). */
export function sampleFiltersToParams(filters: SampleFilters): Record<string, string | null> {
  const list = (v: string[]) => (v.length ? v.join(',') : null);
  return {
    countries: list(filters.countries),
    l2: list(filters.l2),
    groups: list(filters.groups),
    source: filters.source,
    migrant: filters.migrant === 'all' ? null : filters.migrant,
  };
}

export function hasSampleFilters(filters: SampleFilters): boolean {
  return !!(filters.countries.length || filters.l2.length || filters.groups.length
    || filters.source || filters.migrant !== 'all');
}

/** Stable string for change detection / auto-search keys. */
export function sampleFiltersKey(filters: SampleFilters): string {
  return JSON.stringify(SAMPLE_FILTER_PARAMS.map(k => {
    const v = filters[k];
    return Array.isArray(v) ? [...v].sort() : v;
  }));
}

/** Request params the server's data/sample_scope.py reads (only the active ones). */
export function sampleFiltersRequestParams(filters: SampleFilters): Record<string, string[] | string> {
  const params: Record<string, string[] | string> = {};
  if (filters.countries.length) params['country_codes'] = filters.countries;
  if (filters.l2.length) params['contact_languages'] = filters.l2;
  if (filters.groups.length) params['dialect_groups'] = filters.groups;
  if (filters.source) params['source_type'] = filters.source;
  if (filters.migrant !== 'all') params['migrant'] = filters.migrant;
  return params;
}

function isMigrant(sample: any): boolean {
  // Some pages normalise Sample.migrant ("Yes"/"No") to a boolean in place.
  return sample?.migrant === true || sample?.migrant === 'Yes';
}

function inOrNone(value: string | null | undefined, wanted: string[]): boolean {
  if (wanted.length === 0) return true;
  return value ? wanted.includes(value) : wanted.includes(NO_VALUE);
}

/** Client-side mirror of the server's matching, for narrowing sample pickers. */
export function sampleMatchesFilters(sample: any, filters: SampleFilters): boolean {
  return inOrNone(resolveCountry(sample?.country_code)?.code, filters.countries)
    && inOrNone(sample?.dialect_group_name, filters.groups)
    && (!filters.source || sample?.source_type === filters.source)
    && (filters.migrant === 'all' || !isMigrant(sample))
    && sampleMatchesContactLanguages(sample, filters.l2);
}

/** Dialect groups present in `samples`, with counts, A–Z (+ "No group" last). */
export function dialectGroupOptions(samples: any[]): { value: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  let none = 0;
  for (const s of samples ?? []) {
    const g = s?.dialect_group_name;
    if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
    else none++;
  }
  const rows = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([value, count]) => ({ value, label: value, count }));
  if (none) rows.push({ value: NO_VALUE, label: 'No group', count: none });
  return rows;
}

export function countryFilterLabel(code: string): string {
  if (code === NO_VALUE) return 'Unknown country';
  const info = resolveCountry(code);
  return info ? `${info.flag ? info.flag + ' ' : ''}${info.name}` : code;
}

export type SampleFilterChip = { kind: 'countries' | 'l2' | 'groups'; value: string; label: string };

/** One removable chip per selected list value. */
export function sampleFilterChips(filters: SampleFilters): SampleFilterChip[] {
  return [
    ...filters.countries.map(v => ({ kind: 'countries' as const, value: v, label: countryFilterLabel(v) })),
    ...filters.l2.map(v => ({ kind: 'l2' as const, value: v, label: contactLanguageLabel(v) })),
    ...filters.groups.map(v => ({ kind: 'groups' as const, value: v, label: v === NO_VALUE ? 'No dialect group' : v })),
  ];
}

/** `filters` with `value` added to / removed from list `kind`. */
export function toggleSampleFilter(filters: SampleFilters, kind: SampleFilterChip['kind'], value: string): SampleFilters {
  const list = filters[kind];
  return { ...filters, [kind]: list.includes(value) ? list.filter(v => v !== value) : [...list, value] };
}

/** The raw filter params, as UrlStateService.selectMany yields them. */
export type SampleFilterRawParams = { [K in typeof SAMPLE_FILTER_PARAMS[number]]: string | null };

/** selectMany spec entries for the filter params — spread into a page's spec,
 *  then fold them into one `filters` object with `withSampleFilters`. */
export const SAMPLE_FILTER_RAW_SPEC: { [K in keyof SampleFilterRawParams]: (raw: string | null) => string | null } = {
  countries: raw => raw, l2: raw => raw, groups: raw => raw, source: raw => raw, migrant: raw => raw,
};

export function withSampleFilters<T extends SampleFilterRawParams>(
  vm: T,
): Omit<T, keyof SampleFilterRawParams> & { filters: SampleFilters } {
  const rest: any = { ...vm };
  for (const key of SAMPLE_FILTER_PARAMS) delete rest[key];
  return { ...rest, filters: sampleFiltersFromParams(key => (vm as any)[key] ?? null) };
}
